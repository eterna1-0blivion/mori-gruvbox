'use strict';

/**
 * Mozg (VS) Code - Theme Extension: точка входа расширения.
 *
 * Применяет Mori Bridge — патч файла стилей веб-панели Mozg, который
 * заставляет Mozg использовать цвета активной темы VS Code
 * (сама логика — в lib/bridge.js, этот файл только вызывает её в нужные
 * моменты и общается с пользователем через UI VS Code).
 *
 * Mozg — чужое расширение, поэтому мы трогаем его файлы только с согласия
 * пользователя: настройка moriGruvbox.mozgBridge = "ask" (по умолчанию) |
 * "auto" | "off". Идентификаторы настройки и команд сохранили исторический
 * префикс "moriGruvbox" (от прежнего названия проекта), чтобы у тех, кто
 * уже настроил расширение раньше, ничего не сбросилось при обновлении.
 *
 * Сообщения пользователю (showInformationMessage/showWarningMessage) и
 * подписи кнопок оставлены на английском — это стандартная практика для
 * расширений VS Code, которые публикуются в общий Marketplace. Комментарии
 * в самом коде — на русском, для тех, кто будет читать и дорабатывать файл.
 */

const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const bridge = require('./lib/bridge');

const MOZG_ID = 'mori-ai.mori-code';
const SETTING = 'mozgBridge';
const TITLE = 'Mozg Theme';

const REASONS = {
	unsupported:
		'Mozg changed its stylesheet layout, so the bridge cannot be applied safely. ' +
		'Please open an issue so the bridge can be updated.',
};

/** Находит установленный Mozg и возвращает то, что нужно мосту: версию и путь к CSS. */
function getMozg() {
	const mozg = vscode.extensions.getExtension(MOZG_ID);
	if (!mozg) {
		return null;
	}
	return {
		version: mozg.packageJSON.version,
		cssPath: bridge.cssPathFor(mozg.extensionPath),
	};
}

/** Читает шаблон блока моста (lib/bridge.template.css) рядом с кодом расширения. */
function readTemplate(context) {
	return fs.readFileSync(path.join(context.extensionPath, 'lib', 'bridge.template.css'), 'utf8');
}

/** Показывает сообщение с кнопкой перезагрузки окна и выполняет её при нажатии. */
async function offerReload(text) {
	const reload = 'Reload Window';
	const choice = await vscode.window.showInformationMessage(text, reload);
	if (choice === reload) {
		await vscode.commands.executeCommand('workbench.action.reloadWindow');
	}
}

/**
 * Применяет мост и сообщает результат пользователю.
 * Возвращает true, если файл стилей Mozg реально изменился.
 */
async function applyBridge(context, mozg) {
	const result = bridge.apply(mozg.cssPath, readTemplate(context));
	if (result.state === 'unsupported') {
		vscode.window.showWarningMessage(`${TITLE}: ${REASONS.unsupported}`);
		return false;
	}
	if (result.state === 'missing') {
		vscode.window.showWarningMessage(`${TITLE}: the Mozg stylesheet was not found.`);
		return false;
	}
	if (result.changed) {
		await offerReload(`${TITLE}: Mozg now follows your VS Code theme. Reload the window to see it.`);
	} else {
		vscode.window.showInformationMessage(`${TITLE}: the Mozg bridge is already up to date.`);
	}
	return result.changed;
}

/**
 * Проверка при запуске VS Code: решает, нужно ли (пере)применить мост, и как
 * себя вести в зависимости от настройки moriGruvbox.mozgBridge.
 *
 * Эта функция вызывается на каждом старте VS Code (см. activate() ниже),
 * поэтому она должна быть «тихой», если применять мост не нужно — не
 * показывать лишних сообщений при каждом открытии редактора.
 */
async function ensureBridge(context) {
	const mozg = getMozg();
	if (!mozg) {
		return;
	}

	const config = vscode.workspace.getConfiguration('moriGruvbox');
	const mode = config.get(SETTING, 'ask');
	if (mode === 'off') {
		return;
	}

	const status = bridge.getStatus(mozg.cssPath, readTemplate(context));
	if (status.state === 'current' || status.state === 'missing') {
		return;
	}

	// Структуру стилей Mozg не узнать (скорее всего — после обновления Mozg
	// с другой вёрсткой webview). Предупреждаем один раз на эту версию Mozg,
	// а не при каждом запуске — ключ в globalState запоминает, что уже сказали.
	const noticeKey = `notified:${status.state}:${mozg.version}`;
	if (status.state === 'unsupported') {
		if (!context.globalState.get(noticeKey)) {
			await context.globalState.update(noticeKey, true);
			vscode.window.showWarningMessage(`${TITLE}: ${REASONS.unsupported}`);
		}
		return;
	}

	if (mode === 'auto') {
		await applyBridge(context, mozg);
		return;
	}

	// mode === 'ask': если пользователь уже один раз ответил "Not now" для
	// этой версии Mozg, больше не спрашиваем — до следующего обновления Mozg
	// (новая версия Mozg даёт новый declinedKey, и вопрос зададут снова).
	const declinedKey = `declined:${mozg.version}`;
	if (context.globalState.get(declinedKey)) {
		return;
	}

	const apply = 'Apply';
	const always = 'Always apply';
	const notNow = 'Not now';
	const never = 'Never';
	const choice = await vscode.window.showInformationMessage(
		`${TITLE} can make Mozg use the colors of your current VS Code theme. ` +
			'This edits one stylesheet inside the Mozg extension (a backup is kept; ' +
			`"${TITLE}: Revert Mozg Bridge" undoes it).`,
		apply,
		always,
		notNow,
		never
	);

	if (choice === apply || choice === always) {
		if (choice === always) {
			await config.update(SETTING, 'auto', vscode.ConfigurationTarget.Global);
		}
		await applyBridge(context, mozg);
	} else if (choice === never) {
		await config.update(SETTING, 'off', vscode.ConfigurationTarget.Global);
	} else if (choice === notNow) {
		await context.globalState.update(declinedKey, true);
	}
}

/** Общий страж для команд: без установленного Mozg им просто нечего делать. */
function withMozg(action) {
	const mozg = getMozg();
	if (!mozg) {
		vscode.window.showWarningMessage(`${TITLE}: the Mozg extension (${MOZG_ID}) is not installed.`);
		return undefined;
	}
	return action(mozg);
}

function activate(context) {
	context.subscriptions.push(
		vscode.commands.registerCommand('moriGruvbox.applyMozgBridge', () =>
			withMozg((mozg) => applyBridge(context, mozg))
		),
		vscode.commands.registerCommand('moriGruvbox.revertMozgBridge', () =>
			withMozg(async (mozg) => {
				const result = bridge.revert(mozg.cssPath);
				if (!result.changed) {
					vscode.window.showInformationMessage(`${TITLE}: the Mozg stylesheet has no bridge to revert.`);
					return;
				}
				await offerReload(`${TITLE}: the Mozg stylesheet is back to its original state.`);
			})
		),
		vscode.commands.registerCommand('moriGruvbox.showMozgBridgeStatus', () =>
			withMozg((mozg) => {
				const status = bridge.getStatus(mozg.cssPath, readTemplate(context));
				vscode.window.showInformationMessage(
					`${TITLE}: Mozg ${mozg.version} - bridge state: ${status.state}` +
						(status.overrides === undefined ? '' : ` (${status.overrides} theme variables handed back)`)
				);
			})
		)
	);

	// Mozg может активироваться позже нас (мы не знаем порядок активации
	// расширений в VS Code), поэтому проверяем мост с небольшой задержкой —
	// но так, чтобы это не блокировало запуск самого VS Code.
	const timer = setTimeout(() => {
		ensureBridge(context).catch((error) => console.error('[mozg-theme]', error));
	}, 1500);
	context.subscriptions.push({ dispose: () => clearTimeout(timer) });
}

function deactivate() {}

// `_internal` используется только тестами (test/extension.test.js), чтобы
// вызывать внутренние функции напрямую через заглушку пакета `vscode`.
module.exports = { activate, deactivate, _internal: { ensureBridge, applyBridge } };

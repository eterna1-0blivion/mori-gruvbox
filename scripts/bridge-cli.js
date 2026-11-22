// Mozg (VS) Code - Theme Extension - (c) 2026 eterna1-0blivion, MIT.
// Written by the Mozg AI assistant (https://mozg.world) with eterna1-0blivion.

#!/usr/bin/env node
'use strict';

/**
 * Консольный доступ к мосту Mozg Theme, без запуска самого VS Code.
 * Расширение делает то же самое автоматически при старте — этот скрипт
 * нужен для ручной отладки и для сценариев установки (scripts/install.ps1).
 *
 *   node scripts/bridge-cli.js status [--extensions-dir КАТАЛОГ]
 *   node scripts/bridge-cli.js apply  [--extensions-dir КАТАЛОГ]
 *   node scripts/bridge-cli.js revert [--extensions-dir КАТАЛОГ]
 *
 * Каталог по умолчанию: ~/.vscode/extensions.
 * Код возврата: 0 — всё хорошо, 1 — ошибка использования,
 * 2 — ничего не удалось изменить (Mozg не найден или файл стилей не узнан).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const bridge = require('../lib/bridge');

const TEMPLATE = path.join(__dirname, '..', 'lib', 'bridge.template.css');

/** Разбирает аргументы командной строки: команду и необязательный каталог. */
function parse(argv) {
	const [command, ...rest] = argv;
	let dir = path.join(os.homedir(), '.vscode', 'extensions');
	for (let i = 0; i < rest.length; i++) {
		if (rest[i] === '--extensions-dir' && rest[i + 1]) {
			dir = path.resolve(rest[++i]);
		}
	}
	return { command, dir };
}

// Человеко-читаемые пояснения к состояниям, которые возвращает lib/bridge.js.
const NOTES = {
	none: 'bridge not applied',
	legacy: 'patch from the pre-extension script present (apply replaces it)',
	outdated: 'bridge present but differs from this version (apply updates it)',
	current: 'bridge applied',
	unsupported: 'stylesheet layout not recognised - left untouched',
	missing: 'stylesheet not found',
};

function main() {
	const { command, dir } = parse(process.argv.slice(2));
	if (!['status', 'apply', 'revert'].includes(command)) {
		console.error('usage: bridge-cli.js <status|apply|revert> [--extensions-dir DIR]');
		return 1;
	}

	const installs = bridge.findInstalls(dir);
	if (installs.length === 0) {
		console.error(`No Mozg (mori-ai.mori-code) found in ${dir}`);
		return 2;
	}

	const template = fs.readFileSync(TEMPLATE, 'utf8');
	let changedAny = false;
	let failed = false;

	// Обычно установлена одна версия Mozg, но если их несколько (например,
	// осталась старая после обновления) — обрабатываем каждую по отдельности,
	// чтобы ошибка на одной не мешала остальным.
	for (const install of installs) {
		let result;
		try {
			if (command === 'status') {
				result = bridge.getStatus(install.cssPath, template);
			} else if (command === 'apply') {
				result = bridge.apply(install.cssPath, template);
			} else {
				result = bridge.revert(install.cssPath);
			}
		} catch (error) {
			console.error(`${install.name}: ${error.message}`);
			failed = true;
			continue;
		}
		changedAny = changedAny || Boolean(result.changed);
		const note = NOTES[result.state] || result.state;
		const verb = command === 'status' ? '' : result.changed ? 'changed - ' : 'unchanged - ';
		console.log(`${install.name}: ${verb}${note}`);
		if (result.state === 'unsupported' || result.state === 'missing') {
			failed = true;
		}
	}

	if (changedAny && command !== 'status') {
		console.log('Reload the VS Code window to see the change.');
	}
	return failed ? 2 : 0;
}

process.exitCode = main();

'use strict';

/**
 * Mozg (VS) Code - Theme Extension: extension host entry.
 *
 * Applies the Mori bridge - a patch of the Mozg webview stylesheet that makes
 * Mozg use the colors of whatever VS Code theme is active (see lib/bridge.js).
 *
 * Mozg is a separate extension, so we only touch its files with consent:
 * moriGruvbox.mozgBridge = "ask" (default) | "auto" | "off".
 * (The setting and command ids keep their original "moriGruvbox" prefix so
 * that existing user settings continue to work.)
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

function readTemplate(context) {
	return fs.readFileSync(path.join(context.extensionPath, 'lib', 'bridge.template.css'), 'utf8');
}

async function offerReload(text) {
	const reload = 'Reload Window';
	const choice = await vscode.window.showInformationMessage(text, reload);
	if (choice === reload) {
		await vscode.commands.executeCommand('workbench.action.reloadWindow');
	}
}

/** Applies the bridge and reports the outcome. Returns true when changed. */
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

/** Startup check: re-applies after a Mozg update, honoring the setting. */
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

	// mode === 'ask': do not nag again for the same Mozg version after a "Not now".
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

	// Mozg may activate after us; give it a moment, but never block startup.
	const timer = setTimeout(() => {
		ensureBridge(context).catch((error) => console.error('[mozg-theme]', error));
	}, 1500);
	context.subscriptions.push({ dispose: () => clearTimeout(timer) });
}

function deactivate() {}

// `_internal` is exposed for tests only.
module.exports = { activate, deactivate, _internal: { ensureBridge, applyBridge } };

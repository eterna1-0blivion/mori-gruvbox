'use strict';

/**
 * Extension-host logic tested against a hand-written `vscode` stub: startup
 * behaviour for the three moriGruvbox.mozgBridge modes, "Not now" memory,
 * the unsupported-stylesheet notice and the theme-name migration.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const bridge = require('../lib/bridge');

const ROOT = path.join(__dirname, '..');
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'mozg-min.css'), 'utf8');

function createWorld({ css = FIXTURE, mode = 'ask', answers = [], colorTheme = 'Mori Gruvbox Dark Hard', mozg = true } = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mori-ext-'));
	const mozgDir = path.join(root, 'mori-ai.mori-code-0.0.1');
	const cssPath = bridge.cssPathFor(mozgDir);
	fs.mkdirSync(path.dirname(cssPath), { recursive: true });
	fs.writeFileSync(cssPath, css, 'utf8');

	const world = {
		cssPath,
		settings: { 'moriGruvbox.mozgBridge': mode, 'workbench.colorTheme': colorTheme },
		memento: new Map(),
		infos: [],
		warnings: [],
		commands: [],
		prompts: [],
		answers: [...answers],
	};

	world.vscode = {
		ConfigurationTarget: { Global: 1 },
		extensions: {
			getExtension: (id) =>
				mozg && id === 'mori-ai.mori-code'
					? { extensionPath: mozgDir, packageJSON: { version: '0.0.1' } }
					: undefined,
		},
		workspace: {
			getConfiguration: (section) => ({
				get: (key, fallback) => {
					const value = world.settings[`${section}.${key}`];
					return value === undefined ? fallback : value;
				},
				update: async (key, value) => {
					world.settings[`${section}.${key}`] = value;
				},
			}),
		},
		window: {
			showInformationMessage: async (message, ...items) => {
				world.infos.push(message);
				world.prompts.push({ message, items });
				return world.answers.shift();
			},
			showWarningMessage: async (message) => {
				world.warnings.push(message);
			},
		},
		commands: {
			registerCommand: () => ({ dispose() {} }),
			executeCommand: async (id) => {
				world.commands.push(id);
			},
		},
	};

	world.context = {
		extensionPath: ROOT,
		subscriptions: [],
		globalState: {
			get: (key) => world.memento.get(key),
			update: async (key, value) => {
				world.memento.set(key, value);
			},
		},
	};
	return world;
}

/** Loads extension.js with `require('vscode')` pointing at the world's stub. */
function load(world) {
	const original = Module._load;
	Module._load = function (request, ...rest) {
		return request === 'vscode' ? world.vscode : original.call(this, request, ...rest);
	};
	try {
		const file = require.resolve('../extension.js');
		delete require.cache[file];
		return require(file)._internal;
	} finally {
		Module._load = original;
	}
}

const bridged = (world) => fs.readFileSync(world.cssPath, 'utf8').includes(bridge.BEGIN);

test('mode "off": the stylesheet is never touched and nothing is asked', async () => {
	const world = createWorld({ mode: 'off' });
	await load(world).ensureBridge(world.context);
	assert.equal(bridged(world), false);
	assert.equal(world.prompts.length, 0);
});

test('mode "auto": applies silently, then offers a reload', async () => {
	const world = createWorld({ mode: 'auto', answers: ['Reload Window'] });
	await load(world).ensureBridge(world.context);
	assert.equal(bridged(world), true);
	assert.deepEqual(world.commands, ['workbench.action.reloadWindow']);
});

test('mode "ask" + Apply: edits the stylesheet', async () => {
	const world = createWorld({ answers: ['Apply'] });
	await load(world).ensureBridge(world.context);
	assert.equal(bridged(world), true);
	assert.ok(world.prompts[0].items.includes('Apply') && world.prompts[0].items.includes('Never'));
});

test('mode "ask" + Always apply: switches the setting to auto', async () => {
	const world = createWorld({ answers: ['Always apply'] });
	await load(world).ensureBridge(world.context);
	assert.equal(bridged(world), true);
	assert.equal(world.settings['moriGruvbox.mozgBridge'], 'auto');
});

test('mode "ask" + Never: switches the setting to off and leaves the file alone', async () => {
	const world = createWorld({ answers: ['Never'] });
	await load(world).ensureBridge(world.context);
	assert.equal(bridged(world), false);
	assert.equal(world.settings['moriGruvbox.mozgBridge'], 'off');
});

test('mode "ask" + Not now: remembered, so the next start does not ask again', async () => {
	const world = createWorld({ answers: ['Not now'] });
	const { ensureBridge } = load(world);
	await ensureBridge(world.context);
	await ensureBridge(world.context);
	assert.equal(bridged(world), false);
	assert.equal(world.prompts.length, 1, 'asked exactly once');
});

test('an already bridged stylesheet is left alone without any prompt', async () => {
	const world = createWorld({ mode: 'auto' });
	const { ensureBridge } = load(world);
	await ensureBridge(world.context);
	world.prompts.length = 0;
	await ensureBridge(world.context);
	assert.equal(world.prompts.length, 0);
});

test('an unsupported stylesheet is reported once and never edited', async () => {
	const world = createWorld({ css: 'body{color:red}', mode: 'auto' });
	const { ensureBridge } = load(world);
	await ensureBridge(world.context);
	await ensureBridge(world.context);
	assert.equal(fs.readFileSync(world.cssPath, 'utf8'), 'body{color:red}');
	assert.equal(world.warnings.length, 1, 'warned once for this Mozg version');
});

test('without Mozg installed the extension does nothing', async () => {
	const world = createWorld({ mozg: false });
	await load(world).ensureBridge(world.context);
	assert.equal(world.prompts.length + world.warnings.length, 0);
});

test('the 1.x theme name is migrated, other themes are not touched', async () => {
	const legacy = createWorld({ colorTheme: 'Mori Gruvbox Dark Hard' });
	await load(legacy).migrateThemeName();
	assert.equal(legacy.settings['workbench.colorTheme'], 'Mori Gruvbox');

	const other = createWorld({ colorTheme: 'Dark Modern' });
	await load(other).migrateThemeName();
	assert.equal(other.settings['workbench.colorTheme'], 'Dark Modern');
});


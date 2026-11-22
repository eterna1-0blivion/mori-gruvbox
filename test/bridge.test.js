'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const bridge = require('../lib/bridge');

const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'lib', 'bridge.template.css'), 'utf8');
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'mozg-min.css'), 'utf8');

function sandbox(css = FIXTURE) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mori-bridge-'));
	const dir = path.join(root, 'mori-ai.mori-code-0.0.1');
	const cssPath = bridge.cssPathFor(dir);
	fs.mkdirSync(path.dirname(cssPath), { recursive: true });
	fs.writeFileSync(cssPath, css, 'utf8');
	return { root, dir, cssPath, read: () => fs.readFileSync(cssPath, 'utf8') };
}

test('collectOverrides finds every --vscode-* redeclaration except the font', () => {
	const names = bridge.collectOverrides(FIXTURE);
	assert.ok(names.includes('--vscode-sideBar-background'));
	assert.ok(names.includes('--vscode-list-activeSelectionBackground'));
	assert.ok(names.includes('--vscode-textLink-foreground'));
	assert.ok(!names.includes('--vscode-font-family'), 'Mozg typography is kept');
	assert.equal(new Set(names).size, names.length, 'no duplicates');
});

test('apply appends one bridge block and keeps a pristine backup', () => {
	const box = sandbox();
	const result = bridge.apply(box.cssPath, TEMPLATE);
	assert.equal(result.state, 'current');
	assert.equal(result.changed, true);

	const css = box.read();
	assert.equal(css.split(bridge.BEGIN).length - 1, 1);
	assert.equal(css.split(bridge.END).length - 1, 1);
	assert.ok(css.includes('--vscode-sideBar-background: inherit;'));
	assert.ok(!css.includes(bridge.PLACEHOLDER), 'placeholder is filled');
	assert.equal(fs.readFileSync(`${box.cssPath}.orig`, 'utf8'), FIXTURE.trimEnd() + '\n');
});

test('apply is idempotent (byte-for-byte)', () => {
	const box = sandbox();
	bridge.apply(box.cssPath, TEMPLATE);
	const first = box.read();
	const again = bridge.apply(box.cssPath, TEMPLATE);
	assert.equal(again.changed, false);
	assert.equal(box.read(), first);
});

test('revert restores the original stylesheet exactly', () => {
	const box = sandbox();
	bridge.apply(box.cssPath, TEMPLATE);
	const result = bridge.revert(box.cssPath);
	assert.equal(result.changed, true);
	assert.equal(box.read(), FIXTURE.trimEnd() + '\n');
	assert.equal(bridge.revert(box.cssPath).changed, false, 'second revert is a no-op');
});

test('a stylesheet without the Mozg signature is never touched', () => {
	const box = sandbox('body{color:red}');
	assert.equal(bridge.apply(box.cssPath, TEMPLATE).state, 'unsupported');
	assert.equal(box.read(), 'body{color:red}');
	assert.equal(fs.existsSync(`${box.cssPath}.orig`), false);
	assert.equal(bridge.revert(box.cssPath).changed, false);
});

test('a missing stylesheet is reported, not thrown', () => {
	const box = sandbox();
	fs.rmSync(box.cssPath);
	assert.equal(bridge.apply(box.cssPath, TEMPLATE).state, 'missing');
	assert.equal(bridge.getStatus(box.cssPath).state, 'missing');
});

test('getStatus distinguishes none / current / outdated / legacy', () => {
	const box = sandbox();
	assert.equal(bridge.getStatus(box.cssPath, TEMPLATE).state, 'none');

	bridge.apply(box.cssPath, TEMPLATE);
	assert.equal(bridge.getStatus(box.cssPath, TEMPLATE).state, 'current');
	assert.equal(bridge.getStatus(box.cssPath, TEMPLATE.replace('Mori Bridge', 'Mori Bridge v2')).state, 'outdated');

	const legacy = sandbox(
		FIXTURE.trimEnd() + '\n\n/* ===== MORI NEUTRAL THEME BEGIN (generated) ===== */\n:root{--mori-accent:#4a4a4a}\n/* ===== MORI NEUTRAL THEME END ===== */\n'
	);
	assert.equal(bridge.getStatus(legacy.cssPath, TEMPLATE).state, 'legacy');
});

test('applying over the 1.x neutral-theme patch replaces it', () => {
	const box = sandbox(
		FIXTURE.trimEnd() + '\n\n/* ===== MORI NEUTRAL THEME BEGIN (generated) ===== */\n:root{--mori-accent:#4a4a4a}\n/* ===== MORI NEUTRAL THEME END ===== */\n'
	);
	bridge.apply(box.cssPath, TEMPLATE);
	const css = box.read();
	assert.ok(!css.includes('MORI NEUTRAL THEME'));
	assert.ok(css.includes(bridge.BEGIN));
	assert.equal(fs.readFileSync(`${box.cssPath}.orig`, 'utf8'), FIXTURE.trimEnd() + '\n', 'backup is pristine');
});

test('a Mozg update (new stylesheet) is re-bridged and re-backed-up', () => {
	const box = sandbox();
	bridge.apply(box.cssPath, TEMPLATE);

	const updated = FIXTURE.replace('--mori-accent:#ff6a1a;', '--mori-accent:#ff0000;');
	fs.writeFileSync(box.cssPath, updated, 'utf8');
	assert.equal(bridge.getStatus(box.cssPath, TEMPLATE).state, 'none');

	bridge.apply(box.cssPath, TEMPLATE);
	assert.equal(fs.readFileSync(`${box.cssPath}.orig`, 'utf8'), updated.trimEnd() + '\n');
});

test('a corrupted block (BEGIN without END) is refused', () => {
	const box = sandbox(FIXTURE + '\n/* ===== MORI BRIDGE BEGIN (broken) */\n');
	assert.throws(() => bridge.apply(box.cssPath, TEMPLATE), bridge.BridgeError);
});

test('CRLF stylesheets and templates are handled', () => {
	const box = sandbox(FIXTURE.replace(/\n/g, '\r\n'));
	const crlfTemplate = TEMPLATE.replace(/\r?\n/g, '\r\n');
	bridge.apply(box.cssPath, crlfTemplate);
	assert.equal(bridge.getStatus(box.cssPath, crlfTemplate).state, 'current');
	bridge.revert(box.cssPath);
	assert.ok(!box.read().includes('MORI BRIDGE'));
});

test('findInstalls lists every Mozg version, sorted, and ignores other extensions', () => {
	const box = sandbox();
	fs.mkdirSync(path.join(box.root, 'mori-ai.mori-code-0.0.2'));
	fs.mkdirSync(path.join(box.root, 'someone.else-1.0.0'));
	const names = bridge.findInstalls(box.root).map((item) => item.name);
	assert.deepEqual(names, ['mori-ai.mori-code-0.0.1', 'mori-ai.mori-code-0.0.2']);
	assert.deepEqual(bridge.findInstalls(path.join(box.root, 'nope')), []);
});

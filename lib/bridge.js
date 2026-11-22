'use strict';

/**
 * Mori bridge: makes the Mozg webview (extension "mori-ai.mori-code") use the
 * colors of the active VS Code theme instead of its own hardcoded palette.
 *
 * How it works
 * ------------
 * VS Code injects every theme color into a webview as a --vscode-* custom
 * property on <html> and refreshes them when the theme changes. Mozg redeclares
 * ~36 of those on <body> (e.g. --vscode-sideBar-background: var(--mori-bg)),
 * which shadows the theme. The bridge appends one CSS block that
 *   1. resets every such redeclaration to `inherit` (the list is derived from
 *      the installed CSS, so new overrides added by Mozg are picked up), and
 *   2. maps Mozg's own --mori-* palette onto --vscode-* variables.
 * The block contains no theme-specific values, so it works for any theme and
 * follows theme switches live, without being re-applied.
 *
 * Pure Node (no `vscode` import): used by the extension, the CLI and tests.
 */

const fs = require('fs');
const path = require('path');

const BEGIN = '/* ===== MORI BRIDGE BEGIN';
const END = '/* ===== MORI BRIDGE END ===== */';

// Blocks written by earlier versions of this project; removed on apply/revert.
const LEGACY_BLOCKS = [
	{
		begin: '/* ===== MORI NEUTRAL THEME BEGIN',
		end: '/* ===== MORI NEUTRAL THEME END ===== */',
	},
];

// Present in Mozg's stylesheet; its absence means the layout changed and the
// file must not be touched.
const SIGNATURE = '--mori-accent';

const PLACEHOLDER = '/*{{VSCODE_INHERIT}}*/';

// Mozg's own typography is intentionally kept.
const KEEP_OWN = new Set(['--vscode-font-family']);

const MOZG_DIR_RE = /^mori-ai\.mori-code-\d/;
const CSS_SEGMENTS = ['webview-ui', 'build', 'assets', 'index.css'];

class BridgeError extends Error {}

/** Removes one marked block together with the blank lines around it. */
function stripBlock(css, begin, end) {
	const start = css.indexOf(begin);
	if (start < 0) {
		return css;
	}
	const endIdx = css.indexOf(end, start);
	if (endIdx < 0) {
		throw new BridgeError(`Found "${begin}" without its end marker; the stylesheet looks corrupted.`);
	}

	// Swallow up to two line breaks before the block (the separator we added).
	let from = start;
	for (let newlines = 0; newlines < 2 && from > 0; ) {
		if (css[from - 1] !== '\n') {
			break;
		}
		from -= 1;
		newlines += 1;
		if (css[from - 1] === '\r') {
			from -= 1;
		}
	}

	let to = endIdx + end.length;
	if (css[to] === '\r') {
		to += 1;
	}
	if (css[to] === '\n') {
		to += 1;
	}
	return css.slice(0, from) + css.slice(to);
}

function stripAll(css) {
	let result = stripBlock(css, BEGIN, END);
	for (const legacy of LEGACY_BLOCKS) {
		result = stripBlock(result, legacy.begin, legacy.end);
	}
	return result;
}

/** All --vscode-* names Mozg redeclares (sorted, without the kept ones). */
function collectOverrides(css) {
	const names = new Set();
	const re = /(--vscode-[A-Za-z0-9-]+)\s*:/g;
	let match;
	while ((match = re.exec(css)) !== null) {
		if (!KEEP_OWN.has(match[1])) {
			names.add(match[1]);
		}
	}
	return [...names].sort();
}

/** Fills the template's placeholder with `--vscode-x: inherit;` lines. */
function render(template, overrides) {
	// The template may be checked out with CRLF on Windows; the stylesheet is LF.
	const block = template.replace(/\r\n/g, '\n').trim();
	if (!block.startsWith(BEGIN) || !block.endsWith(END)) {
		throw new BridgeError('The bridge template has no BEGIN/END markers.');
	}
	const parts = block.split(PLACEHOLDER);
	if (parts.length !== 2) {
		throw new BridgeError(`The bridge template must contain ${PLACEHOLDER} exactly once.`);
	}
	const lines = overrides.map((name) => `${name}: inherit;`).join('\n\t');
	return parts[0] + lines + parts[1];
}

function analyze(css) {
	let kind = null;
	if (css.includes(BEGIN)) {
		kind = 'bridge';
	} else if (LEGACY_BLOCKS.some((legacy) => css.includes(legacy.begin))) {
		kind = 'legacy';
	}
	const base = stripAll(css);
	const supported = base.includes(SIGNATURE);
	return { kind, base, supported, overrides: supported ? collectOverrides(base) : [] };
}

function compose(base, template, overrides) {
	return base.trimEnd() + '\n\n' + render(template, overrides) + '\n';
}

function writeAtomic(file, text) {
	const tmp = `${file}.tmp`;
	fs.writeFileSync(tmp, text, 'utf8');
	fs.renameSync(tmp, file);
}

/**
 * state: missing | unsupported | none | legacy | outdated | current
 * `template` is optional; without it a present bridge is reported as current.
 */
function getStatus(cssPath, template) {
	if (!fs.existsSync(cssPath)) {
		return { state: 'missing' };
	}
	const css = fs.readFileSync(cssPath, 'utf8');
	const info = analyze(css);
	if (!info.supported) {
		return { state: 'unsupported' };
	}
	const base = { overrides: info.overrides.length };
	if (!info.kind) {
		return { state: 'none', ...base };
	}
	if (info.kind === 'legacy') {
		return { state: 'legacy', ...base };
	}
	if (template && compose(info.base, template, info.overrides) !== css) {
		return { state: 'outdated', ...base };
	}
	return { state: 'current', ...base };
}

function apply(cssPath, template) {
	if (!fs.existsSync(cssPath)) {
		return { state: 'missing', changed: false };
	}
	const css = fs.readFileSync(cssPath, 'utf8');
	const info = analyze(css);
	if (!info.supported) {
		return { state: 'unsupported', changed: false };
	}

	const next = compose(info.base, template, info.overrides);

	// Backup of the pristine stylesheet; refreshed when Mozg ships a new one.
	const backupPath = `${cssPath}.orig`;
	const pristine = info.base.trimEnd() + '\n';
	if (!fs.existsSync(backupPath) || fs.readFileSync(backupPath, 'utf8') !== pristine) {
		fs.writeFileSync(backupPath, pristine, 'utf8');
	}

	if (next === css) {
		return { state: 'current', changed: false, overrides: info.overrides.length };
	}
	writeAtomic(cssPath, next);
	return { state: 'current', changed: true, overrides: info.overrides.length };
}

function revert(cssPath) {
	if (!fs.existsSync(cssPath)) {
		return { state: 'missing', changed: false };
	}
	const css = fs.readFileSync(cssPath, 'utf8');
	const info = analyze(css);
	if (!info.kind) {
		return { state: info.supported ? 'none' : 'unsupported', changed: false };
	}
	writeAtomic(cssPath, info.base.trimEnd() + '\n');
	return { state: 'none', changed: true };
}

/** Finds Mozg installs inside an extensions directory (used by the CLI). */
function findInstalls(extensionsRoot) {
	if (!fs.existsSync(extensionsRoot)) {
		return [];
	}
	return fs
		.readdirSync(extensionsRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && MOZG_DIR_RE.test(entry.name))
		.map((entry) => ({
			name: entry.name,
			dir: path.join(extensionsRoot, entry.name),
			cssPath: path.join(extensionsRoot, entry.name, ...CSS_SEGMENTS),
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** CSS path for a known extension directory (used by the extension). */
function cssPathFor(extensionDir) {
	return path.join(extensionDir, ...CSS_SEGMENTS);
}

module.exports = {
	BEGIN,
	END,
	SIGNATURE,
	PLACEHOLDER,
	BridgeError,
	collectOverrides,
	render,
	stripAll,
	getStatus,
	apply,
	revert,
	findInstalls,
	cssPathFor,
};


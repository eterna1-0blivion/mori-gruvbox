'use strict';

/**
 * Browser test: proves that the bridged Mozg stylesheet really takes its
 * colors from the VS Code theme, in a real Chrome.
 *
 * VS Code puts every theme color into a webview as --vscode-* on <html>; the
 * test does the same with several themes and compares computed colors. It also
 * switches themes on the live page (no re-apply) and runs an un-bridged control
 * to show the test can fail.
 *
 * Skipped when no Chrome/Chromium is found (set CHROME_PATH to point to one).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const bridge = require('../lib/bridge');

const ROOT = path.join(__dirname, '..');
const TEMPLATE = fs.readFileSync(path.join(ROOT, 'lib', 'bridge.template.css'), 'utf8');
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'mozg-min.css'), 'utf8');

const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(...parts), 'utf8').replace(/^\uFEFF/, ''));

const THEMES = {
	'Mori Gruvbox': readJson(ROOT, 'themes', 'mori-gruvbox.json').colors,
	'Gruvbox Dark Hard': readJson(ROOT, 'upstream', 'gruvbox-dark-hard.json').colors,
	'Dark Modern': readJson(ROOT, 'upstream', 'dark-modern.json').colors,
	'Light (fixture)': readJson(__dirname, 'fixtures', 'light-theme.json').colors,
};

function findChrome() {
	const candidates = [
		process.env.CHROME_PATH,
		'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
		'/usr/bin/google-chrome',
		'/usr/bin/google-chrome-stable',
		'/usr/bin/chromium',
		'/usr/bin/chromium-browser',
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	];
	return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

/** Stylesheets under test: the small fixture, plus the real Mozg one if present. */
function stylesheets() {
	const list = [{ name: 'fixture', css: FIXTURE }];
	const realDir = path.join(os.homedir(), '.vscode', 'extensions');
	for (const install of bridge.findInstalls(realDir)) {
		const orig = `${install.cssPath}.orig`;
		const source = fs.existsSync(orig) ? orig : install.cssPath;
		if (fs.existsSync(source)) {
			const css = fs.readFileSync(source, 'utf8');
			if (css.includes(bridge.SIGNATURE) && !css.includes(bridge.BEGIN)) {
				list.push({ name: install.name, css });
			}
		}
	}
	return list;
}

function bridged(css) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mori-browser-'));
	const file = path.join(root, 'index.css');
	fs.writeFileSync(file, css, 'utf8');
	bridge.apply(file, TEMPLATE);
	return fs.readFileSync(file, 'utf8');
}

const PAGE = `
<body>
	<div id="primary" class="mori-button-primary">primary</div>
	<div id="accent" class="bg-cline">accent</div>
	<div id="editor" style="background: var(--vscode-editor-background); color: var(--vscode-editor-foreground)">editor</div>
	<div id="muted" style="color: var(--vscode-descriptionForeground)">muted</div>
	<div id="gradient" class="bg-gradient-to-b">gradient</div>
	<div id="fade" class="bg-linear-to-r">fade</div>
	<div id="inline" style="background: linear-gradient(to bottom, red, blue)">inline</div>
	<div id="masked" style="-webkit-mask-image: linear-gradient(black, transparent); mask-image: linear-gradient(black, transparent)">masked</div>
	<div id="welcome" class="mori-welcome">welcome</div>
	<span id="shimmer" class="animate-shimmer bg-clip-text text-transparent">thinking</span>
</body>`;

// --- Harness ----------------------------------------------------------------
const { before, after } = test;

const chrome = findChrome();
let puppeteer = null;
try {
	puppeteer = require('puppeteer-core');
} catch {
	// optional dev dependency
}
const skip = chrome && puppeteer ? false : 'Chrome/Chromium or puppeteer-core not available (set CHROME_PATH)';

let browser = null;
before(async () => {
	if (!skip) {
		browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
	}
});
after(async () => {
	if (browser) {
		await browser.close();
	}
});

// Mozg animates colors (e.g. `transition: background-color .12s` on buttons).
// A theme switch right before a read would otherwise be caught mid-transition
// and report the old color, so the test page disables transitions. The bridge
// itself is not involved.
const NO_MOTION = '*,*::before,*::after{transition:none!important;animation:none!important}';

async function open(css) {
	const page = await browser.newPage();
	await page.setContent(
		`<!doctype html><html><head><style>${css}</style><style>${NO_MOTION}</style></head>${PAGE}</html>`
	);
	return page;
}

/** Does what VS Code does to a webview: --vscode-* on <html>, dots become hyphens. */
async function applyTheme(page, colors) {
	await page.evaluate((vars) => {
		const style = document.documentElement.style;
		for (let i = style.length - 1; i >= 0; i--) {
			if (style[i].startsWith('--vscode-')) {
				style.removeProperty(style[i]);
			}
		}
		for (const [key, value] of Object.entries(vars)) {
			style.setProperty(`--vscode-${key.replace(/\./g, '-')}`, value);
		}
	}, colors);
}

/** Lets the browser normalize a color (hex, alpha, ...) to its computed form. */
function normalize(page, value) {
	return page.evaluate((v) => {
		const probe = document.createElement('div');
		probe.style.color = v;
		document.body.appendChild(probe);
		const computed = getComputedStyle(probe).color;
		probe.remove();
		return computed;
	}, value);
}

function snapshot(page) {
	return page.evaluate(() => {
		const read = (el) => {
			const cs = getComputedStyle(el);
			return {
				color: cs.color,
				bg: cs.backgroundColor,
				image: cs.backgroundImage,
				mask: cs.maskImage || cs.webkitMaskImage || 'none',
			};
		};
		const out = { body: read(document.body) };
		for (const id of ['primary', 'accent', 'editor', 'muted', 'gradient', 'fade', 'inline', 'masked', 'welcome', 'shimmer']) {
			out[id] = read(document.getElementById(id));
		}
		return out;
	});
}

async function assertFollowsTheme(page, name, colors, label) {
	const s = await snapshot(page);
	const pairs = [
		['body background = sideBar.background', s.body.bg, colors['sideBar.background']],
		['primary button = button.background', s.primary.bg, colors['button.background']],
		['primary button text = button.foreground', s.primary.color, colors['button.foreground']],
		['accent utility = button.background', s.accent.bg, colors['button.background']],
		['editor surface = editor.background', s.editor.bg, colors['editor.background']],
		['editor text = editor.foreground', s.editor.color, colors['editor.foreground']],
		['muted text = descriptionForeground', s.muted.color, colors.descriptionForeground],
		['shimmer text = foreground', s.shimmer.color, colors.foreground],
		['welcome background = sideBar.background', s.welcome.bg, colors['sideBar.background']],
	];

	let asserted = 0;
	for (const [what, actual, expected] of pairs) {
		if (expected === undefined) {
			continue; // the theme does not define this color
		}
		assert.equal(actual, await normalize(page, expected), `${name} / ${label}: ${what}`);
		asserted += 1;
	}
	assert.ok(asserted >= 7, `${name} / ${label}: only ${asserted} colors could be compared`);
	return s;
}

// --- Tests ------------------------------------------------------------------
for (const sheet of stylesheets()) {
	const css = bridged(sheet.css);

	for (const [themeName, colors] of Object.entries(THEMES)) {
		test(`[${sheet.name}] bridged Mozg follows "${themeName}"`, { skip }, async () => {
			const page = await open(css);
			try {
				await applyTheme(page, colors);
				await assertFollowsTheme(page, themeName, colors, sheet.name);
			} finally {
				await page.close();
			}
		});
	}

	test(`[${sheet.name}] a theme switch is picked up live, without re-applying`, { skip }, async () => {
		const page = await open(css);
		try {
			const names = Object.keys(THEMES);
			const seen = [];
			for (const name of [...names, names[0]]) {
				await applyTheme(page, THEMES[name]);
				seen.push((await assertFollowsTheme(page, name, THEMES[name], sheet.name)).primary.bg);
			}
			assert.notEqual(seen[0], seen[1], 'switching themes changes the Mozg accent');
			assert.equal(seen[0], seen[seen.length - 1], 'switching back restores it');
		} finally {
			await page.close();
		}
	});

	test(`[${sheet.name}] gradients are flat, masks are kept`, { skip }, async () => {
		const page = await open(css);
		try {
			await applyTheme(page, THEMES['Dark Modern']);
			const s = await snapshot(page);
			for (const id of ['gradient', 'fade', 'inline', 'welcome', 'shimmer']) {
				assert.equal(s[id].image, 'none', `${id} has no gradient`);
			}
			assert.match(s.masked.mask, /gradient/, 'mask-image (scroll fade) is untouched');
		} finally {
			await page.close();
		}
	});

	test(`[${sheet.name}] control: without the bridge Mozg ignores the theme`, { skip }, async () => {
		const page = await open(sheet.css);
		try {
			await applyTheme(page, THEMES['Dark Modern']);
			const s = await snapshot(page);
			assert.equal(s.primary.bg, 'rgb(255, 106, 26)', 'Mozg orange accent');
			assert.equal(s.body.bg, 'rgb(13, 13, 13)', 'Mozg own background');
			assert.match(s.inline.image, /linear-gradient/, 'inline gradient is present');
			assert.match(s.welcome.image, /gradient/, 'welcome glow is present');
		} finally {
			await page.close();
		}
	});
}

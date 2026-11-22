#!/usr/bin/env node
'use strict';

/**
 * Command-line access to the Mori bridge, for use without VS Code running.
 * The extension does the same on its own; this is for scripts and debugging.
 *
 *   node scripts/bridge-cli.js status [--extensions-dir DIR]
 *   node scripts/bridge-cli.js apply  [--extensions-dir DIR]
 *   node scripts/bridge-cli.js revert [--extensions-dir DIR]
 *
 * Default directory: ~/.vscode/extensions. Exit codes: 0 ok, 1 error,
 * 2 nothing could be changed (no Mozg found / unsupported stylesheet).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const bridge = require('../lib/bridge');

const TEMPLATE = path.join(__dirname, '..', 'lib', 'bridge.template.css');

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

const NOTES = {
	none: 'bridge not applied',
	legacy: 'old 1.x neutral patch present (apply replaces it)',
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

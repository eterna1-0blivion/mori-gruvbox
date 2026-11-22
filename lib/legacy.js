'use strict';

/**
 * Traces of earlier incarnations of this project.
 *
 * Before this was an extension, a PowerShell script (and later the 1.x
 * releases of this repository) patched Mozg's stylesheet with a fixed gray
 * palette, wrapped in the markers below, and the very first version also
 * asked to add a `"[Gruvbox Dark Hard]": { workbench.colorCustomizations }`
 * block to settings.json.
 *
 * The extension no longer produces any of that. The only thing still handled
 * here is the stylesheet block: if someone applied the old script, the bridge
 * must cut that block out first, otherwise the pristine backup (`index.css.orig`)
 * would contain it.
 *
 * What that old version was, and how to undo the settings.json part by hand:
 * https://github.com/eterna1-0blivion/mori-gruvbox/tree/d31a63d
 * (look at README.md and scripts/install-mozg-theme.ps1 in that commit).
 */

const LEGACY_BLOCKS = [
	{
		begin: '/* ===== MORI NEUTRAL THEME BEGIN',
		end: '/* ===== MORI NEUTRAL THEME END ===== */',
	},
];

module.exports = { LEGACY_BLOCKS };

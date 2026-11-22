#!/usr/bin/env node
/**
 * Снимает цвета встроенной темы VS Code "Dark Modern" в upstream/dark-modern.json.
 *
 * Dark Modern собирается из цепочки include: dark_modern -> dark_plus -> dark_vs.
 * Здесь цепочка разворачивается в плоский список цветов, чтобы сборка темы
 * не зависела от установленного VS Code (и работала в CI).
 *
 * Запуск (пример для Windows):
 *   node scripts/vendor-dark-modern.mjs "D:\Programs\VS Code\<hash>\resources\app"
 *
 * Исходник темы: https://github.com/microsoft/vscode (MIT, (c) Microsoft Corporation).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appDir = process.argv[2];

if (!appDir) {
  console.error('Использование: node scripts/vendor-dark-modern.mjs <путь к resources/app>');
  process.exit(1);
}

const themesDir = join(appDir, 'extensions', 'theme-defaults', 'themes');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));

function resolveColors(fileName) {
  const theme = readJson(join(themesDir, fileName));
  const base = theme.include ? resolveColors(theme.include) : {};
  return { ...base, ...(theme.colors ?? {}) };
}

const colors = resolveColors('dark_modern.json');
const sorted = Object.fromEntries(Object.keys(colors).sort().map((key) => [key, colors[key]]));
const product = readJson(join(appDir, 'product.json'));

const output = {
  _source: 'VS Code built-in theme "Dark Modern" (dark_modern -> dark_plus -> dark_vs), colors only',
  _vscodeVersion: product.version,
  _license: 'MIT, Copyright (c) 2015 - present Microsoft Corporation (see upstream/LICENSE-vscode.txt)',
  colors: sorted,
};

const target = join(ROOT, 'upstream', 'dark-modern.json');
writeFileSync(target, JSON.stringify(output, null, '\t') + '\n', 'utf8');
console.log(`✓ ${target}`);
console.log(`  VS Code ${product.version}, цветов: ${Object.keys(sorted).length}`);

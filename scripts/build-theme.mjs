#!/usr/bin/env node
/**
 * Собирает тему Mori Gruvbox из двух источников:
 *
 *   upstream/gruvbox-dark-hard.json  - оригинальная Gruvbox Dark Hard (MIT, © 2017 JD)
 *   src/overrides.json               - нейтральные цвета интерфейса (наш слой)
 *
 * Токены подсветки кода (tokenColors / semanticTokenColors) остаются от Gruvbox
 * без изменений; подменяется только UI-хром (colors), чтобы убрать цветные
 * акценты в панелях, вкладках, бейджах, кнопках и чате.
 *
 * Запуск: node scripts/build-theme.mjs [--check]
 *   --check   только проверить, что themes/ в актуальном состоянии (для CI)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UPSTREAM = join(ROOT, 'upstream', 'gruvbox-dark-hard.json');
const OVERRIDES = join(ROOT, 'src', 'overrides.json');
const OUT_DIR = join(ROOT, 'themes');
const OUT = join(OUT_DIR, 'mori-gruvbox-dark-hard.json');

const THEME_NAME = 'Mori Gruvbox Dark Hard';

const checkOnly = process.argv.includes('--check');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));

/** Цветовые ключи, которые VS Code понимает в theme.colors. */
const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const fail = (message) => {
  console.error(`\u001b[31m✗ ${message}\u001b[0m`);
  process.exit(1);
};

// --- Чтение источников -------------------------------------------------------
let upstream;
let overrides;

try {
  upstream = readJson(UPSTREAM);
} catch (error) {
  fail(`не удалось прочитать ${UPSTREAM}: ${error.message}`);
}

try {
  overrides = readJson(OVERRIDES);
} catch (error) {
  fail(`не удалось прочитать ${OVERRIDES}: ${error.message}`);
}

if (!upstream.colors || typeof upstream.colors !== 'object') {
  fail('в upstream-теме отсутствует объект "colors"');
}

if (typeof upstream.tokenColors === 'undefined') {
  fail('в upstream-теме отсутствует "tokenColors" - похоже, это не файл темы');
}

// --- Слияние ----------------------------------------------------------------
const colors = { ...upstream.colors };

let added = 0;
let replaced = 0;

for (const [key, value] of Object.entries(overrides)) {
  if (typeof value !== 'string') {
    fail(`значение для "${key}" должно быть строкой, получено ${typeof value}`);
  }
  if (!HEX_RE.test(value)) {
    fail(`некорректный цвет для "${key}": "${value}" (ожидался #RGB / #RGBA / #RRGGBB / #RRGGBBAA)`);
  }
  if (Object.prototype.hasOwnProperty.call(colors, key)) {
    replaced += 1;
  } else {
    added += 1;
  }
  colors[key] = value;
}

// Детерминированный порядок ключей - чтобы диффы в git были осмысленными.
const sortedColors = Object.fromEntries(
  Object.keys(colors)
    .sort()
    .map((key) => [key, colors[key]])
);

const theme = {
  $schema: 'vscode://schemas/color-theme',
  name: THEME_NAME,
  type: upstream.type ?? 'dark',
  semanticHighlighting: upstream.semanticHighlighting ?? true,
  tokenColors: upstream.tokenColors,
  colors: sortedColors,
};

if (upstream.semanticTokenColors) {
  theme.semanticTokenColors = upstream.semanticTokenColors;
}

const json = JSON.stringify(theme, null, '\t') + '\n';

// --- Запись / проверка ------------------------------------------------------
if (checkOnly) {
  let current = null;
  try {
    current = readFileSync(OUT, 'utf8');
  } catch {
    fail(`файл темы отсутствует: ${OUT}. Запустите: node scripts/build-theme.mjs`);
  }
  if (current !== json) {
    fail('themes/ отличается от результата сборки. Запустите: node scripts/build-theme.mjs');
  }
  console.log('\u001b[32m✓ тема актуальна\u001b[0m');
} else {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, json, 'utf8');
  console.log(`\u001b[32m✓ собрано:\u001b[0m ${OUT}`);
}

console.log(
  `  upstream: ${Object.keys(upstream.colors).length} цветов, ` +
    `${upstream.tokenColors.length} правил токенов`
);
console.log(`  наш слой: ${Object.keys(overrides).length} цветов (переопределено ${replaced}, добавлено ${added})`);
console.log(`  итог:     ${Object.keys(sortedColors).length} цветов`);

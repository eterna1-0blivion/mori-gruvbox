#!/usr/bin/env node
/**
 * Собирает авторскую тему "Mori Gruvbox":
 *
 *   интерфейс  - цвета встроенной темы VS Code "Dark Modern"
 *                (upstream/dark-modern.json);
 *   акценты    - Gruvbox Dark Hard (src/accents.json): фокус, кнопки, бейджи,
 *                ссылки, выделение, git-метки и т. п.;
 *   код        - tokenColors и semanticTokenColors Gruvbox Dark Hard
 *                (upstream/gruvbox-dark-hard.json) без изменений.
 *
 * Цвета, которых нет в Dark Modern, берутся из Gruvbox, но только не сплошные
 * фоны и рамки (#1d2021 и подобные): они выбивались бы из серой палитры
 * интерфейса, поэтому для них VS Code использует собственные значения.
 *
 * Запуск: node scripts/build-theme.mjs [--check]
 *   --check   только проверить, что themes/ актуальна (для CI)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GRUVBOX = join(ROOT, 'upstream', 'gruvbox-dark-hard.json');
const DARK_MODERN = join(ROOT, 'upstream', 'dark-modern.json');
const ACCENTS = join(ROOT, 'src', 'accents.json');
const OUT_DIR = join(ROOT, 'themes');
const OUT = join(OUT_DIR, 'mori-gruvbox.json');

const THEME_NAME = 'Mori Gruvbox';
const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const SOLID_SURFACE_RE = /(background|border)$/i;
const SOLID_HEX_RE = /^#[0-9a-fA-F]{6}$/;

const checkOnly = process.argv.includes('--check');

const fail = (message) => {
  console.error(`\u001b[31m✗ ${message}\u001b[0m`);
  process.exit(1);
};

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    return fail(`не удалось прочитать ${path}: ${error.message}`);
  }
};

const gruvbox = readJson(GRUVBOX);
const darkModern = readJson(DARK_MODERN);
const accents = readJson(ACCENTS);

if (!gruvbox.colors || gruvbox.tokenColors === undefined) {
  fail('upstream/gruvbox-dark-hard.json не похож на файл темы');
}
if (!darkModern.colors) {
  fail('upstream/dark-modern.json не содержит "colors"');
}

for (const [key, value] of Object.entries(accents)) {
  if (typeof value !== 'string' || !HEX_RE.test(value)) {
    fail(`src/accents.json: некорректный цвет для "${key}": ${JSON.stringify(value)}`);
  }
}

// --- Слияние ----------------------------------------------------------------
const isSolidSurface = (key, value) =>
  SOLID_SURFACE_RE.test(key) && typeof value === 'string' && SOLID_HEX_RE.test(value);

const fromGruvbox = {};
let skippedSurfaces = 0;
for (const [key, value] of Object.entries(gruvbox.colors)) {
  if (Object.prototype.hasOwnProperty.call(darkModern.colors, key)) {
    continue; // интерфейс определяет Dark Modern
  }
  if (isSolidSurface(key, value)) {
    skippedSurfaces += 1;
    continue;
  }
  fromGruvbox[key] = value;
}

const colors = { ...fromGruvbox, ...darkModern.colors, ...accents };

const sortedColors = Object.fromEntries(
  Object.keys(colors)
    .sort()
    .map((key) => [key, colors[key]])
);

const theme = {
  $schema: 'vscode://schemas/color-theme',
  name: THEME_NAME,
  type: 'dark',
  semanticHighlighting: gruvbox.semanticHighlighting ?? true,
  tokenColors: gruvbox.tokenColors,
  colors: sortedColors,
};

if (gruvbox.semanticTokenColors) {
  theme.semanticTokenColors = gruvbox.semanticTokenColors;
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

console.log(`  Dark Modern:  ${Object.keys(darkModern.colors).length} цветов (интерфейс)`);
console.log(`  Gruvbox:      ${Object.keys(fromGruvbox).length} цветов добавлено, ${skippedSurfaces} сплошных фонов/рамок пропущено`);
console.log(`  акценты:      ${Object.keys(accents).length} (src/accents.json)`);
console.log(`  итог:         ${Object.keys(sortedColors).length} цветов, ${gruvbox.tokenColors.length} правил токенов`);

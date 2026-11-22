#!/usr/bin/env node
/**
 * Генерирует assets/icon.png: скруглённый квадрат Mozg, слева оранжевый,
 * справа белый, с переходом "диффузией" - без градиента.
 *
 * Форма - точный контур знака Mozg (путь из mori-code.svg расширения Mozg,
 * без буквы). Переход - упорядоченный дизеринг: каждой клетке сетки сопоставлен
 * порог из матрицы Байера, цвет выбирается сравнением порога с положением
 * клетки по горизонтали. Получается шахматный узор, плотность которого плавно
 * меняется от сплошного оранжевого к сплошному белому; промежуточных цветов
 * нет, только два.
 *
 * Без зависимостей: PNG собирается вручную (zlib из Node).
 *
 * Запуск: node scripts/make-icon.mjs [--out assets/icon.png]
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SIZE = 256; // итоговый размер
const SS = 4; // суперсэмплинг для гладких краёв формы
const CELL = 8; // размер "пикселя" шахматного перехода на итоговой иконке
const ORANGE = [0xff, 0x6a, 0x1a];
const WHITE = [0xff, 0xff, 0xff];

// Зона перехода: доля ширины иконки, в которой шахматный узор смешивает цвета.
const BLEND_FROM = 0.3;
const BLEND_TO = 0.7;

// Знак Mozg в системе координат viewBox="-48 -48 773 773" (как в mori-code.svg).
const VIEWBOX = { x: -48, y: -48, size: 773 };
const SQUARE_PATH =
  'M72.5412 10.9765C148.85 5.79586 567.055 0.353679 611.368 21.1606C628.269 29.1002 642.806 48.7764 648.586 66.2505C661.411 105.038 657.488 501.406 653.353 565.32C652.256 582.398 651.185 602.968 643.228 618.308C631.23 641.443 609.174 652.361 585.465 660.175C514.776 667.777 437.952 662.47 366.622 662.562C280.416 662.68 191.35 667.296 105.439 661.811C86.0917 660.58 62.374 658.36 44.7143 649.906C28.0334 641.924 15.453 623.876 9.20923 606.959C-3.84359 571.564 -2.90695 86.4161 11.2934 57.3574C23.9834 31.4036 46.3343 19.9202 72.5412 10.9765Z';

// Матрица Байера 4x4 (упорядоченный дизеринг), значения 0..15.
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

// --- Геометрия -------------------------------------------------------------------

/** Путь из команд M, C, Z (абсолютные) -> полилиния. */
function flatten(d) {
  const tokens = d.match(/[MCZ]|-?\d*\.?\d+(?:e-?\d+)?/gi);
  const points = [];
  let i = 0;
  let cur = [0, 0];
  const num = () => parseFloat(tokens[i++]);
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'M') {
      cur = [num(), num()];
      points.push(cur);
    } else if (cmd === 'C') {
      while (i < tokens.length && !/^[A-Za-z]$/.test(tokens[i])) {
        const p1 = [num(), num()];
        const p2 = [num(), num()];
        const p3 = [num(), num()];
        const steps = 24;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const u = 1 - t;
          points.push([
            u * u * u * cur[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * cur[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
          ]);
        }
        cur = p3;
      }
    }
    // 'Z': замыкание подразумевается
  }
  return points;
}

/** Точка внутри полигона (правило чётности)? */
function inside(poly, x, y) {
  let hit = false;
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const [xa, ya] = poly[a];
    const [xb, yb] = poly[b];
    if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) {
      hit = !hit;
    }
  }
  return hit;
}

/** Цвет клетки сетки: оранжевый или белый, по порогу Байера. */
function pickColor(px, py) {
  const cx = Math.floor(px / CELL);
  const cy = Math.floor(py / CELL);
  const t = (cx * CELL + CELL / 2) / SIZE; // положение клетки слева направо, 0..1
  const k = Math.min(1, Math.max(0, (t - BLEND_FROM) / (BLEND_TO - BLEND_FROM)));
  const threshold = (BAYER[cy % 4][cx % 4] + 0.5) / 16;
  return k > threshold ? WHITE : ORANGE;
}

// --- Растеризация ----------------------------------------------------------------
const scale = SIZE / VIEWBOX.size;
const shape = flatten(SQUARE_PATH).map(([x, y]) => [(x - VIEWBOX.x) * scale, (y - VIEWBOX.y) * scale]);

// Кромка: на светлом фоне белая половина иначе исчезает, и знак выглядит
// обрезанным. Тонкая серая рамка рисуется только по белым клеткам, поэтому
// оранжевая половина остаётся чистой. Внутренний контур - тот же знак,
// сжатый к центру.
const RIM = 3; // толщина, px
const RIM_COLOR = [0x9a, 0x9a, 0x9a];
const xs = shape.map((p) => p[0]);
const ys = shape.map((p) => p[1]);
const mid = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
const shrink = 1 - (2 * RIM) / (Math.max(...xs) - Math.min(...xs));
const inner = shape.map(([x, y]) => [mid[0] + (x - mid[0]) * shrink, mid[1] + (y - mid[1]) * shrink]);

const rgba = Buffer.alloc(SIZE * SIZE * 4);
for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let covered = 0;
    let core = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const x = px + (sx + 0.5) / SS;
        const y = py + (sy + 0.5) / SS;
        if (inside(shape, x, y)) {
          covered++;
          if (inside(inner, x, y)) {
            core++;
          }
        }
      }
    }
    let [r, g, b] = pickColor(px, py);
    if (r === WHITE[0] && g === WHITE[1] && b === WHITE[2] && covered > 0) {
      // доля кромки среди покрытых подпикселей
      const rim = (covered - core) / covered;
      r = Math.round(r + (RIM_COLOR[0] - r) * rim);
      g = Math.round(g + (RIM_COLOR[1] - g) * rim);
      b = Math.round(b + (RIM_COLOR[2] - b) * rim);
    }
    const o = (py * SIZE + px) * 4;
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = Math.round((covered / (SS * SS)) * 255);
  }
}

// --- PNG (RGBA, 8 бит) -----------------------------------------------------------
const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // глубина цвета
ihdr[9] = 6; // RGBA

const stride = SIZE * 4 + 1;
const raw = Buffer.alloc(stride * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * stride] = 0; // фильтр: none
  rgba.copy(raw, y * stride + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const outIndex = process.argv.indexOf('--out');
const out = resolve(ROOT, outIndex > -1 ? process.argv[outIndex + 1] : join('assets', 'icon.png'));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`✓ ${out} (${png.length} байт, ${SIZE}x${SIZE}, клетка ${CELL}px)`);


#!/usr/bin/env node
// 生成 shields 风格的静态 SVG 徽章。
// 目的：README 里的徽章不依赖 img.shields.io（该域名在部分网络下不可达），
// 改为由本脚本生成本地 / Release 附件托管。
// 用法:
//   node scripts/make_badge.mjs <label> <message> <out> [color]
// 例:
//   node scripts/make_badge.mjs license MIT .github/badges/license.svg blue
//   node scripts/make_badge.mjs release v2.1.0 dist/release.svg blue

import { mkdir, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COLORS = {
  blue: '#007ec6',
  green: '#4c1',
  brightgreen: '#4c1',
  yellow: '#dfb317',
  orange: '#fe7d37',
  red: '#e05d44',
  lightgrey: '#9f9f9f',
  grey: '#555',
};

// Verdana 11px 的近似字符宽度（单位 px，shields 官方用同一字体渲染）。
const WIDTHS = {
  ' ': 4, '!': 4, '"': 5, '#': 7, '$': 7, '%': 11, '&': 9, "'": 3,
  '(': 5, ')': 5, '*': 7, '+': 7, ',': 4, '-': 5, '.': 4, '/': 4,
  ':': 4, ';': 4, '<': 7, '=': 7, '>': 7, '?': 6, '@': 11, '_': 7,
  '0': 7, '1': 7, '2': 7, '3': 7, '4': 7, '5': 7, '6': 7, '7': 7, '8': 7, '9': 7,
  A: 8, B: 8, C: 8, D: 8, E: 7, F: 7, G: 8, H: 8, I: 4, J: 5, K: 7, L: 6,
  M: 9, N: 8, O: 8, P: 7, Q: 8, R: 7, S: 7, T: 7, U: 8, V: 8, W: 10,
  X: 7, Y: 7, Z: 7,
  a: 7, b: 7, c: 6, d: 7, e: 7, f: 4, g: 7, h: 7, i: 3, j: 4, k: 6, l: 3,
  m: 11, n: 7, o: 7, p: 7, q: 7, r: 4, s: 6, t: 4, u: 7, v: 7, w: 10,
  x: 6, y: 7, z: 6,
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const textWidth = (text) => [...String(text)].reduce((sum, ch) => sum + (WIDTHS[ch] ?? 7), 0);
const boxWidth = (text) => textWidth(text) + 10;

export function renderBadge(label, message, color = 'blue') {
  const fill = COLORS[color] ?? color;
  const labelWidth = boxWidth(label);
  const messageWidth = boxWidth(message);
  const width = labelWidth + messageWidth;
  const aria = `${label}: ${message}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${esc(aria)}"><title>${esc(aria)}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${width}" height="20" rx="3"/></clipPath><g clip-path="url(#r)"><rect width="${labelWidth}" height="20" fill="#555"/><rect x="${labelWidth}" width="${messageWidth}" height="20" fill="${fill}"/><rect width="${width}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110"><g transform="scale(.1)"><text x="${labelWidth * 5}" y="140">${esc(label)}</text></g><g transform="scale(.1)"><text x="${(labelWidth + messageWidth / 2) * 10}" y="140">${esc(message)}</text></g></g></svg>\n`;
}

async function main() {
  const [label, message, out, color = 'blue'] = process.argv.slice(2);
  if (!label || !message || !out) {
    console.error('用法: node scripts/make_badge.mjs <label> <message> <out.svg> [color]');
    process.exit(2);
  }
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(out, renderBadge(label, message, color), 'utf8');
  console.log(`wrote ${path.relative(process.cwd(), path.resolve(out))}`);
}

// Node resolves the main module through symlinks while process.argv keeps the
// invoked path (macOS /tmp -> /private/tmp, /var -> /private/var, or an
// installed skill directory behind a link). A raw compare silently skipped
// main() and exited 0 without writing anything, so compare both realpaths.
function invokedAsMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch { return false; }
}
if (invokedAsMain()) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

#!/usr/bin/env node
// 一条命令完成：JSON 规格 -> 标准 HTML -> PNG 全页截图
// 用法: node render_bigbang.mjs <spec.json> <out.png> [--width 1600] [--scale 2] [--forbid 答案指纹]...

import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildHtmlWithReport } from './build_bigbang.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [, , specPath, pngPath, ...rest] = process.argv;
if (!specPath || !pngPath) {
  console.error('用法: node render_bigbang.mjs <spec.json> <out.png> [--width 1600] [--scale 2] [--forbid 答案指纹]...');
  process.exit(2);
}

const forbidTerms = [];
const screenshotArgs = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--forbid' && rest[i + 1]) {
    forbidTerms.push(rest[++i]);
  } else {
    screenshotArgs.push(rest[i]);
  }
}

let spec;
try {
  spec = JSON.parse(await readFile(specPath, 'utf8'));
} catch (err) {
  console.error(JSON.stringify({ ok: false, status: 'invalid-spec-json', error: err.message }));
  process.exit(2);
}

let built;
try {
  built = buildHtmlWithReport(spec, {
    mermaidSrc: process.env.SHENTI_MERMAID_SRC || pathToFileURL(path.join(here, 'vendor', 'mermaid.min.js')).href,
    forbidTerms,
  });
} catch (err) {
  console.error(JSON.stringify({ ok: false, status: 'invalid-spec', error: err.message, warnings: err.warnings ?? [] }));
  process.exit(2);
}

const htmlPath = specPath.replace(/\.json$/i, '') + '.html';
await writeFile(htmlPath, built.html);

const res = spawnSync(process.execPath, [path.join(here, 'screenshot_html.mjs'), htmlPath, pngPath, ...screenshotArgs], {
  stdio: 'inherit',
});
if (res.status !== 0) {
  console.error(JSON.stringify({ ok: false, status: 'screenshot-failed', html: htmlPath, warnings: built.warnings }));
}
process.exit(res.status ?? 1);

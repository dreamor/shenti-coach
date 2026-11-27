#!/usr/bin/env node
// 仓库自检：SKILL.md 元数据、JSON、JS 语法、绝对路径、示例规格与结构闸门。
// 用法: node scripts/lint.mjs

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const failures = [];
const passes = [];

function fail(name, detail = '') {
  failures.push({ name, detail });
  console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
}

function pass(name) {
  passes.push(name);
  console.log(`PASS ${name}`);
}

function check(condition, name, detail = '') {
  if (condition) pass(name);
  else fail(name, detail);
}

const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');
const read = (file) => readFile(path.join(ROOT, file), 'utf8');
const runNode = (args, options = {}) => spawnSync(process.execPath, args, {
  cwd: ROOT,
  encoding: 'utf8',
  ...options,
});

async function walk(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (['.git', 'node_modules', 'dist'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

// 1. 必需文件
const required = [
  'SKILL.md',
  'README.md',
  'LICENSE',
  'package.json',
  'references/reading-checklist.md',
  'references/subject-libs.md',
  'scripts/check_output.mjs',
  'scripts/render_bigbang.mjs',
  'scripts/vendor/mermaid.min.js',
  'examples/demo-spec.json',
  'examples/demo-bigbang.png',
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
];
const missing = required.filter((file) => !existsSync(path.join(ROOT, file)));
check(missing.length === 0, '必需文件齐全', missing.join(', '));

// 2. package.json
let pkg = null;
try {
  pkg = JSON.parse(await read('package.json'));
  pass('package.json 可解析');
} catch (err) {
  fail('package.json 可解析', err.message);
}

if (pkg) {
  check(pkg.name === 'shenti-coach', 'package.json name', pkg.name);
  check(/^\d+\.\d+\.\d+$/.test(pkg.version ?? ''), 'package.json version 为语义化版本', pkg.version);
  check(pkg.license === 'MIT', 'package.json license', pkg.license);
  check(pkg.engines?.node === '>=22', 'Node 版本要求', pkg.engines?.node);
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
check(nodeMajor >= 22 && typeof WebSocket !== 'undefined', '运行环境满足 Node.js ≥ 22 + WebSocket', process.versions.node);

// 3. SKILL.md frontmatter
const skill = await read('SKILL.md');
const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
check(Boolean(frontmatter), 'SKILL.md frontmatter');

if (frontmatter) {
  const body = frontmatter[1];
  const name = body.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = body.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  const version = body.match(/^\s{2}version:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
  const updated = body.match(/^\s{2}updated:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();

  check(name === pkg?.name, 'SKILL.md name 与 package.json 一致', `${name} / ${pkg?.name}`);
  check(/^[a-z0-9-]{1,64}$/.test(name ?? ''), 'SKILL.md name 符合规范', name);
  check(Boolean(description) && description.length <= 1024, 'SKILL.md description 长度 ≤ 1024', `${description?.length ?? 0} 字符`);
  check(version === pkg?.version, 'SKILL.md 版本与 package.json 一致', `${version} / ${pkg?.version}`);
  check(/^\d{4}-\d{2}-\d{2}$/.test(updated ?? ''), 'SKILL.md updated 日期格式', updated);
  check(skill.split(/\r?\n/).length <= 500, 'SKILL.md 行数 ≤ 500', `${skill.split(/\r?\n/).length} 行`);
}

// 4. 所有 JSON 可解析
const allFiles = await walk(ROOT);
const jsonFiles = allFiles.filter((file) => file.endsWith('.json'));
const badJson = [];
for (const file of jsonFiles) {
  try {
    JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    badJson.push(`${rel(file)} (${err.message})`);
  }
}
check(badJson.length === 0, `JSON 可解析（${jsonFiles.length} 个）`, badJson.join('; '));

// 5. 所有 .mjs 语法
const jsFiles = allFiles.filter((file) => file.endsWith('.mjs'));
const badJs = [];
for (const file of jsFiles) {
  const result = runNode(['--check', file]);
  if (result.status !== 0) badJs.push(`${rel(file)} (${(result.stderr ?? '').trim().slice(0, 200)})`);
}
check(badJs.length === 0, `JavaScript 语法（${jsFiles.length} 个 .mjs）`, badJs.join('; '));

// 6. 禁止提交本机绝对路径
const textFiles = allFiles.filter((file) => /\.(md|mjs|json|ya?ml|sh)$/.test(file));
const badPaths = [];
for (const file of textFiles) {
  const text = await readFile(file, 'utf8');
  if (/\/Users\/[A-Za-z0-9._-]+/.test(text) || /[A-Za-z]:\\Users\\/.test(text)) badPaths.push(rel(file));
}
check(badPaths.length === 0, '无本机绝对路径', badPaths.join(', '));

// 7. 示例规格一致性
try {
  const spec = JSON.parse(await read('examples/demo-spec.json'));
  const nodeIds = new Set((spec.nodes ?? []).map((node) => node.id));
  const duplicateIds = (spec.nodes ?? []).length !== nodeIds.size;
  const danglingEdges = (spec.edges ?? []).filter((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to));
  const unlabeledEdges = (spec.edges ?? []).filter((edge) => !edge.label);
  const badGroups = (spec.groups ?? []).filter((group) => (group.nodes ?? []).some((id) => !nodeIds.has(id)));

  check(Boolean(spec.title) && Array.isArray(spec.nodes) && spec.nodes.length > 0, '示例规格含标题与节点');
  check(!duplicateIds, '示例规格节点 id 唯一');
  check(danglingEdges.length === 0, '示例规格连线引用有效', danglingEdges.map((edge) => `${edge.from}->${edge.to}`).join(', '));
  check(unlabeledEdges.length === 0, '示例规格连线都有触发词');
  check(badGroups.length === 0, '示例规格分组引用有效');
} catch (err) {
  fail('示例规格一致性', err.message);
}

// 8. 示例图可构建（不依赖 Chrome）
await mkdir(DIST, { recursive: true });
const lintHtml = path.join(DIST, 'lint-demo.html');
const build = runNode(['scripts/build_bigbang.mjs', 'examples/demo-spec.json', lintHtml]);
check(build.status === 0 && existsSync(lintHtml), '示例规格可生成 HTML', (build.stderr ?? '').trim().slice(0, 300));

// 9. 结构闸门示例
const gateArgs = [
  'scripts/check_output.mjs',
  'references/example.md',
  '--type', 'solution',
  '--blanks', '0',
  '--answer-slots', '0',
  '--q-count', '1',
  '--json',
];
const gateRun = runNode(gateArgs);
let gate = null;
try {
  gate = JSON.parse(gateRun.stdout);
} catch {
  // 保持 gate 为 null，下面统一报错。
}
check(gateRun.status === 0 && gate?.pass === true, '结构闸门示例 PASS', (gateRun.stderr ?? '').trim().slice(0, 300));

// 10. 版本记录与示例图
if (pkg?.version) {
  const changelog = await read('references/changelog.md');
  const minor = pkg.version.split('.').slice(0, 2).join('.');
  check(changelog.includes(`## ${minor}`), `版本记录包含 ${minor}`, '');
}

try {
  const png = await stat(path.join(ROOT, 'examples/demo-bigbang.png'));
  check(png.size > 10_000, '示例 PNG 已生成且非空', `${png.size} bytes`);
} catch (err) {
  fail('示例 PNG 已生成且非空', err.message);
}

console.log(`\n${passes.length} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error('shenti-coach lint: FAIL');
  process.exit(1);
}
console.log('shenti-coach lint: PASS');

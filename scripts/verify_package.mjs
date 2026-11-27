#!/usr/bin/env node
// Pure Node package checks; --manifest also consults Git when .git is present.
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBadge } from './make_badge.mjs';

const ROOT_FILES = new Set(['SKILL.md', 'README.md', 'LICENSE', 'package.json']);
const REFERENCE_FILES = new Set([
  'answer-isolation', 'batch-run', 'bigbang-image', 'blindspot-ledger', 'changelog',
  'example', 'experiment-checklist', 'liaoning-textbook-map', 'modes-and-input',
  'question-type-playbooks', 'reading-checklist', 'regression-suite', 'subject-libs',
  'presentation-and-delivery', 'input-boundary',
].map((name) => `references/${name}.md`));
const DIRECTORIES = new Set([
  'assets', 'assets/badges', 'references', 'scripts', 'scripts/lib',
  'scripts/tests', 'scripts/vendor', 'examples',
]);
export const REQUIRED_FILES = [
  ...ROOT_FILES, 'assets/badges/license.svg', 'assets/badges/release.svg',
  'references/reading-checklist.md', 'references/subject-libs.md',
  'references/blindspot-ledger.md', 'references/changelog.md',
  'references/presentation-and-delivery.md', 'references/input-boundary.md',
  'scripts/check_output.mjs', 'scripts/render_bigbang.mjs', 'scripts/ocr.mjs',
  'scripts/present_output.mjs', 'scripts/lib/delivery.mjs',
  'scripts/ocr.swift', 'scripts/make_badge.mjs', 'scripts/package_skill.sh', 'scripts/verify_package.mjs',
  'scripts/training_state.mjs', 'scripts/blindspot_ledger.mjs',
  'scripts/lib/input-boundary.mjs', 'scripts/vendor/mermaid.min.js',
  'scripts/tests/helpers.mjs', 'scripts/tests/package.test.mjs',
  'scripts/tests/output.test.mjs', 'examples/demo-spec.json', 'examples/demo-bigbang.png',
];

// Deliberately narrow, including when repackaging an installed ZIP without Git.
// New asset/fixture formats must be explicitly reviewed here, not copied recursively.
export function isReleaseSourcePath(file) {
  return ROOT_FILES.has(file)
    || REFERENCE_FILES.has(file)
    || /^assets\/badges\/[a-z0-9-]+\.svg$/.test(file)
    || /^scripts\/[a-z0-9_-]+\.mjs$/.test(file)
    || /^scripts\/lib\/[a-z0-9_-]+\.mjs$/.test(file)
    || /^scripts\/tests\/[a-z0-9_-]+\.test\.mjs$/.test(file)
    || ['scripts/tests/helpers.mjs', 'scripts/vendor/mermaid.min.js',
      'scripts/ocr.swift', 'scripts/package_skill.sh',
      'examples/demo-spec.json', 'examples/demo-bigbang.png'].includes(file);
}

function walk(root, relative = '', strict = false, files = []) {
  for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const file = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (DIRECTORIES.has(file)) walk(root, file, strict, files);
      else if (strict) throw new Error(`forbidden package directory: ${file}`);
    } else if (isReleaseSourcePath(file) || (strict && file === 'VERSION')) {
      if (!entry.isFile()) throw new Error(`not a regular source file: ${file}`);
      files.push(file);
    } else if (strict) {
      throw new Error(`forbidden package file (runtime/output or non-source): ${file}`);
    }
  }
  return files.sort();
}

function assertRegularSource(root, file) {
  const parts = file.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const stat = lstatSync(path.join(root, ...parts.slice(0, i)));
    if (stat.isSymbolicLink() || (i < parts.length ? !stat.isDirectory() : !stat.isFile())) {
      throw new Error(`not a regular source path: ${file}`);
    }
  }
}

export function releaseManifest(root) {
  root = path.resolve(root);
  let hasGit = false;
  try { lstatSync(path.join(root, '.git')); hasGit = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let files;
  if (hasGit) {
    // Git failures must fail closed; do not silently switch to copying local data.
    const top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    if (path.resolve(top) !== root) throw new Error('source must be the Git repository root');
    files = execFileSync('git', ['-C', root, 'ls-files', '--cached', '-z'], { encoding: 'utf8' })
      .split('\0').filter(isReleaseSourcePath).sort();
  } else {
    process.stderr.write('package: no .git; only the fixed source allowlist is eligible (new formats require review)\n');
    files = walk(root);
  }
  for (const file of files) assertRegularSource(root, file);
  return [...new Set(files)];
}

export function verifyPackage(root, expectedVersion) {
  root = path.resolve(root);
  const files = walk(root, '', true);
  const missing = [...REQUIRED_FILES, 'VERSION'].filter((file) => !files.includes(file));
  if (missing.length) throw new Error(`missing package files: ${missing.join(', ')}`);
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pkg.name !== 'shenti-coach' || !/^\d+\.\d+\.\d+$/.test(pkg.version ?? '')) {
    throw new Error('invalid package name/version');
  }
  if (pkg.engines?.node !== '>=22' || pkg.scripts?.test !== 'node --test') {
    throw new Error('package must require Node >=22 and use standalone node --test');
  }
  if (Object.keys(pkg.dependencies ?? {}).length || Object.keys(pkg.devDependencies ?? {}).length) {
    throw new Error('package must not introduce npm dependencies');
  }
  const version = readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
  const skill = readFileSync(path.join(root, 'SKILL.md'), 'utf8');
  const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  const name = frontmatter?.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const metadata = frontmatter?.match(/^metadata:\s*\r?\n((?:[ \t]+[^\n]*(?:\n|$))*)/m)?.[1];
  const skillVersion = metadata?.match(/^ {2}version:\s*["']?(\d+\.\d+\.\d+)["']?\s*$/m)?.[1];
  if (name !== pkg.name || version !== pkg.version || skillVersion !== pkg.version
      || (expectedVersion !== undefined && pkg.version !== expectedVersion)) {
    throw new Error(`version/name mismatch: VERSION=${version}, package=${pkg.version}, SKILL=${skillVersion}, expected=${expectedVersion ?? pkg.version}`);
  }
  const badge = readFileSync(path.join(root, 'assets/badges/release.svg'), 'utf8');
  if (badge !== renderBadge('release', `v${pkg.version}`, 'blue')) {
    throw new Error(`release badge must match package version v${pkg.version}`);
  }
  return { ok: true, name: pkg.name, version, files: files.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === '--manifest' && args.length === 2) {
      process.stdout.write(`${releaseManifest(args[1]).join('\0')}\0`);
    } else if (args.length === 1 || (args.length === 3 && args[1] === '--version'
        && /^\d+\.\d+\.\d+$/.test(args[2]))) {
      console.log(JSON.stringify(verifyPackage(args[0], args[2])));
    } else {
      throw new Error('usage: verify_package.mjs <unpacked-skill-dir> [--version X.Y.Z] | --manifest <source-root>');
    }
  } catch (error) {
    console.error(`package verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

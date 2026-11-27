import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { REQUIRED_FILES, isReleaseSourcePath, releaseManifest, verifyPackage } from '../verify_package.mjs';
import { renderBadge } from '../make_badge.mjs';
import { createTempDir, repoRoot } from './helpers.mjs';

const version = '2.3.0';
const pkg = {
  name: 'shenti-coach', version, engines: { node: '>=22' },
  scripts: { test: 'node --test', package: 'bash scripts/package_skill.sh' },
};
function put(root, file, content = 'fixture source\n') {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
}
function fixture(t) {
  const root = path.join(createTempDir(t), 'source');
  for (const file of REQUIRED_FILES) put(root, file);
  put(root, 'package.json', JSON.stringify(pkg));
  put(root, 'SKILL.md', `---\nname: shenti-coach\nmetadata:\n  version: "${version}"\n---\n`);
  put(root, 'VERSION', `${version}\n`);
  put(root, 'assets/badges/release.svg', renderBadge('release', `v${version}`, 'blue'));
  for (const file of ['scripts/package_skill.sh', 'scripts/verify_package.mjs', 'scripts/make_badge.mjs']) {
    copyFileSync(path.join(repoRoot, file), path.join(root, file));
  }
  return root;
}
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  return result.stdout;
}
const available = (command) => spawnSync(command, [command === 'git' ? '--version' : '-v'], { encoding: 'utf8' }).status === 0;
const archiveTools = available('zip') && available('unzip');

// These checks work in the distributed package: no .github or repository .git reads.
test('npm test is standalone; verify retains strict repository lint', () => {
  const config = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(config.scripts.test, 'node --test');
  assert.equal(config.scripts.lint, 'node scripts/lint.mjs');
  assert.equal(config.scripts.verify, 'npm run lint && npm test && npm run package');
  assert.equal(Object.keys(config.dependencies ?? {}).length, 0);
  assert.equal(Object.keys(config.devDependencies ?? {}).length, 0);
});

test('package verifies VERSION/package/SKILL metadata and required layout using Node only', (t) => {
  const root = fixture(t);
  assert.equal(verifyPackage(root, version).version, version);
  assert.throws(() => verifyPackage(root, '9.9.9'), /mismatch/);
  put(root, 'VERSION', '2.2.0\n');
  assert.throws(() => verifyPackage(root), /mismatch/);
  put(root, 'VERSION', `${version}\n`);
  put(root, 'SKILL.md', '---\nname: shenti-coach\nmetadata:\n  version: "2.2.0"\n---\n');
  assert.throws(() => verifyPackage(root), /mismatch/);
  put(root, 'SKILL.md', `---\nname: shenti-coach\nmetadata:\n  version: "${version}"\n---\n`);
  rmSync(path.join(root, 'scripts/ocr.swift'));
  assert.throws(() => verifyPackage(root), /missing package files/);
});

test('release badge must match the package version, including visible text', (t) => {
  const root = fixture(t);
  const file = 'assets/badges/release.svg';
  assert.equal(verifyPackage(root, version).ok, true);
  const oldBadge = renderBadge('release', 'v2.2.0', 'blue');
  put(root, file, oldBadge);
  assert.throws(() => verifyPackage(root), /release badge must match/);
  const stageBadge = path.join(path.dirname(root), 'badge-stage/release.svg');
  run(process.execPath, [path.join(root, 'scripts/make_badge.mjs'), 'release', `v${version}`, stageBadge, 'blue'], root);
  assert.equal(readFileSync(stageBadge, 'utf8'), renderBadge('release', `v${version}`, 'blue'));
  assert.equal(readFileSync(path.join(root, file), 'utf8'), oldBadge, 'stage generation must not change source badge');
  // Updating only accessibility metadata must not hide an obsolete visible badge.
  put(root, file, renderBadge('release', 'v2.2.0', 'blue')
    .replaceAll('release: v2.2.0', `release: v${version}`));
  assert.throws(() => verifyPackage(root), /release badge must match/);
  put(root, file, renderBadge('release', `v${version}`, 'blue'));
  assert.equal(verifyPackage(root).ok, true);
});

test('runtime data, output, hidden directories and dependencies are rejected in unpacked packages', (t) => {
  const root = fixture(t);
  for (const file of [
    '.git/config', '.github/workflows/ci.yml', 'dist/result.json', 'runtime/ledger.json',
    'scripts/ledger.json', 'scripts/tests/student.json', 'references/student-ledger.md',
    'examples/student-answer.md',
    'examples/demo-bigbang.html', 'assets/student.png', 'node_modules/pkg/index.js',
  ]) {
    assert.equal(isReleaseSourcePath(file), false, file);
    put(root, file);
    assert.throws(() => verifyPackage(root), /forbidden package/, file);
    rmSync(path.join(root, file.split('/')[0]), { recursive: true, force: true });
    // Restore required source trees removed above.
    for (const required of REQUIRED_FILES.filter((name) => name.split('/')[0] === file.split('/')[0])) {
      put(root, required);
    }
  }
  put(root, 'package.json', JSON.stringify({ ...pkg, dependencies: { unwanted: '*' } }));
  assert.throws(() => verifyPackage(root), /npm dependencies/);
});

test('source allowlist retains tests/vendor/OCR but drops local runtime and output without Git', (t) => {
  const root = fixture(t);
  put(root, 'runtime/ledger.json', '{"student":"private"}');
  put(root, 'scripts/ledger.json', '{"student":"private"}');
  put(root, 'examples/student-spec.json', '{"student":"private"}');
  put(root, 'references/presentation-and-delivery.md');
  put(root, 'scripts/lib/delivery.mjs');
  const files = releaseManifest(root);
  for (const file of REQUIRED_FILES) assert.ok(files.includes(file), file);
  assert.ok(files.includes('references/presentation-and-delivery.md'));
  assert.ok(files.includes('scripts/lib/delivery.mjs'));
  assert.ok(!files.includes('VERSION'));
  assert.ok(!files.some((file) => /ledger\.json|student-spec/.test(file)));
});

test('symlink source paths cannot escape the package', (t) => {
  const root = fixture(t);
  rmSync(path.join(root, 'scripts/ocr.swift'));
  const outside = path.join(path.dirname(root), 'private.swift');
  writeFileSync(outside, 'private');
  try { symlinkSync(outside, path.join(root, 'scripts/ocr.swift')); }
  catch (error) { if (error.code === 'EPERM') return t.skip('symlink creation unavailable'); throw error; }
  assert.throws(() => releaseManifest(root), /not a regular source/);
  assert.throws(() => verifyPackage(root), /not a regular source/);
});

test('Git manifest includes only tracked fixed-source files and fails closed on broken Git', {
  skip: !available('git') && 'git unavailable',
}, (t) => {
  const root = fixture(t);
  run('git', ['init', '-q'], root);
  run('git', ['add', '.'], root);
  put(root, 'scripts/local_student.mjs', 'private untracked source-shaped data');
  put(root, 'examples/student.json', '{"student":"private"}');
  run('git', ['add', 'examples/student.json'], root);
  assert.ok(!releaseManifest(root).includes('scripts/local_student.mjs'));
  assert.ok(!releaseManifest(root).includes('examples/student.json'));
  rmSync(path.join(root, '.git'), { recursive: true });
  put(root, '.git', 'gitdir: /nonexistent-shenti-package-fixture\n');
  assert.throws(() => releaseManifest(root));
});

test('fresh ZIP handles relative output, SHA, Git-free repackaging and stale entry removal', {
  skip: !archiveTools && 'zip/unzip unavailable (CI runs this archive regression)',
}, (t) => {
  const root = fixture(t);
  const output = path.join(root, 'release output');
  const oldBadge = renderBadge('release', 'v2.2.0', 'blue');
  put(root, 'assets/badges/release.svg', oldBadge);
  mkdirSync(output);
  // Seed an old archive with a file that must never survive a fresh build.
  put(root, 'stale-runtime.json', 'private');
  run('zip', ['-q', path.join(output, 'skill.zip'), 'stale-runtime.json'], root);
  put(root, 'scripts/temporary_tool.mjs', '// disposable source');
  run('bash', ['scripts/package_skill.sh', 'release output'], root);
  let files = run('unzip', ['-Z1', path.join(output, 'skill.zip')], root);
  assert.ok(!files.includes('stale-runtime.json'));
  assert.ok(files.includes('shenti-coach/scripts/temporary_tool.mjs'));
  rmSync(path.join(root, 'scripts/temporary_tool.mjs'));
  run('bash', ['scripts/package_skill.sh', 'release output'], root);
  files = run('unzip', ['-Z1', path.join(output, 'skill.zip')], root);
  assert.ok(!files.includes('temporary_tool.mjs'));
  const archive = readFileSync(path.join(output, 'skill.zip'));
  const digest = createHash('sha256').update(archive).digest('hex');
  assert.match(readFileSync(path.join(output, 'skill.zip.sha256'), 'utf8'), new RegExp(`^${digest}\\s+skill\\.zip\\s*$`));
  const unpack = path.join(path.dirname(root), 'unpacked');
  run('unzip', ['-q', path.join(output, 'skill.zip'), '-d', unpack], root);
  const installed = path.join(unpack, 'shenti-coach');
  assert.equal(verifyPackage(installed, version).ok, true);
  assert.equal(readFileSync(path.join(installed, 'assets/badges/release.svg'), 'utf8'), renderBadge('release', `v${version}`, 'blue'));
  assert.equal(readFileSync(path.join(root, 'assets/badges/release.svg'), 'utf8'), oldBadge, 'archive build must leave source badge unchanged');
  put(installed, 'assets/badges/release.svg', oldBadge);
  put(installed, 'runtime/ledger.json', 'private');
  run('bash', ['scripts/package_skill.sh', 'dist'], installed);
  const repacked = run('unzip', ['-Z1', path.join(installed, 'dist/skill.zip')], installed);
  assert.ok(!repacked.includes('runtime/'));
  assert.ok(!repacked.includes('dist/'));
  assert.ok(repacked.includes('shenti-coach/scripts/tests/package.test.mjs'));
  const repackedBadge = run('unzip', ['-p', path.join(installed, 'dist/skill.zip'), 'shenti-coach/assets/badges/release.svg'], installed);
  assert.equal(repackedBadge, renderBadge('release', `v${version}`, 'blue'));
  assert.equal(readFileSync(path.join(installed, 'assets/badges/release.svg'), 'utf8'), oldBadge, 'repackaging must leave installed source badge unchanged');
  const refused = spawnSync('bash', ['scripts/package_skill.sh', 'scripts'], { cwd: installed, encoding: 'utf8' });
  assert.notEqual(refused.status, 0);
});

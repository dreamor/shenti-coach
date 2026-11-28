import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createLedger } from '../blindspot_ledger.mjs';
import { renderBadge } from '../make_badge.mjs';
import { releaseManifest } from '../verify_package.mjs';
import { createTempDir, repoRoot } from './helpers.mjs';

// Regression: Node resolves the main module through symlinks while process.argv[1]
// keeps the invoked path (macOS os.tmpdir() lives under /var -> /private/var; a
// skill may also be installed behind a link). The old raw guards silently turned
// every CLI into an exit-0 no-op, and releaseManifest rejected Git roots reached
// through a symlink alias.

function aliasFixture(t, scripts) {
  const base = createTempDir(t);
  const real = path.join(base, 'real');
  mkdirSync(real);
  cpSync(path.join(repoRoot, 'scripts', 'lib'), path.join(real, 'lib'), { recursive: true });
  // training_state backs the ledger CLI; make_badge backs verify_package.
  for (const file of new Set([...scripts, 'training_state.mjs', 'make_badge.mjs'])) {
    cpSync(path.join(repoRoot, 'scripts', file), path.join(real, file));
  }
  const alias = path.join(base, 'alias');
  try { symlinkSync(real, alias); }
  catch (error) {
    if (error.code === 'EPERM') return t.skip('symlink creation unavailable'), null;
    throw error;
  }
  return { real, alias };
}

test('make_badge writes through a symlinked scripts directory', (t) => {
  const fx = aliasFixture(t, ['make_badge.mjs']);
  if (!fx) return;
  const out = path.join(fx.alias, 'stage', 'release.svg');
  const result = spawnSync(process.execPath,
    [path.join(fx.alias, 'make_badge.mjs'), 'release', 'v9.9.9', out, 'blue'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(out, 'utf8'), renderBadge('release', 'v9.9.9', 'blue'));
});

test('blindspot_ledger executes its CLI through a symlinked scripts directory', (t) => {
  const fx = aliasFixture(t, ['blindspot_ledger.mjs']);
  if (!fx) return;
  const input = JSON.stringify({ ledger: createLedger(), action: { type: 'record',
    record: { question_id: 'q1', attempt_id: 'a1', condition_type: 'domain_range', assessment: 'missed', date: '2026-11-27' } } });
  const result = spawnSync(process.execPath,
    [path.join(fx.alias, 'blindspot_ledger.mjs'), '--student', 's_alias'], { input, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).records.length, 1);
});

test('symlinked CLI entrypoints report usage instead of exiting 0 silently', (t) => {
  const scripts = ['verify_package.mjs', 'present_output.mjs', 'build_bigbang.mjs', 'training_state.mjs'];
  const fx = aliasFixture(t, scripts);
  if (!fx) return;
  for (const script of scripts) {
    const result = spawnSync(process.execPath, [path.join(fx.alias, script)],
      { input: '', encoding: 'utf8', timeout: 30000 });
    assert.notEqual(result.status, 0, `${script} must not be a silent no-op through a symlink`);
  }
});

test('releaseManifest accepts a symlink alias of the Git root', (t) => {
  if (spawnSync('git', ['--version'], { encoding: 'utf8' }).status !== 0) return t.skip('git unavailable');
  const base = createTempDir(t);
  const real = path.join(base, 'repo');
  mkdirSync(path.join(real, 'scripts'), { recursive: true });
  writeFileSync(path.join(real, 'README.md'), '# fixture\n');
  writeFileSync(path.join(real, 'scripts', 'make_badge.mjs'), '// fixture\n');
  const git = (args) => {
    const result = spawnSync('git', ['-C', real, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git(['init', '-q', '.']);
  git(['add', '.']);
  const alias = path.join(base, 'alias-repo');
  try { symlinkSync(real, alias); }
  catch (error) {
    if (error.code === 'EPERM') return t.skip('symlink creation unavailable');
    throw error;
  }
  assert.deepEqual(releaseManifest(alias), releaseManifest(real));
  assert.ok(releaseManifest(alias).includes('scripts/make_badge.mjs'));
});

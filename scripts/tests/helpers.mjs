import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export function createTempDir(t) {
  // macOS: os.tmpdir() lives under /var, which is a symlink to /private/var.
  // Symlink-safe CLI guards (save-path ancestors, Git toplevel compare) must
  // not fire on that OS alias, and fixtures must match realpath comparisons.
  const dir = mkdtempSync(path.join(realpathSync(tmpdir()), 'shenti-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function runScript(script, args = [], options = {}) {
  return spawnSync(process.execPath, [path.join(repoRoot, 'scripts', script), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30000,
    ...options,
  });
}

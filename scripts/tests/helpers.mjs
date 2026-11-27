import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export function createTempDir(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'shenti-test-'));
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

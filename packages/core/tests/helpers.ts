import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function sh(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** A fresh git repo (no commits yet) with a local identity, on `branch`. */
export function makeRepo(branch = 'main'): string {
  const dir = mkdtempSync(join(tmpdir(), 'dak-core-'));
  sh(dir, 'init', '-q', '-b', branch);
  sh(dir, 'config', 'user.email', 't@example.com');
  sh(dir, 'config', 'user.name', 'Test');
  sh(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

export function commitFile(dir: string, name: string, content = 'x'): void {
  writeFileSync(join(dir, name), content);
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', `add ${name}`);
}

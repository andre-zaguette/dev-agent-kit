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

/** An empty bare repository to act as `origin`. */
export function makeBareRemote(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dak-remote-'));
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', dir]);
  return dir;
}

/** A clone of `remote` with a local identity, on `main` even when the remote is still empty. */
export function cloneOf(remote: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'dak-clone-'));
  execFileSync('git', ['clone', '-q', remote, dir], { stdio: ['ignore', 'pipe', 'ignore'] });
  sh(dir, 'config', 'user.email', 't@example.com');
  sh(dir, 'config', 'user.name', 'Test');
  sh(dir, 'config', 'commit.gpgsign', 'false');
  sh(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  return dir;
}

/** remote + a working clone that already pushed one commit to `origin/main`. */
export function seededClone(): { remote: string; dir: string } {
  const remote = makeBareRemote();
  const dir = cloneOf(remote);
  commitFile(dir, 'a.txt');
  sh(dir, 'push', '-q', '-u', 'origin', 'main');
  return { remote, dir };
}

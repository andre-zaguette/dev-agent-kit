import { execFileSync } from 'node:child_process';

const SHA_RE = /^[0-9a-f]{7,40}$/;

/** The parent environment minus variables that would redirect git away from `cwd`, and never prompting. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[key];
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Run git in `root`. Output is returned untrimmed; a non-zero exit is `ok: false` (never thrown). */
export function runGit(root: string, args: string[], opts: { timeoutMs?: number } = {}): GitResult {
  try {
    const stdout = execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, env: cleanEnv(), timeout: opts.timeoutMs });
    return { ok: true, stdout, stderr: '' };
  } catch (error) {
    const e = error as { stdout?: string | Buffer; stderr?: string | Buffer };
    return { ok: false, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
  }
}

/** Trimmed stdout of a read-only git command; null on any failure (not a repo, unknown ref, no git). */
function git(root: string, args: string[]): string | null {
  const result = runGit(root, args);
  return result.ok ? result.stdout.trim() : null;
}

export function isGitRepo(root: string): boolean {
  return git(root, ['rev-parse', '--is-inside-work-tree']) === 'true';
}

export function headSha(root: string): string | null {
  return git(root, ['rev-parse', '--short=12', 'HEAD']);
}

/** Files changed between `sha` and HEAD. null when `sha` is malformed or not in this history. */
export function changedSince(root: string, sha: string): string[] | null {
  if (!SHA_RE.test(sha)) return null;
  const out = git(root, ['-c', 'core.quotePath=false', 'diff', '--name-only', `${sha}..HEAD`]);
  return out === null ? null : out.split('\n').filter(Boolean);
}

/** Base branch discovery: explicit config, then origin/HEAD, then a local main, then a local master. */
export function detectBaseBranch(root: string, configured?: string): string | undefined {
  if (configured) return configured;
  const originHead = git(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (originHead?.startsWith('origin/')) return originHead.slice('origin/'.length);
  for (const name of ['main', 'master']) {
    if (git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`]) !== null) return name;
  }
  return undefined;
}

/** Current branch name; null when HEAD is detached or this is not a repository. */
export function currentBranch(root: string): string | null {
  const out = git(root, ['symbolic-ref', '--short', '-q', 'HEAD']);
  return out === null || out === '' ? null : out;
}

/** True when `ancestor` is reachable from `descendant`. False for unknown or malformed commits. */
export function isAncestor(root: string, ancestor: string, descendant: string): boolean {
  if (!SHA_RE.test(ancestor) && !/^[A-Za-z0-9._/-]+$/.test(ancestor)) return false;
  if (ancestor.startsWith('-') || descendant.startsWith('-')) return false;
  return runGit(root, ['merge-base', '--is-ancestor', ancestor, descendant]).ok;
}

/** Paths with uncommitted changes, untracked files included. Empty means a clean tree; null means git could not tell. */
export function dirtyFiles(root: string): string[] | null {
  const result = runGit(root, ['-c', 'core.quotePath=false', 'status', '--porcelain']);
  if (!result.ok) return null;
  return result.stdout
    .split('\n')
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3).replace(/^.* -> /, ''));
}

export function hasRemote(root: string, remote = 'origin'): boolean {
  return runGit(root, ['remote', 'get-url', remote]).ok;
}

/** Branch names on `remote` (without the "<remote>/" prefix and without HEAD). */
export function listRemoteBranches(root: string, remote = 'origin'): string[] {
  const out = git(root, ['for-each-ref', '--format=%(refname:short)', `refs/remotes/${remote}`]);
  if (out === null) return [];
  return out
    .split('\n')
    .map((name) => (name.startsWith(`${remote}/`) ? name.slice(remote.length + 1) : name))
    .filter((name) => name !== '' && name !== 'HEAD' && name !== remote);
}

/** True when some local or remote-tracking branch already contains `rev`, so leaving it orphans nothing. */
export function isOnSomeBranch(root: string, rev = 'HEAD'): boolean {
  const result = runGit(root, ['for-each-ref', '--contains', rev, '--format=%(refname)', 'refs/heads', 'refs/remotes']);
  return result.ok && result.stdout.trim() !== '';
}

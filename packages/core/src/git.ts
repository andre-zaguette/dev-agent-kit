import { execFileSync } from 'node:child_process';

const SHA_RE = /^[0-9a-f]{7,40}$/;

/** The parent environment minus variables that would redirect git away from `cwd`. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[key];
  return env;
}

/** Run a read-only git command in `root`; null on any failure (not a repo, unknown ref, no git). */
function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024, env: cleanEnv() }).trim();
  } catch {
    return null;
  }
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

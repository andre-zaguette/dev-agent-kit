import { detectBaseBranch, dirtyFiles, hasRemote, headSha, isGitRepo, runGit } from './git.js';

export type PrepFailure =
  | 'not-a-repo'
  | 'dirty-tree'
  | 'invalid-branch-name'
  | 'branch-exists'
  | 'fetch-failed'
  | 'no-base-branch'
  | 'base-missing'
  | 'diverged'
  | 'switch-failed';

export type PrepResult =
  | { ok: true; baseBranch: string; baseSha: string; workingBranch: string; fetched: boolean; notes: string[] }
  | { ok: false; reason: PrepFailure; detail: string; files?: string[] };

const FETCH_TIMEOUT_MS = 60_000;

const validRef = (root: string, name: string): boolean => name !== '' && !name.startsWith('-') && runGit(root, ['check-ref-format', '--branch', name]).ok;
const refExists = (root: string, ref: string): boolean => runGit(root, ['show-ref', '--verify', '--quiet', ref]).ok;
const firstLine = (text: string): string => text.trim().split('\n')[0].slice(0, 300);

/**
 * Spec §12: refuse on a dirty tree, fetch, fast-forward the base only, create the task branch and
 * report the base sha. Never resets, cleans, rebases, stashes or pushes. Every refusal happens
 * before the working tree or HEAD is touched, except a failed switch, which git itself rolls back.
 */
export function prepareTaskBranch(root: string, opts: { workingBranch: string; baseBranch?: string; remote?: string }): PrepResult {
  const notes: string[] = [];
  const fail = (reason: PrepFailure, detail: string, files?: string[]): PrepResult => ({ ok: false, reason, detail, ...(files ? { files } : {}) });

  if (!isGitRepo(root)) return fail('not-a-repo', `${root} is not inside a git repository`);
  const dirty = dirtyFiles(root);
  if (dirty.length > 0) return fail('dirty-tree', `${dirty.length} uncommitted change(s); commit or stash them yourself, nothing was modified`, dirty);
  if (!validRef(root, opts.workingBranch)) return fail('invalid-branch-name', `"${opts.workingBranch.slice(0, 80)}" is not a valid branch name`);
  if (refExists(root, `refs/heads/${opts.workingBranch}`)) return fail('branch-exists', `branch "${opts.workingBranch}" already exists; resume it instead of recreating it`);

  const remote = opts.remote ?? 'origin';
  let fetched = false;
  if (hasRemote(root, remote)) {
    const fetch = runGit(root, ['fetch', '--prune', remote], { timeoutMs: FETCH_TIMEOUT_MS });
    if (!fetch.ok) return fail('fetch-failed', firstLine(fetch.stderr) || 'git fetch failed');
    fetched = true;
  } else {
    notes.push(`no "${remote}" remote; using the local base branch as-is`);
  }

  const base = detectBaseBranch(root, opts.baseBranch);
  if (!base) return fail('no-base-branch', 'could not determine the base branch (set baseBranch in .dev-agent/config.yml)');
  if (!validRef(root, base)) return fail('invalid-branch-name', `base branch "${base.slice(0, 80)}" is not a valid branch name`);
  if (!refExists(root, `refs/heads/${base}`)) return fail('base-missing', `local base branch "${base}" does not exist`);

  let behind = 0;
  if (fetched && refExists(root, `refs/remotes/${remote}/${base}`)) {
    const counts = runGit(root, ['rev-list', '--left-right', '--count', `${remote}/${base}...${base}`]);
    const [remoteOnly, localOnly] = counts.ok ? counts.stdout.trim().split(/\s+/).map(Number) : [Number.NaN, Number.NaN];
    if (Number.isNaN(remoteOnly) || Number.isNaN(localOnly)) return fail('base-missing', `could not compare ${base} with ${remote}/${base}`);
    if (remoteOnly > 0 && localOnly > 0) {
      return fail('diverged', `local ${base} and ${remote}/${base} have diverged (${localOnly} local, ${remoteOnly} remote commit(s)); reconcile manually, nothing was modified`);
    }
    if (localOnly > 0) notes.push(`local ${base} is ${localOnly} commit(s) ahead of ${remote}/${base}`);
    behind = remoteOnly;
  } else if (fetched) {
    notes.push(`${remote}/${base} was not found; the base was not updated`);
  }

  const switched = runGit(root, ['switch', base]);
  if (!switched.ok) return fail('switch-failed', `could not switch to ${base}: ${firstLine(switched.stderr)}`);
  if (behind > 0) {
    const merged = runGit(root, ['merge', '--ff-only', `${remote}/${base}`]);
    if (!merged.ok) return fail('diverged', `${base} could not be fast-forwarded to ${remote}/${base}: ${firstLine(merged.stderr)}`);
  }
  const baseSha = headSha(root);
  if (baseSha === null) return fail('base-missing', `${base} has no commits`);
  const created = runGit(root, ['switch', '-c', opts.workingBranch]);
  if (!created.ok) return fail('switch-failed', `could not create ${opts.workingBranch}: ${firstLine(created.stderr)}`);
  return { ok: true, baseBranch: base, baseSha, workingBranch: opts.workingBranch, fetched, notes };
}

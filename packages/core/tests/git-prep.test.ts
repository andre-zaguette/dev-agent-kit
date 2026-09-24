import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { currentBranch, dirtyFiles, hasRemote, headSha, isAncestor, listRemoteBranches, runGit } from '../src/git.ts';
import { prepareTaskBranch } from '../src/git-prep.ts';
import { cloneOf, commitFile, makeRepo, seededClone, sh } from './helpers.ts';

test('happy path: fetch, fast-forward the base, create the task branch, record the base sha', () => {
  const { remote, dir } = seededClone();
  const other = cloneOf(remote);
  sh(other, 'pull', '-q', 'origin', 'main');
  commitFile(other, 'remote.txt');
  sh(other, 'push', '-q', 'origin', 'main');
  const remoteHead = headSha(other);
  const result = prepareTaskBranch(dir, { workingBranch: 'feat/hef-1-card' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.baseBranch, 'main');
  assert.equal(result.baseSha, remoteHead);
  assert.equal(result.workingBranch, 'feat/hef-1-card');
  assert.equal(result.fetched, true);
  assert.equal(currentBranch(dir), 'feat/hef-1-card');
  assert.ok(existsSync(join(dir, 'remote.txt')));
});

test('a dirty tree is refused before anything changes', () => {
  const { dir } = seededClone();
  writeFileSync(join(dir, 'wip.txt'), 'my work');
  writeFileSync(join(dir, 'a.txt'), 'edited');
  const result = prepareTaskBranch(dir, { workingBranch: 'feat/x-1-y' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'dirty-tree');
  assert.deepEqual([...(result.files ?? [])].sort(), ['a.txt', 'wip.txt']);
  assert.equal(currentBranch(dir), 'main');
  assert.equal(runGit(dir, ['show-ref', '--verify', '--quiet', 'refs/heads/feat/x-1-y']).ok, false);
  assert.deepEqual(dirtyFiles(dir).sort(), ['a.txt', 'wip.txt']);
});

test('a diverged base stops with a reason and leaves the repository as found', () => {
  const { remote, dir } = seededClone();
  const other = cloneOf(remote);
  sh(other, 'pull', '-q', 'origin', 'main');
  commitFile(other, 'remote.txt');
  sh(other, 'push', '-q', 'origin', 'main');
  commitFile(dir, 'local.txt');
  const before = headSha(dir);
  const result = prepareTaskBranch(dir, { workingBranch: 'feat/x-1-y' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'diverged');
  assert.equal(headSha(dir), before);
  assert.equal(currentBranch(dir), 'main');
  assert.equal(existsSync(join(dir, 'local.txt')), true);
});

test('a base that is only ahead of the remote is accepted and reported', () => {
  const { dir } = seededClone();
  commitFile(dir, 'unpushed.txt');
  const result = prepareTaskBranch(dir, { workingBranch: 'feat/x-1-y' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.notes.some((n) => /1 commit\(s\) ahead/.test(n)));
  assert.equal(existsSync(join(dir, 'unpushed.txt')), true);
});

test('an existing branch, an invalid name and a hostile name are refused', () => {
  const { dir } = seededClone();
  sh(dir, 'branch', 'feat/taken');
  const reason = (name: string) => {
    const r = prepareTaskBranch(dir, { workingBranch: name });
    return r.ok ? 'ok' : r.reason;
  };
  assert.equal(reason('feat/taken'), 'branch-exists');
  for (const bad of ['-x', 'a..b', 'has space', 'end.lock', 'a~b', '']) assert.equal(reason(bad), 'invalid-branch-name', bad);
  assert.equal(currentBranch(dir), 'main');
});

test('a failing fetch is reported and nothing changes', () => {
  const { remote, dir } = seededClone();
  rmSync(remote, { recursive: true, force: true });
  const result = prepareTaskBranch(dir, { workingBranch: 'feat/x-1-y' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'fetch-failed');
  assert.equal(currentBranch(dir), 'main');
});

test('without a remote the local base is used and the note says so', () => {
  const dir = makeRepo();
  commitFile(dir, 'a.txt');
  assert.equal(hasRemote(dir), false);
  const result = prepareTaskBranch(dir, { workingBranch: 'feat/x-1-y' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.fetched, false);
  assert.ok(result.notes.some((n) => /no "origin" remote/.test(n)));
});

test('not a repository, and no base branch, are reported', () => {
  const dir = makeRepo();
  assert.equal(prepareTaskBranch('/', { workingBranch: 'feat/x' }).ok, false);
  const r = prepareTaskBranch(dir, { workingBranch: 'feat/x' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(['no-base-branch', 'base-missing'].includes(r.reason));
});

test('read-only helpers: ancestry, remote branches, detached HEAD', () => {
  const { dir } = seededClone();
  const first = headSha(dir)!;
  commitFile(dir, 'b.txt');
  sh(dir, 'push', '-q', 'origin', 'HEAD:refs/heads/feat/a-1-x');
  sh(dir, 'fetch', '-q');
  assert.equal(isAncestor(dir, first, 'HEAD'), true);
  assert.equal(isAncestor(dir, 'HEAD', first), false);
  assert.equal(isAncestor(dir, 'deadbeef', 'HEAD'), false);
  assert.deepEqual(listRemoteBranches(dir).sort(), ['feat/a-1-x', 'main']);
  sh(dir, 'checkout', '-q', '--detach');
  assert.equal(currentBranch(dir), null);
});

test('a detached HEAD holding commits that no branch contains is refused, so nothing is orphaned', () => {
  const { dir } = seededClone();
  sh(dir, 'checkout', '-q', '--detach');
  commitFile(dir, 'orphan.txt');
  const orphan = headSha(dir)!;
  const result = prepareTaskBranch(dir, { workingBranch: 'feat/x-1-y' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'detached-head');
  assert.equal(headSha(dir), orphan);
});

test('a detached HEAD that some branch already contains is fine to leave', () => {
  const { dir } = seededClone();
  sh(dir, 'checkout', '-q', '--detach');
  const result = prepareTaskBranch(dir, { workingBranch: 'feat/x-1-y' });
  assert.equal(result.ok, true);
});

test('ref-expanding names such as @{-1} are invalid, and a failed creation goes back to the starting branch', () => {
  const { dir } = seededClone();
  sh(dir, 'switch', '-q', '-c', 'work');
  assert.equal(prepareTaskBranch(dir, { workingBranch: '@{-1}' }).ok, false);
  assert.equal(currentBranch(dir), 'work');
  sh(dir, 'branch', 'feat/x');
  const clash = prepareTaskBranch(dir, { workingBranch: 'feat' });
  assert.equal(clash.ok, false);
  if (!clash.ok) assert.equal(clash.reason, 'switch-failed');
  assert.equal(currentBranch(dir), 'work');
});

test('an ignored local file that the base tracks is never overwritten', () => {
  const { remote, dir } = seededClone();
  writeFileSync(join(dir, '.git', 'info', 'exclude'), '.env\n');
  writeFileSync(join(dir, '.env'), 'LOCAL_SECRET=1');
  const other = cloneOf(remote);
  sh(other, 'pull', '-q', 'origin', 'main');
  commitFile(other, '.env', 'UPSTREAM=1');
  sh(other, 'push', '-q', 'origin', 'main');
  const result = prepareTaskBranch(dir, { workingBranch: 'feat/x-1-y' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'ignored-files-in-the-way');
  assert.deepEqual(result.files, ['.env']);
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), 'LOCAL_SECRET=1');
  assert.equal(currentBranch(dir), 'main');
});

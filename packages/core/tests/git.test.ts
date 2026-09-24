import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changedSince, detectBaseBranch, headSha, isGitRepo } from '../src/git.ts';
import { commitFile, makeRepo, sh } from './helpers.ts';

test('a directory that is not a git repo yields null/undefined, never throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dak-core-'));
  try {
    assert.equal(isGitRepo(dir), false);
    assert.equal(headSha(dir), null);
    assert.equal(changedSince(dir, 'abcdef1'), null);
    assert.equal(detectBaseBranch(dir), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('headSha is the 12-char short SHA; changedSince lists files after it', () => {
  const dir = makeRepo();
  try {
    commitFile(dir, 'a.txt');
    const first = headSha(dir)!;
    assert.match(first, /^[0-9a-f]{12}$/);
    assert.deepEqual(changedSince(dir, first), []);
    commitFile(dir, 'b.txt');
    assert.deepEqual(changedSince(dir, first), ['b.txt']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('changedSince returns null for a malformed sha or one that is not in history', () => {
  const dir = makeRepo();
  try {
    commitFile(dir, 'a.txt');
    assert.equal(changedSince(dir, '--output=/tmp/x'), null);
    assert.equal(changedSince(dir, 'not-a-sha'), null);
    assert.equal(changedSince(dir, 'deadbeefdead'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectBaseBranch: configured wins, then origin/HEAD, then main, then master', () => {
  const dir = makeRepo('trunk');
  const remote = mkdtempSync(join(tmpdir(), 'dak-core-remote-'));
  try {
    commitFile(dir, 'a.txt');
    assert.equal(detectBaseBranch(dir), undefined, 'no main/master/origin yet');
    assert.equal(detectBaseBranch(dir, 'develop'), 'develop');

    sh(remote, 'init', '-q', '--bare', '-b', 'trunk');
    sh(dir, 'remote', 'add', 'origin', remote);
    sh(dir, 'push', '-q', 'origin', 'trunk');
    sh(dir, 'remote', 'set-head', 'origin', 'trunk');
    assert.equal(detectBaseBranch(dir), 'trunk');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  }
});

test('detectBaseBranch falls back to main, then master', () => {
  const withMain = makeRepo('main');
  const withMaster = makeRepo('master');
  try {
    commitFile(withMain, 'a.txt');
    commitFile(withMaster, 'a.txt');
    assert.equal(detectBaseBranch(withMain), 'main');
    assert.equal(detectBaseBranch(withMaster), 'master');
  } finally {
    rmSync(withMain, { recursive: true, force: true });
    rmSync(withMaster, { recursive: true, force: true });
  }
});

test('changedSince returns non-ASCII paths unescaped', () => {
  const dir = makeRepo();
  try {
    commitFile(dir, 'a.txt');
    const first = headSha(dir)!;
    commitFile(dir, 'café.txt');
    assert.deepEqual(changedSince(dir, first), ['café.txt']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('git helpers ignore GIT_DIR from the parent environment', () => {
  const dir = makeRepo();
  const saved = process.env.GIT_DIR;
  try {
    commitFile(dir, 'a.txt');
    process.env.GIT_DIR = join(dir, 'does-not-exist');
    assert.match(headSha(dir)!, /^[0-9a-f]{12}$/);
  } finally {
    if (saved === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

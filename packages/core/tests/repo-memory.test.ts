import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkFreshness, findSecret, knowledgePath, readKnowledge, writeKnowledge } from '../src/repo-memory.ts';
import { headSha } from '../src/git.ts';
import { commitFile, makeRepo } from './helpers.ts';

function tmp(): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'dak-mem-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('write then read round-trips body, sourceSha and updatedAt', () => {
  const t = tmp();
  try {
    const dir = join(t.dir, '.dev-agent', 'knowledge');
    const file = writeKnowledge(dir, 'commands', 'test: npm test\n', { sourceSha: 'abc1234', updatedAt: '2026-09-24T14:00:00Z' });
    assert.equal(file, join(dir, 'commands.md'));
    assert.match(readFileSync(file, 'utf8'), /^---\nsourceSha: abc1234\nupdatedAt: 2026-09-24T14:00:00Z\n---\n/);
    assert.deepEqual(readKnowledge(dir, 'commands'), {
      name: 'commands',
      sourceSha: 'abc1234',
      updatedAt: '2026-09-24T14:00:00Z',
      body: 'test: npm test'
    });
    assert.equal(readKnowledge(dir, 'backend'), null);
  } finally {
    t.cleanup();
  }
});

test('names outside the fixed set and malformed shas are refused', () => {
  const t = tmp();
  try {
    assert.throws(() => knowledgePath(t.dir, '../../etc/passwd'), /unknown knowledge file/);
    assert.throws(() => writeKnowledge(t.dir, 'repository', 'x', { sourceSha: 'not a sha' }), /invalid sourceSha/);
  } finally {
    t.cleanup();
  }
});

test('a body that looks like it holds a secret is refused', () => {
  const t = tmp();
  try {
    for (const body of [
      '-----BEGIN RSA PRIVATE KEY-----\nabc',
      'token ghp_' + 'a'.repeat(30),
      'AKIA' + 'A'.repeat(16),
      'api_key = "supersecretvalue123"',
      'password: hunter2hunter2'
    ]) {
      assert.throws(() => writeKnowledge(t.dir, 'repository', body, { sourceSha: 'abc1234' }), /secret/);
    }
    assert.equal(findSecret('the token is stored in the vault'), null);
  } finally {
    t.cleanup();
  }
});

test('writing through a symlinked knowledge dir or file is refused', () => {
  const t = tmp();
  try {
    const real = join(t.dir, 'real');
    mkdirSync(real);
    symlinkSync(real, join(t.dir, 'linkdir'));
    assert.throws(() => writeKnowledge(join(t.dir, 'linkdir'), 'repository', 'x', { sourceSha: 'abc1234' }), /symbolic link/);

    const dir = join(t.dir, 'k');
    mkdirSync(dir);
    writeFileSync(join(t.dir, 'target.md'), 'victim');
    symlinkSync(join(t.dir, 'target.md'), join(dir, 'repository.md'));
    assert.throws(() => writeKnowledge(dir, 'repository', 'x', { sourceSha: 'abc1234' }), /symbolic link/);
    assert.equal(readFileSync(join(t.dir, 'target.md'), 'utf8'), 'victim');
  } finally {
    t.cleanup();
  }
});

test('readKnowledge treats a file without valid frontmatter as missing', () => {
  const t = tmp();
  try {
    writeFileSync(join(t.dir, 'repository.md'), 'no frontmatter here');
    assert.equal(readKnowledge(t.dir, 'repository'), null);
  } finally {
    t.cleanup();
  }
});

test('freshness: fresh at the same HEAD, stale with changed files after new commits', () => {
  const repo = makeRepo();
  try {
    commitFile(repo, 'a.txt');
    const sha = headSha(repo)!;
    const doc = { name: 'repository' as const, sourceSha: sha, updatedAt: 'x', body: 'b' };
    assert.deepEqual(checkFreshness(repo, doc), { state: 'fresh' });
    commitFile(repo, 'b.txt');
    assert.deepEqual(checkFreshness(repo, doc), { state: 'stale', changedFiles: ['b.txt'] });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('freshness is unknown, never fresh, when the repo is missing or the sha left history', () => {
  const t = tmp();
  const repo = makeRepo();
  try {
    const doc = { name: 'repository' as const, sourceSha: 'deadbeefdead', updatedAt: 'x', body: 'b' };
    assert.equal(checkFreshness(t.dir, doc).state, 'unknown');
    commitFile(repo, 'a.txt');
    const result = checkFreshness(repo, doc);
    assert.equal(result.state, 'unknown');
  } finally {
    t.cleanup();
    rmSync(repo, { recursive: true, force: true });
  }
});

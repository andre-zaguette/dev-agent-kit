import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { reviewDiff } from '../src/diff-review.ts';
import { makeRepo, sh } from './helpers.ts';

function put(dir: string, files: Record<string, string | Buffer>): void {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
}
function commitAll(dir: string, message = 'c'): void {
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', message);
}
function repo(files: Record<string, string> = { 'README.md': 'x' }): string {
  const dir = makeRepo();
  put(dir, files);
  commitAll(dir, 'init');
  return dir;
}
const ids = (r: ReturnType<typeof reviewDiff>) => r.findings.map((f) => `${f.severity}:${f.id}`).sort();
const clean = (dir: string) => rmSync(dir, { recursive: true, force: true });

test('a clean tree has an empty diff', () => {
  const dir = repo();
  try {
    const r = reviewDiff(dir);
    assert.deepEqual(r.files, []);
    assert.deepEqual(ids(r), ['info:empty-diff']);
  } finally {
    clean(dir);
  }
});

test('editing a shipped migration is an error, adding one is information', () => {
  const dir = repo({ 'notes/migrations/0001_initial.py': 'a', 'notes/models.py': 'm' });
  try {
    put(dir, { 'notes/migrations/0001_initial.py': 'changed' });
    assert.ok(ids(reviewDiff(dir)).includes('error:migration-edited'));
    sh(dir, 'checkout', '--', '.');
    put(dir, { 'notes/migrations/0002_archived.py': 'new' });
    const r = reviewDiff(dir);
    assert.ok(ids(r).includes('info:migration-added'));
    assert.ok(!ids(r).includes('error:migration-edited'));
    sh(dir, 'rm', '-q', '-f', 'notes/migrations/0001_initial.py');
    assert.ok(ids(reviewDiff(dir)).includes('error:migration-edited'));
  } finally {
    clean(dir);
  }
});

test('source changes without a test warn, and a test file clears the warning', () => {
  const dir = repo({ 'src/services/notes.ts': 'a' });
  try {
    put(dir, { 'src/services/notes.ts': 'b' });
    assert.ok(ids(reviewDiff(dir)).includes('warning:no-tests'));
    put(dir, { 'src/services/notes.test.ts': 't' });
    assert.ok(!ids(reviewDiff(dir)).includes('warning:no-tests'));
  } finally {
    clean(dir);
  }
});

test('dependency manifests and lockfiles are flagged, a lockfile alone separately', () => {
  const dir = repo({ 'package.json': '{}', 'package-lock.json': '{}' });
  try {
    put(dir, { 'package-lock.json': '{"a":1}' });
    assert.deepEqual(ids(reviewDiff(dir)), ['warning:lockfile-only']);
    put(dir, { 'package.json': '{"a":1}' });
    assert.deepEqual(ids(reviewDiff(dir)), ['warning:dependencies-changed']);
    put(dir, { 'Api/Api.csproj': '<Project/>' });
    assert.ok(ids(reviewDiff(dir)).includes('warning:dependencies-changed'));
  } finally {
    clean(dir);
  }
});

test('a new top-level directory, many files and generated or binary paths are reported', () => {
  const dir = repo({ 'src/a.ts': 'a' });
  try {
    put(dir, { 'docs2/x.md': 'x' });
    assert.ok(ids(reviewDiff(dir)).includes('info:new-top-level-dir'));
    const many: Record<string, string> = {};
    for (let i = 0; i < 26; i++) many[`src/f${i}.ts`] = 'x';
    put(dir, many);
    assert.ok(ids(reviewDiff(dir)).includes('info:many-files'));
    put(dir, { 'dist/app.js': 'x', 'src/__pycache__/a.pyc': 'x' });
    assert.ok(ids(reviewDiff(dir)).includes('warning:generated-or-binary'));
  } finally {
    clean(dir);
  }
});

test('a secret in an added line is an error that never prints the value; an untouched secret line is ignored', () => {
  const dir = repo({ 'config.txt': 'password = "existingsecretvalue1"\nother\n' });
  try {
    put(dir, { 'config.txt': 'password = "existingsecretvalue1"\nother\nchanged\n' });
    assert.ok(!ids(reviewDiff(dir)).some((x) => x.includes('secret')));
    put(dir, { 'app.env': 'token ghp_' + 'a'.repeat(30) + '\n', 'notes.txt': 'password = "hunter2hunter2"\n' });
    sh(dir, 'add', 'notes.txt');
    const r = reviewDiff(dir);
    assert.ok(ids(r).includes('error:secret-in-diff'));
    const text = JSON.stringify(r);
    assert.doesNotMatch(text, /hunter2/);
    assert.doesNotMatch(text, /ghp_a/);
    assert.match(text, /notes\.txt/);
    assert.match(text, /app\.env/);
  } finally {
    clean(dir);
  }
});

test('paths with spaces and quotes, renames, deletions and untracked files are reported with the right status', () => {
  const dir = repo({ 'old name.txt': 'one\ntwo\nthree\nfour\nfive\n', 'gone.txt': 'g' });
  try {
    sh(dir, 'mv', 'old name.txt', 'new "name".txt');
    sh(dir, 'rm', '-q', 'gone.txt');
    put(dir, { 'untracked file.txt': 'u' });
    const r = reviewDiff(dir);
    const byPath = Object.fromEntries(r.files.map((f) => [f.path, f.status]));
    assert.equal(byPath['new "name".txt'], 'renamed');
    assert.equal(byPath['gone.txt'], 'deleted');
    assert.equal(byPath['untracked file.txt'], 'untracked');
  } finally {
    clean(dir);
  }
});

test('the whole branch is reviewed: committed work since the merge-base plus the working tree', () => {
  const dir = repo({ 'src/services/a.ts': 'a', 'notes/migrations/0001_initial.py': 'm' });
  try {
    sh(dir, 'switch', '-q', '-c', 'feat');
    put(dir, { 'src/services/b.ts': 'b', 'notes/migrations/0001_initial.py': 'edited' });
    commitAll(dir, 'feature');
    put(dir, { 'src/extra.ts': 'x' });
    const r = reviewDiff(dir);
    assert.deepEqual(r.files.map((f) => f.path).sort(), ['notes/migrations/0001_initial.py', 'src/extra.ts', 'src/services/b.ts']);
    assert.ok(ids(r).includes('error:migration-edited'));
  } finally {
    clean(dir);
  }
});

test('an unknown or option-like base, and a repository without commits, are clear errors', () => {
  const dir = repo();
  const empty = makeRepo();
  try {
    assert.throws(() => reviewDiff(dir, { base: 'nope' }), /is not a commit/);
    assert.throws(() => reviewDiff(dir, { base: '--output=/tmp/x' }), /is not a commit/);
    assert.throws(() => reviewDiff(empty), /commit/);
    assert.throws(() => reviewDiff('/'), /not a git repository/);
  } finally {
    clean(dir);
    clean(empty);
  }
});

test('big diffs are capped, binary files and CRLF do not disturb the scan', () => {
  const dir = repo({ 'a.txt': 'x' });
  try {
    const files: Record<string, string> = {};
    for (let i = 0; i < 600; i++) files[`bulk/f${String(i).padStart(3, '0')}.txt`] = 'x';
    put(dir, files);
    const r = reviewDiff(dir);
    assert.equal(r.truncated, true);
    assert.equal(r.files.length, 500);
    put(dir, { 'blob.bin': Buffer.from([0, 1, 2, 0, 255, 254]), 'win.txt': 'line one\r\nline two\r\n' });
    assert.doesNotThrow(() => reviewDiff(dir));
  } finally {
    clean(dir);
  }
});

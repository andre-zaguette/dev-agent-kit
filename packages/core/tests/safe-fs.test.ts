import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveInside, safeReadFile, safeWriteFile } from '../src/safe-fs.ts';

function tmp(): { dir: string; other: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'dak-fs-'));
  const other = mkdtempSync(join(tmpdir(), 'dak-fs-other-'));
  return { dir, other, cleanup: () => (rmSync(dir, { recursive: true, force: true }), rmSync(other, { recursive: true, force: true })) };
}

test('safeWriteFile creates nested directories and returns the absolute path', () => {
  const t = tmp();
  try {
    const file = safeWriteFile(t.dir, '.dev-agent/tasks/APP-1.md', 'hello\n');
    assert.equal(file, join(realpathSync(t.dir), '.dev-agent', 'tasks', 'APP-1.md'));
    assert.equal(readFileSync(file, 'utf8'), 'hello\n');
  } finally {
    t.cleanup();
  }
});

test('absolute paths and escapes are refused', () => {
  const t = tmp();
  try {
    for (const bad of ['/etc/passwd', '../x', 'a/../../x', '.', '']) {
      assert.throws(() => resolveInside(t.dir, bad), /relative|escapes/, bad);
    }
    assert.ok(resolveInside(t.dir, '..foo/bar').endsWith(join('..foo', 'bar')));
  } finally {
    t.cleanup();
  }
});

test('a symlinked parent directory is refused and nothing is written through it', () => {
  const t = tmp();
  try {
    symlinkSync(t.other, join(t.dir, '.dev-agent'), 'dir');
    assert.throws(() => safeWriteFile(t.dir, '.dev-agent/tasks/APP-1.md', 'x'), /symbolic link/);
    assert.equal(existsSync(join(t.other, 'tasks')), false);
    assert.throws(() => safeReadFile(t.dir, '.dev-agent/tasks/APP-1.md'), /symbolic link/);
  } finally {
    t.cleanup();
  }
});

test('a symlinked target file is refused', () => {
  const t = tmp();
  try {
    mkdirSync(join(t.dir, 'out'));
    writeFileSync(join(t.other, 'secret.txt'), 'orig');
    symlinkSync(join(t.other, 'secret.txt'), join(t.dir, 'out', 'a.md'));
    assert.throws(() => safeWriteFile(t.dir, 'out/a.md', 'new'), /symbolic link/);
    assert.equal(readFileSync(join(t.other, 'secret.txt'), 'utf8'), 'orig');
  } finally {
    t.cleanup();
  }
});

test('secret-looking content is refused and no file is created', () => {
  const t = tmp();
  try {
    assert.throws(() => safeWriteFile(t.dir, 'out/a.md', 'token ghp_' + 'a'.repeat(30)), /secret/);
    assert.equal(existsSync(join(t.dir, 'out')), false);
  } finally {
    t.cleanup();
  }
});

test('safeReadFile returns null for a missing file and the content otherwise', () => {
  const t = tmp();
  try {
    assert.equal(safeReadFile(t.dir, 'nope/x.md'), null);
    safeWriteFile(t.dir, 'nope/x.md', 'hi');
    assert.equal(safeReadFile(t.dir, 'nope/x.md'), 'hi');
  } finally {
    t.cleanup();
  }
});

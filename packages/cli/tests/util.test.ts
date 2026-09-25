import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { effectiveCwd, findKitRoot, readKitVersion, which, sha256File, listFilesRecursive, assertRealDirInsideRoot } from '../src/util.ts';

test('findKitRoot walks up to the directory holding the kit package.json and skills/', () => {
  const root = findKitRoot();
  assert.ok(existsSync(join(root, 'skills', 'figma-to-code', 'SKILL.md')));
  assert.ok(existsSync(join(root, 'packages', 'mcp-server', 'src', 'index.ts')));
});

test('readKitVersion returns the cli package version', () => {
  assert.equal(readKitVersion(), '1.1.0');
});

test('which finds an executable on PATH and ignores non-executable files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontend-agent-which-'));
  try {
    writeFileSync(join(dir, 'fakehost'), '#!/bin/sh\n');
    chmodSync(join(dir, 'fakehost'), 0o755);
    writeFileSync(join(dir, 'notexec'), 'x');
    chmodSync(join(dir, 'notexec'), 0o644);
    mkdirSync(join(dir, 'adir'));
    assert.equal(which('fakehost', { PATH: dir }), join(dir, 'fakehost'));
    assert.equal(which('notexec', { PATH: dir }), null);
    assert.equal(which('adir', { PATH: dir }), null);
    assert.equal(which('fakehost', { PATH: '' }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sha256File hashes file bytes and listFilesRecursive returns sorted posix relative paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontend-agent-files-'));
  try {
    writeFileSync(join(dir, 'b.md'), 'abc');
    mkdirSync(join(dir, 'references'));
    writeFileSync(join(dir, 'references', 'a.md'), 'x');
    writeFileSync(join(dir, 'A.md'), 'y');
    assert.equal(sha256File(join(dir, 'b.md')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.deepEqual(listFilesRecursive(dir), ['A.md', 'b.md', 'references/a.md']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('assertRealDirInsideRoot accepts a missing dir under the root and an existing in-root dir', () => {
  const root = mkdtempSync(join(tmpdir(), 'frontend-agent-realdir-'));
  try {
    assert.doesNotThrow(() => assertRealDirInsideRoot(join(root, 'a', 'b', 'missing'), root));
    const inRoot = join(root, 'existing');
    mkdirSync(inRoot);
    assert.doesNotThrow(() => assertRealDirInsideRoot(inRoot, root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('assertRealDirInsideRoot rejects a dir that is, or sits under, a symlink to outside the root', () => {
  const base = mkdtempSync(join(tmpdir(), 'frontend-agent-realdir-sym-'));
  try {
    const root = join(base, 'root');
    const outside = join(base, 'outside');
    mkdirSync(root);
    mkdirSync(outside);
    const linked = join(root, 'linked');
    try {
      symlinkSync(outside, linked);
    } catch {
      // symlink creation unsupported in this environment — skip
      return;
    }
    assert.throws(() => assertRealDirInsideRoot(linked, root), /resolves outside the project root/);
    assert.throws(() => assertRealDirInsideRoot(join(linked, 'nested', 'missing'), root), /resolves outside the project root/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('findKitRoot accepts the published name and the historical one, and ignores other packages', () => {
  const base = mkdtempSync(join(tmpdir(), 'dak-kitroot-'));
  try {
    for (const [dir, name] of [['published', 'dev-agent-kit'], ['historical', 'frontend-agent-kit'], ['other', 'something-else']]) {
      mkdirSync(join(base, dir, 'skills'), { recursive: true });
      mkdirSync(join(base, dir, 'packages', 'cli', 'src'), { recursive: true });
      writeFileSync(join(base, dir, 'package.json'), JSON.stringify({ name }));
    }
    assert.equal(findKitRoot(join(base, 'published', 'packages', 'cli', 'src')), join(base, 'published'));
    assert.equal(findKitRoot(join(base, 'historical', 'packages', 'cli', 'src')), join(base, 'historical'));
    assert.throws(() => findKitRoot(join(base, 'other', 'packages', 'cli', 'src')), /could not find the kit/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('INIT_CWD is trusted only when npm ran the command from the kit checkout itself', () => {
  const base = mkdtempSync(join(tmpdir(), 'dak-cwd-'));
  try {
    const kit = join(base, 'kit');
    const other = join(base, 'monorepo', 'packages', 'app');
    mkdirSync(kit, { recursive: true });
    mkdirSync(other, { recursive: true });
    assert.equal(effectiveCwd({ INIT_CWD: '/somewhere/else' }, kit, kit), '/somewhere/else');
    assert.equal(effectiveCwd({ INIT_CWD: join(base, 'monorepo') }, other, kit), other);
    assert.equal(effectiveCwd({}, other, kit), other);
    mkdirSync(join(kit, 'packages', 'cli'), { recursive: true });
    assert.equal(effectiveCwd({ INIT_CWD: '/y' }, join(kit, 'packages', 'cli'), kit), '/y');
    symlinkSync(kit, join(base, 'kit-link'));
    assert.equal(effectiveCwd({ INIT_CWD: '/x' }, join(base, 'kit-link'), kit), '/x');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

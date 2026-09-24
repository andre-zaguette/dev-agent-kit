import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspace, removeWorkspace } from '../src/workspace.ts';
import { startStaticServer } from '../src/static-server.ts';

function withFixture(fn: (fixture: string) => Promise<void> | void) {
  const fixture = mkdtempSync(join(tmpdir(), 'fak-fixture-'));
  return Promise.resolve(fn(fixture)).finally(() => rmSync(fixture, { recursive: true, force: true }));
}

test('copies the fixture into a fresh fak-bench-* dir and removes it', async () => {
  await withFixture((fixture) => {
    mkdirSync(join(fixture, 'pages'));
    writeFileSync(join(fixture, 'pages', 'a.html'), 'A');
    const ws = createWorkspace(fixture);
    assert.match(ws, /fak-bench-/);
    assert.equal(readFileSync(join(ws, 'pages', 'a.html'), 'utf8'), 'A');
    removeWorkspace(ws);
    assert.equal(existsSync(ws), false);
  });
});

test('refuses fixtures with symlinks or over the size limit; removeWorkspace refuses foreign dirs', async () => {
  await withFixture((fixture) => {
    symlinkSync('/etc/hostname', join(fixture, 'link'));
    assert.throws(() => createWorkspace(fixture), /symbolic link: link/);
  });
  await withFixture((fixture) => {
    writeFileSync(join(fixture, 'big.bin'), Buffer.alloc(2048));
    assert.throws(() => createWorkspace(fixture, { maxBytes: 1024 }), /larger than 1024 bytes/);
  });
  assert.throws(() => removeWorkspace('/home'), /refusing to remove/);
});

test('static server serves files on 127.0.0.1, index.html for dirs, 404/403 otherwise', async () => {
  await withFixture(async (root) => {
    writeFileSync(join(root, 'index.html'), '<h1>home</h1>');
    mkdirSync(join(root, 'pages'));
    writeFileSync(join(root, 'pages', 'p.css'), 'a{}');
    const outside = mkdtempSync(join(tmpdir(), 'fak-outside-'));
    writeFileSync(join(outside, 'secret.txt'), 'SECRET');
    symlinkSync(join(outside, 'secret.txt'), join(root, 'leak.txt'));
    const server = await startStaticServer(root);
    try {
      assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
      const home = await fetch(`${server.origin}/`);
      assert.equal(home.status, 200);
      assert.match(await home.text(), /home/);
      const css = await fetch(`${server.origin}/pages/p.css`);
      assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');
      assert.equal((await fetch(`${server.origin}/missing.html`)).status, 404);
      assert.equal((await fetch(`${server.origin}/leak.txt`)).status, 403);
      // WHATWG URL normalizes %2e%2e dot-segments before pathname is read, so the traversal
      // never reaches the handler as "../.." — it collapses to an absolute-looking path under
      // root that simply doesn't exist there. Either way nothing outside root is served.
      const traversal = await fetch(`${server.origin}/%2e%2e/%2e%2e/etc/hostname`);
      assert.ok([403, 404].includes(traversal.status), `expected 403 or 404, got ${traversal.status}`);
      assert.equal((await fetch(`${server.origin}/`, { method: 'POST' })).status, 405);
    } finally {
      await server.close();
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

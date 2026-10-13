import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudeMem } from '../src/integrations/claude-mem.ts';
import { project, fakeBin } from './integration-helpers.ts';

function stubServer(status: number): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.statusCode = req.url === '/api/health' ? status : 404;
      res.end('{}');
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ port, close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}

function writePort(homeDir: string, content: string) {
  mkdirSync(join(homeDir, '.claude-mem'), { recursive: true });
  writeFileSync(join(homeDir, '.claude-mem', '.worker.port'), content);
}

test('nothing installed: absent', async () => {
  const { ctx, cleanup } = project();
  try {
    assert.deepEqual(await claudeMem.detect(ctx), { state: 'absent' });
  } finally {
    cleanup();
  }
});

test('healthy worker: present', async () => {
  const { homeDir, ctx, cleanup } = project();
  const server = await stubServer(200);
  try {
    writePort(homeDir, `${server.port}\n`);
    const detection = await claudeMem.detect(ctx);
    assert.equal(detection.state, 'present');
  } finally {
    await server.close();
    cleanup();
  }
});

test('worker answers with an error status, or nothing listens: unknown, never a throw', async () => {
  const { homeDir, ctx, cleanup } = project();
  const server = await stubServer(500);
  try {
    writePort(homeDir, String(server.port));
    assert.equal((await claudeMem.detect(ctx)).state, 'unknown');
    await server.close();
    assert.equal((await claudeMem.detect(ctx)).state, 'unknown');
  } finally {
    cleanup();
  }
});

test('empty, garbage or out-of-range port file: unknown, never a throw', async () => {
  const { homeDir, ctx, cleanup } = project();
  try {
    for (const content of ['', '\n', 'abc', '0', '99999', '-3', '12.5']) {
      writePort(homeDir, content);
      const detection = await claudeMem.detect(ctx);
      assert.equal(detection.state, 'unknown', `port file ${JSON.stringify(content)}`);
    }
  } finally {
    cleanup();
  }
});

test('launcher present but worker never started: unknown', async () => {
  const { homeDir, ctx, cleanup } = project();
  try {
    fakeBin(join(homeDir, '.local', 'bin'), 'claude-mem');
    assert.equal((await claudeMem.detect(ctx)).state, 'unknown');
  } finally {
    cleanup();
  }
});

test('verify: ok when present, warn with the install command otherwise, never fail; plan and notes', () => {
  const { ctx, cleanup } = project();
  try {
    assert.deepEqual(claudeMem.verify('claude', ctx, { state: 'present', detail: 'worker healthy' }, {}).map((c) => [c.ok, !!c.warn]), [[true, false]]);
    for (const detection of [{ state: 'absent' }, { state: 'unknown', reason: 'worker did not answer' }] as const) {
      const [check] = claudeMem.verify('claude', ctx, detection, {});
      assert.equal(check.ok, true);
      assert.equal(check.warn, true);
      assert.match(check.detail, /npx claude-mem install/);
    }
    assert.deepEqual(claudeMem.plan('claude', { state: 'absent' }), []);
    assert.match(claudeMem.notes('claude', { state: 'absent' }).join(' '), /npx claude-mem install/);
    assert.deepEqual(claudeMem.notes('claude', { state: 'present' }), []);
  } finally {
    cleanup();
  }
});

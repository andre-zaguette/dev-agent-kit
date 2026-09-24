import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, statSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { captureScreenshot } from '../src/screenshot.ts';
import { startFixtureServer, FIXTURE_HTML } from './fixtures/server.ts';

const { PNG } = createRequire(import.meta.url)('pngjs');

function withProjectRoot<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.FRONTEND_AGENT_PROJECT_ROOT;
  process.env.FRONTEND_AGENT_PROJECT_ROOT = root;
  return fn().finally(() => {
    if (previous === undefined) {
      delete process.env.FRONTEND_AGENT_PROJECT_ROOT;
    } else {
      process.env.FRONTEND_AGENT_PROJECT_ROOT = previous;
    }
  });
}

test('captureScreenshot writes a non-empty PNG for an allowed local URL', async () => {
  const fixture = await startFixtureServer(FIXTURE_HTML);
  const dir = mkdtempSync(join(tmpdir(), 'frontend-agent-screenshot-'));
  try {
    await withProjectRoot(dir, async () => {
      const result = await captureScreenshot({ url: fixture.url, width: 800, height: 600, outputPath: 'output.png' });
      assert.equal(result.outputPath, join(dir, 'output.png'));
      const stats = statSync(result.outputPath);
      assert.ok(stats.size > 1000, `expected a non-trivial PNG, got ${stats.size} bytes`);
    });
  } finally {
    await fixture.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('captureScreenshot rejects a disallowed external host and creates no file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontend-agent-screenshot-'));
  try {
    await withProjectRoot(dir, async () => {
      const outputPath = 'should-not-be-created.png';
      await assert.rejects(
        () => captureScreenshot({ url: 'http://example.com/', width: 800, height: 600, outputPath }),
        /host not allowed/
      );
      assert.equal(existsSync(join(dir, outputPath)), false);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('captureScreenshot rejects an outputPath that resolves outside the project root', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontend-agent-screenshot-'));
  const fixture = await startFixtureServer(FIXTURE_HTML);
  try {
    await withProjectRoot(dir, async () => {
      await assert.rejects(
        () => captureScreenshot({ url: fixture.url, width: 800, height: 600, outputPath: '../escape.png' }),
        /outside the project root/
      );
    });
  } finally {
    await fixture.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('captureScreenshot rejects an outputPath without a .png extension', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontend-agent-screenshot-'));
  const fixture = await startFixtureServer(FIXTURE_HTML);
  try {
    await withProjectRoot(dir, async () => {
      await assert.rejects(
        () => captureScreenshot({ url: fixture.url, width: 800, height: 600, outputPath: 'output.jpg' }),
        /\.png extension/
      );
    });
  } finally {
    await fixture.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('captureScreenshot resolves a relative outputPath to an absolute path inside the project root', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontend-agent-screenshot-'));
  const fixture = await startFixtureServer(FIXTURE_HTML);
  try {
    await withProjectRoot(dir, async () => {
      const result = await captureScreenshot({
        url: fixture.url,
        width: 800,
        height: 600,
        outputPath: 'nested/output.png'
      });
      assert.equal(result.outputPath, join(dir, 'nested', 'output.png'));
      assert.ok(existsSync(result.outputPath));
    });
  } finally {
    await fixture.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('captureScreenshot (R3a): fullPage defaults to true (captures the full scrollable page, not just the viewport)', async () => {
  const tallHtml = `<!doctype html><html><body style="margin:0"><div style="height:2000px;background:#fff">x</div></body></html>`;
  const fixture = await startFixtureServer(tallHtml);
  const dir = mkdtempSync(join(tmpdir(), 'frontend-agent-screenshot-'));
  try {
    await withProjectRoot(dir, async () => {
      const result = await captureScreenshot({ url: fixture.url, width: 400, height: 300, outputPath: 'full.png' });
      const png = PNG.sync.read(readFileSync(result.outputPath));
      assert.equal(png.width, 400);
      assert.ok(png.height > 300, `expected a full-page capture taller than the viewport, got ${png.height}`);
    });
  } finally {
    await fixture.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('captureScreenshot (R3a): fullPage: false captures just the viewport size', async () => {
  const tallHtml = `<!doctype html><html><body style="margin:0"><div style="height:2000px;background:#fff">x</div></body></html>`;
  const fixture = await startFixtureServer(tallHtml);
  const dir = mkdtempSync(join(tmpdir(), 'frontend-agent-screenshot-'));
  try {
    await withProjectRoot(dir, async () => {
      const result = await captureScreenshot({
        url: fixture.url,
        width: 400,
        height: 300,
        outputPath: 'viewport.png',
        fullPage: false
      });
      const png = PNG.sync.read(readFileSync(result.outputPath));
      assert.equal(png.width, 400);
      assert.equal(png.height, 300);
    });
  } finally {
    await fixture.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('captureScreenshot rejects a redirect to a disallowed host and writes no file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontend-agent-screenshot-'));
  const fixture = await startFixtureServer(FIXTURE_HTML, { redirectTo: 'http://example.com/' });
  try {
    await withProjectRoot(dir, async () => {
      const outputPath = 'redirect-should-not-write.png';
      await assert.rejects(
        () =>
          captureScreenshot({
            url: fixture.redirectUrl,
            width: 800,
            height: 600,
            outputPath
          }),
        /host not allowed after redirect/
      );
      assert.equal(existsSync(join(dir, outputPath)), false);
    });
  } finally {
    await fixture.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

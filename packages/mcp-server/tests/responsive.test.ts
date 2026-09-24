import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runResponsiveSuite } from '../src/responsive.ts';
import { startFixtureServer, FIXTURE_HTML } from './fixtures/server.ts';

const WIDE_HTML = `<!doctype html>
<html lang="en">
  <head><title>Wide</title><style>body { margin: 0; }</style></head>
  <body>
    <div class="banner" style="width: 1000px; height: 20px; background: #eee;"></div>
  </body>
</html>`;

async function withProjectRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'frontend-agent-responsive-'));
  const previous = process.env.FRONTEND_AGENT_PROJECT_ROOT;
  process.env.FRONTEND_AGENT_PROJECT_ROOT = root;
  try {
    return await fn(root);
  } finally {
    if (previous === undefined) delete process.env.FRONTEND_AGENT_PROJECT_ROOT;
    else process.env.FRONTEND_AGENT_PROJECT_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

test('a page that fits every default breakpoint passes, and screenshots land in outputDir', async () => {
  const fixture = await startFixtureServer(FIXTURE_HTML);
  try {
    await withProjectRoot(async (root) => {
      const result = await runResponsiveSuite({ url: fixture.url, outputDir: 'responsive' });
      assert.deepEqual(result.breakpoints.map((b) => b.name), ['desktop', 'laptop', 'tablet', 'mobile']);
      assert.equal(result.required, true);
      assert.equal(result.passed, true);
      for (const breakpoint of result.breakpoints) {
        assert.equal(breakpoint.hasHorizontalOverflow, false);
        assert.equal(breakpoint.screenshotPath, join(root, 'responsive', `${breakpoint.name}.png`));
        assert.ok(existsSync(breakpoint.screenshotPath!));
      }
    });
  } finally {
    await fixture.close();
  }
});

test('overflow is reported only at the breakpoints where it happens, naming the offending element', async () => {
  const fixture = await startFixtureServer(WIDE_HTML);
  try {
    await withProjectRoot(async () => {
      const result = await runResponsiveSuite({ url: fixture.url });
      const byName = Object.fromEntries(result.breakpoints.map((b) => [b.name, b]));
      assert.equal(byName.desktop.hasHorizontalOverflow, false);
      assert.equal(byName.laptop.hasHorizontalOverflow, false);
      assert.equal(byName.tablet.hasHorizontalOverflow, true);
      assert.equal(byName.mobile.hasHorizontalOverflow, true);
      assert.ok(byName.mobile.overflowingElements.some((el) => el.includes('div.banner')));
      assert.equal(byName.mobile.screenshotPath, null);
      assert.equal(result.passed, false);
    });
  } finally {
    await fixture.close();
  }
});

test('explicit breakpoints override the configured set', async () => {
  const fixture = await startFixtureServer(WIDE_HTML);
  try {
    await withProjectRoot(async () => {
      const result = await runResponsiveSuite({ url: fixture.url, breakpoints: [{ name: 'huge', width: 1600, height: 900 }] });
      assert.deepEqual(result.breakpoints.map((b) => b.name), ['huge']);
      assert.equal(result.passed, true);
    });
  } finally {
    await fixture.close();
  }
});

test('runResponsiveSuite rejects an outputDir outside the project root and a disallowed host', async () => {
  await withProjectRoot(async () => {
    await assert.rejects(
      () => runResponsiveSuite({ url: 'http://127.0.0.1:1/', outputDir: '../out' }),
      /run_responsive_suite: outputDir "\.\.\/out" resolves outside the project root/
    );
    await assert.rejects(() => runResponsiveSuite({ url: 'http://example.com/' }), /run_responsive_suite: host not allowed/);
  });
});

test('breakpoint with escape sequence in name is rejected before any page is opened', async () => {
  await withProjectRoot(async (root) => {
    await assert.rejects(
      () => runResponsiveSuite({ url: 'http://127.0.0.1:1/', outputDir: 'screenshots', breakpoints: [{ name: '../escape', width: 390, height: 844 }] }),
      /run_responsive_suite: invalid breakpoint name "\.\.\/escape" \(allowed: letters, digits, _ and -\)\./
    );
    // Verify no files were created outside the project root
    const screenshotsDir = join(root, 'screenshots');
    assert.equal(existsSync(screenshotsDir), false);
  });
});

test('empty breakpoints array is rejected', async () => {
  await withProjectRoot(async () => {
    await assert.rejects(
      () => runResponsiveSuite({ url: 'http://127.0.0.1:1/', breakpoints: [] }),
      /run_responsive_suite: breakpoints array cannot be empty/
    );
  });
});

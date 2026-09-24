import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAccessibilityAudit } from '../src/a11y.ts';
import { withAllowedPages } from '../src/browser.js';
import { startFixtureServer, FIXTURE_HTML } from './fixtures/server.ts';

const BROKEN_HTML = `<!doctype html>
<html lang="en">
  <head><title>Broken</title></head>
  <body>
    <main>
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
      <button></button>
    </main>
  </body>
</html>`;

test('runAccessibilityAudit fails a page with critical violations and names them', async () => {
  const fixture = await startFixtureServer(BROKEN_HTML);
  try {
    const result = await runAccessibilityAudit({ url: fixture.url });
    assert.equal(result.passed, false);
    assert.ok(result.criticalCount >= 2, `expected >= 2 critical, got ${result.criticalCount}`);
    assert.equal(result.countsByImpact.critical, result.criticalCount);
    const ids = result.violations.map((v) => v.id);
    assert.ok(ids.includes('image-alt'));
    assert.ok(ids.includes('button-name'));
    const imageAlt = result.violations.find((v) => v.id === 'image-alt')!;
    assert.equal(imageAlt.impact, 'critical');
    assert.ok(imageAlt.targets.length >= 1);
  } finally {
    await fixture.close();
  }
});

test('runAccessibilityAudit passes a page whose only violations are below critical', async () => {
  const fixture = await startFixtureServer(FIXTURE_HTML);
  try {
    const result = await runAccessibilityAudit({ url: fixture.url });
    assert.equal(result.criticalCount, 0);
    assert.equal(result.maxCriticalA11yIssues, 0);
    assert.equal(result.passed, true);
  } finally {
    await fixture.close();
  }
});

test('runAccessibilityAudit rejects a disallowed host', async () => {
  await assert.rejects(() => runAccessibilityAudit({ url: 'http://example.com/' }), /run_accessibility_audit: host not allowed/);
});

test('each allowed page is isolated in its own context (cookies do not leak between pages)', async () => {
  const fixture = await startFixtureServer(FIXTURE_HTML);
  try {
    await withAllowedPages('test-isolation', fixture.url, async (open) => {
      const page1 = await open();
      await page1.evaluate(() => {
        document.cookie = 'probe=page1';
      });
      const cookie1 = await page1.evaluate(() => document.cookie);
      assert.ok(cookie1.includes('probe=page1'), 'page1 should have its own cookie');

      const page2 = await open();
      const cookie2 = await page2.evaluate(() => document.cookie);
      assert.ok(!cookie2.includes('probe'), 'page2 should not see page1 cookie');
    });
  } finally {
    await fixture.close();
  }
});

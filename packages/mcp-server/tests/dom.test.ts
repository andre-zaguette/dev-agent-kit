import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectDom } from '../src/dom.ts';
import { startFixtureServer, FIXTURE_HTML } from './fixtures/server.ts';

const HIDDEN_FIXTURE_HTML = `<!doctype html>
<html>
  <body>
    <div data-testid="hidden-box" style="display: none;">Hidden</div>
  </body>
</html>`;

test('inspectDom returns rect and computed styles for a matching selector', async () => {
  const fixture = await startFixtureServer(FIXTURE_HTML);
  try {
    const result = await inspectDom({ url: fixture.url, selector: '[data-testid="hero-title"]' });
    assert.equal(result.selector, '[data-testid="hero-title"]');
    assert.ok(result.rect.width > 0);
    assert.ok(result.rect.height > 0);
    assert.equal(result.styles.fontSize, '32px');
    assert.equal(result.styles.color, 'rgb(17, 24, 39)');
  } finally {
    await fixture.close();
  }
});

test('inspectDom throws a clear error when the selector matches nothing', async () => {
  const fixture = await startFixtureServer(FIXTURE_HTML);
  try {
    await assert.rejects(
      () => inspectDom({ url: fixture.url, selector: '.does-not-exist' }),
      /no element matched selector/
    );
  } finally {
    await fixture.close();
  }
});

test('inspectDom throws a distinct error when the element has no bounding box', async () => {
  const fixture = await startFixtureServer(HIDDEN_FIXTURE_HTML);
  try {
    await assert.rejects(
      () => inspectDom({ url: fixture.url, selector: '[data-testid="hidden-box"]' }),
      /matched selector "\[data-testid="hidden-box"\]" but is not rendered \(no bounding box\)/
    );
  } finally {
    await fixture.close();
  }
});

test('inspectDom rejects a disallowed external host', async () => {
  await assert.rejects(
    () => inspectDom({ url: 'http://example.com/', selector: 'body' }),
    /host not allowed/
  );
});

test('inspectDom rejects a redirect to a disallowed host', async () => {
  const fixture = await startFixtureServer(FIXTURE_HTML, { redirectTo: 'http://example.com/' });
  try {
    await assert.rejects(
      () => inspectDom({ url: fixture.redirectUrl, selector: 'body' }),
      /host not allowed after redirect/
    );
  } finally {
    await fixture.close();
  }
});

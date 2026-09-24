import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareScreenshots, decideVerdict, resolveDefaultViewport } from '../src/compare.ts';
import { DEFAULT_PROFILES, DEFAULT_BREAKPOINTS } from '../src/config.ts';
import type { PixelDiffResult } from '../src/pixel-diff.ts';
import { startFixtureServer, FIXTURE_HTML } from './fixtures/server.ts';
import { writeSolidPng } from './fixtures/png.ts';

const WHITE: [number, number, number] = [255, 255, 255];

async function withProjectRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'frontend-agent-compare-'));
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

const samePixels: PixelDiffResult = {
  dimensionsMatch: true, baselineSize: { width: 10, height: 10 }, actualSize: { width: 10, height: 10 },
  diffPixels: 0, totalPixels: 100, similarity: 1, diffOutputPath: null, comparedRegion: { width: 10, height: 10 }
};
const noGeometry = { checked: false, deviations: [], missingSelectors: [] };

test('decideVerdict: perfect pixels without a geometry check is incomplete, never pass (spec §7)', () => {
  const decision = decideVerdict(samePixels, noGeometry, DEFAULT_PROFILES.standard);
  assert.equal(decision.verdict, 'incomplete');
  assert.deepEqual(decision.failures, []);
  assert.ok(decision.notes.some((note) => /geometry/.test(note)));
});

test('decideVerdict: similarity below a numeric target fails; pixel-perfect treats it as informational', () => {
  const low = { ...samePixels, diffPixels: 10, similarity: 0.9 };
  const geometryOk = { checked: true, deviations: [], missingSelectors: [] };
  assert.equal(decideVerdict(low, geometryOk, DEFAULT_PROFILES.standard).verdict, 'fail');
  assert.equal(decideVerdict(low, geometryOk, DEFAULT_PROFILES.relaxed).verdict, 'pass');
  const perfect = decideVerdict(low, geometryOk, DEFAULT_PROFILES['pixel-perfect']);
  assert.equal(perfect.verdict, 'pass');
  assert.ok(perfect.notes.some((note) => /informational/.test(note)));
});

test('decideVerdict: mismatched dimensions fail under a numeric target', () => {
  const mismatch = { ...samePixels, dimensionsMatch: false, actualSize: { width: 12, height: 10 }, diffPixels: null, totalPixels: null, similarity: null };
  const decision = decideVerdict(mismatch, { checked: true, deviations: [], missingSelectors: [] }, DEFAULT_PROFILES.standard);
  assert.equal(decision.verdict, 'fail');
  assert.ok(decision.failures.some((failure) => /10x10.*12x10/.test(failure)));
});

test('decideVerdict: an out-of-tolerance deviation or a missing selector fails', () => {
  const deviation = {
    selector: 'h1', property: 'width', kind: 'geometry' as const, expected: 100, actual: 110,
    delta: 10, tolerance: 3, withinTolerance: false
  };
  assert.equal(decideVerdict(samePixels, { checked: true, deviations: [deviation], missingSelectors: [] }, DEFAULT_PROFILES.standard).verdict, 'fail');
  assert.equal(decideVerdict(samePixels, { checked: true, deviations: [], missingSelectors: ['.x'] }, DEFAULT_PROFILES.standard).verdict, 'fail');
});

test('compareScreenshots rejects paths outside the project root before reading anything', async () => {
  await withProjectRoot(async () => {
    await assert.rejects(
      () => compareScreenshots({ baselinePath: '../a.png', actualPath: 'b.png' }),
      /compare_screenshots: baselinePath "\.\.\/a\.png" resolves outside the project root/
    );
    await assert.rejects(
      () => compareScreenshots({ baselinePath: 'a.png', actualPath: 'b.png', diffOutputPath: '/tmp/x.png' }),
      /compare_screenshots: diffOutputPath "\/tmp\/x\.png" resolves outside the project root/
    );
  });
});

test('compareScreenshots with only PNGs returns an incomplete verdict and writes the diff inside the root', async () => {
  await withProjectRoot(async (root) => {
    writeSolidPng(join(root, 'a.png'), 10, 10, WHITE);
    writeSolidPng(join(root, 'b.png'), 10, 10, WHITE);
    const result = await compareScreenshots({ baselinePath: 'a.png', actualPath: 'b.png', diffOutputPath: 'out/diff.png' });
    assert.equal(result.validationProfile, 'standard');
    assert.equal(result.pixel.similarity, 1);
    assert.equal(result.geometry.checked, false);
    assert.equal(result.verdict, 'incomplete');
    assert.equal(result.pixel.diffOutputPath, join(root, 'out', 'diff.png'));
    assert.ok(existsSync(join(root, 'out', 'diff.png')));
  });
});

test('compareScreenshots measures elements on an allowed page and reports missing selectors', async () => {
  const fixture = await startFixtureServer(FIXTURE_HTML);
  try {
    await withProjectRoot(async (root) => {
      writeSolidPng(join(root, 'a.png'), 800, 600, WHITE);
      writeSolidPng(join(root, 'b.png'), 800, 600, WHITE);
      const result = await compareScreenshots({
        baselinePath: 'a.png',
        actualPath: 'b.png',
        url: fixture.url,
        elements: [
          { selector: '[data-testid="hero-title"]', fontSize: 32, color: '#111827' },
          { selector: '.does-not-exist', width: 10 }
        ]
      });
      assert.equal(result.geometry.checked, true);
      assert.ok(result.geometry.deviations.every((d) => d.withinTolerance));
      assert.deepEqual(result.geometry.missingSelectors, ['.does-not-exist']);
      assert.equal(result.verdict, 'fail');
    });
  } finally {
    await fixture.close();
  }
});

test('decideVerdict (R3b): heights-only differing is a note, not a failure, and the target applies to the overlap', () => {
  const heightsDiffer: PixelDiffResult = {
    dimensionsMatch: false,
    baselineSize: { width: 10, height: 20 },
    actualSize: { width: 10, height: 10 },
    diffPixels: 0,
    totalPixels: 100,
    similarity: 1,
    diffOutputPath: null,
    comparedRegion: { width: 10, height: 10 }
  };
  const geometryOk = { checked: true, deviations: [], missingSelectors: [] };
  const decision = decideVerdict(heightsDiffer, geometryOk, DEFAULT_PROFILES.standard);
  assert.equal(decision.verdict, 'pass');
  assert.ok(decision.notes.some((note) => /heights differ \(baseline 10x20 vs actual 10x10\); compared the top 10x10 overlap/.test(note)));

  const lowSimilarity = { ...heightsDiffer, diffPixels: 50, similarity: 0.5 };
  const failing = decideVerdict(lowSimilarity, geometryOk, DEFAULT_PROFILES.standard);
  assert.equal(failing.verdict, 'fail');
  assert.ok(failing.failures.some((failure) => /pixel similarity 0.5 is below the profile target/.test(failure)));
});

test('resolveDefaultViewport (R2): width from the baseline, height from the matching breakpoint, else 900', () => {
  const breakpoints = DEFAULT_BREAKPOINTS;
  assert.deepEqual(resolveDefaultViewport({ width: 1440, height: 5000 }, breakpoints), {
    viewport: { width: 1440, height: 900 },
    notes: []
  });
  assert.deepEqual(resolveDefaultViewport({ width: 768, height: 5000 }, breakpoints), {
    viewport: { width: 768, height: 1024 },
    notes: []
  });
  assert.deepEqual(resolveDefaultViewport({ width: 401, height: 5000 }, breakpoints), {
    viewport: { width: 401, height: 900 },
    notes: []
  });
});

test('resolveDefaultViewport (R2): a baseline that is a 2x/3x export of a breakpoint gets a note, not a matching height', () => {
  const breakpoints = DEFAULT_BREAKPOINTS; // includes mobile: 390x844
  const twoX = resolveDefaultViewport({ width: 780, height: 5000 }, breakpoints);
  assert.deepEqual(twoX.viewport, { width: 780, height: 900 });
  assert.equal(twoX.notes.length, 1);
  assert.match(twoX.notes[0], /baseline is 780px wide — looks like a 2x export of the mobile frame; export at 1x or pass "viewport"/);

  const threeX = resolveDefaultViewport({ width: 1170, height: 5000 }, breakpoints);
  assert.match(threeX.notes[0], /looks like a 3x export of the mobile frame/);
});

test('compareScreenshots (R1): an element with no expected properties is rejected before any I/O, and never yields pass', async () => {
  const fixture = await startFixtureServer(FIXTURE_HTML);
  try {
    await withProjectRoot(async (root) => {
      writeSolidPng(join(root, 'a.png'), 800, 600, WHITE);
      writeSolidPng(join(root, 'b.png'), 800, 600, WHITE);
      await assert.rejects(
        () =>
          compareScreenshots({
            baselinePath: 'a.png',
            actualPath: 'b.png',
            url: fixture.url,
            elements: [{ selector: '[data-testid="hero-title"]' }]
          }),
        /compare_screenshots: element "\[data-testid="hero-title"\]" has no expected properties/
      );
    });
  } finally {
    await fixture.close();
  }
});

test('compareScreenshots (Minor #6): diffOutputPath must differ from baselinePath and actualPath', async () => {
  await withProjectRoot(async (root) => {
    writeSolidPng(join(root, 'a.png'), 10, 10, WHITE);
    writeSolidPng(join(root, 'b.png'), 10, 10, WHITE);
    await assert.rejects(
      () => compareScreenshots({ baselinePath: 'a.png', actualPath: 'b.png', diffOutputPath: 'a.png' }),
      /compare_screenshots: diffOutputPath must differ from baselinePath and actualPath/
    );
    await assert.rejects(
      () => compareScreenshots({ baselinePath: 'a.png', actualPath: 'b.png', diffOutputPath: 'b.png' }),
      /compare_screenshots: diffOutputPath must differ from baselinePath and actualPath/
    );
  });
});

test('compareScreenshots (Minor #7): a disallowed url is rejected before diffPngFiles writes a diff file', async () => {
  await withProjectRoot(async (root) => {
    writeSolidPng(join(root, 'a.png'), 10, 10, WHITE);
    writeSolidPng(join(root, 'b.png'), 10, 10, WHITE);
    await assert.rejects(
      () =>
        compareScreenshots({
          baselinePath: 'a.png',
          actualPath: 'b.png',
          diffOutputPath: 'out/diff.png',
          url: 'http://example.com/'
        }),
      /compare_screenshots: host not allowed for "http:\/\/example\.com\/"/
    );
    assert.equal(existsSync(join(root, 'out', 'diff.png')), false);
  });
});

test('compareScreenshots (R4): oklch colors are compared via their sRGB round-trip, not the raw CSS function text', async () => {
  const html = `<!doctype html><html><body>
    <div id="black" style="color: oklch(0 0 0)">x</div>
    <div id="white" style="color: oklch(1 0 0)">x</div>
  </body></html>`;
  const fixture = await startFixtureServer(html);
  try {
    await withProjectRoot(async (root) => {
      writeSolidPng(join(root, 'a.png'), 800, 600, WHITE);
      writeSolidPng(join(root, 'b.png'), 800, 600, WHITE);
      const result = await compareScreenshots({
        baselinePath: 'a.png',
        actualPath: 'b.png',
        url: fixture.url,
        elements: [
          { selector: '#black', color: '#000000' },
          { selector: '#white', color: '#ffffff' }
        ]
      });
      assert.equal(result.geometry.checked, true);
      const byId = Object.fromEntries(result.geometry.deviations.map((d) => [d.selector, d]));
      assert.equal(byId['#black'].withinTolerance, true, JSON.stringify(byId['#black']));
      assert.equal(byId['#white'].withinTolerance, true, JSON.stringify(byId['#white']));
    });
  } finally {
    await fixture.close();
  }
});

test('compareScreenshots (Follow-up #1): an rgba() color is compared as-authored, not round-tripped through the canvas', async () => {
  const html = `<!doctype html><html><body>
    <div id="a" style="color: rgba(17, 24, 39, 0.5)">x</div>
    <div id="b" style="color: rgba(200, 100, 50, 0.3)">x</div>
  </body></html>`;
  const fixture = await startFixtureServer(html);
  try {
    await withProjectRoot(async (root) => {
      writeSolidPng(join(root, 'a.png'), 800, 600, WHITE);
      writeSolidPng(join(root, 'b.png'), 800, 600, WHITE);
      const result = await compareScreenshots({
        baselinePath: 'a.png',
        actualPath: 'b.png',
        url: fixture.url,
        elements: [
          { selector: '#a', color: 'rgba(17, 24, 39, 0.5)' },
          { selector: '#b', color: 'rgba(200, 100, 50, 0.3)' }
        ]
      });
      assert.equal(result.geometry.checked, true);
      const byId = Object.fromEntries(result.geometry.deviations.map((d) => [d.selector, d]));
      assert.equal(byId['#a'].withinTolerance, true, JSON.stringify(byId['#a']));
      assert.equal(byId['#b'].withinTolerance, true, JSON.stringify(byId['#b']));
    });
  } finally {
    await fixture.close();
  }
});

test('compareScreenshots (Minor #8): gap compares against columnGap for a row-direction flex container', async () => {
  const html = `<!doctype html><html><body>
    <div id="row" style="display:flex;flex-direction:row;column-gap:24px;">
      <span>a</span><span>b</span>
    </div>
  </body></html>`;
  const fixture = await startFixtureServer(html);
  try {
    await withProjectRoot(async (root) => {
      writeSolidPng(join(root, 'a.png'), 800, 600, WHITE);
      writeSolidPng(join(root, 'b.png'), 800, 600, WHITE);
      const result = await compareScreenshots({
        baselinePath: 'a.png',
        actualPath: 'b.png',
        url: fixture.url,
        elements: [{ selector: '#row', gap: 24, rowGap: 0, columnGap: 24 }]
      });
      assert.equal(result.geometry.checked, true);
      const byProperty = Object.fromEntries(result.geometry.deviations.map((d) => [d.property, d]));
      assert.equal(byProperty.gap.withinTolerance, true, JSON.stringify(byProperty.gap));
      assert.equal(byProperty.rowGap.withinTolerance, true, JSON.stringify(byProperty.rowGap));
      assert.equal(byProperty.columnGap.withinTolerance, true, JSON.stringify(byProperty.columnGap));
    });
  } finally {
    await fixture.close();
  }
});

test('compareScreenshots rejects elements without a url, and a disallowed url', async () => {
  await withProjectRoot(async (root) => {
    writeSolidPng(join(root, 'a.png'), 10, 10, WHITE);
    writeSolidPng(join(root, 'b.png'), 10, 10, WHITE);
    await assert.rejects(
      () => compareScreenshots({ baselinePath: 'a.png', actualPath: 'b.png', elements: [{ selector: 'h1', width: 1 }] }),
      /compare_screenshots: "elements" requires "url"/
    );
    await assert.rejects(
      () => compareScreenshots({ baselinePath: 'a.png', actualPath: 'b.png', url: 'http://example.com/', elements: [{ selector: 'h1', width: 1 }] }),
      /host not allowed/
    );
  });
});

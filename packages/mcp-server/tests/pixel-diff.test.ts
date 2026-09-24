import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffPngFiles } from '../src/pixel-diff.ts';
import { writeSolidPng } from './fixtures/png.ts';

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'frontend-agent-pixel-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('identical images have similarity 1 and zero diff pixels', () => {
  withTempDir((dir) => {
    writeSolidPng(join(dir, 'a.png'), 10, 10, WHITE);
    writeSolidPng(join(dir, 'b.png'), 10, 10, WHITE);
    const result = diffPngFiles(join(dir, 'a.png'), join(dir, 'b.png'), null, 'compare_screenshots');
    assert.equal(result.dimensionsMatch, true);
    assert.equal(result.diffPixels, 0);
    assert.equal(result.totalPixels, 100);
    assert.equal(result.similarity, 1);
    assert.equal(result.diffOutputPath, null);
  });
});

test('ten changed pixels out of 100 give similarity 0.9 and a written diff image', () => {
  withTempDir((dir) => {
    const paint = Array.from({ length: 10 }, (_, x) => ({ x, y: 0, rgb: BLACK }));
    writeSolidPng(join(dir, 'a.png'), 10, 10, WHITE);
    writeSolidPng(join(dir, 'b.png'), 10, 10, WHITE, paint);
    const diffPath = join(dir, 'diff.png');
    const result = diffPngFiles(join(dir, 'a.png'), join(dir, 'b.png'), diffPath, 'compare_screenshots');
    assert.equal(result.diffPixels, 10);
    assert.equal(result.similarity, 0.9);
    assert.equal(result.diffOutputPath, diffPath);
    assert.ok(existsSync(diffPath));
  });
});

test('different widths are reported without comparing pixels or writing a diff', () => {
  withTempDir((dir) => {
    writeSolidPng(join(dir, 'a.png'), 10, 10, WHITE);
    writeSolidPng(join(dir, 'b.png'), 12, 10, WHITE);
    const diffPath = join(dir, 'diff.png');
    const result = diffPngFiles(join(dir, 'a.png'), join(dir, 'b.png'), diffPath, 'compare_screenshots');
    assert.equal(result.dimensionsMatch, false);
    assert.deepEqual(result.baselineSize, { width: 10, height: 10 });
    assert.deepEqual(result.actualSize, { width: 12, height: 10 });
    assert.equal(result.similarity, null);
    assert.equal(result.diffPixels, null);
    assert.equal(result.diffOutputPath, null);
    assert.equal(result.comparedRegion, null);
    assert.equal(existsSync(diffPath), false);
  });
});

test('R3b: same width, different height diffs the overlapping top region and reports comparedRegion', () => {
  withTempDir((dir) => {
    // baseline is 10x20 white; actual is 10x10 white with 5 changed pixels
    // inside the overlap (row 0) so they only show up if the overlap is diffed.
    const paint = Array.from({ length: 5 }, (_, x) => ({ x, y: 0, rgb: BLACK }));
    writeSolidPng(join(dir, 'a.png'), 10, 20, WHITE);
    writeSolidPng(join(dir, 'b.png'), 10, 10, WHITE, paint);
    const diffPath = join(dir, 'diff.png');
    const result = diffPngFiles(join(dir, 'a.png'), join(dir, 'b.png'), diffPath, 'compare_screenshots');
    assert.equal(result.dimensionsMatch, false);
    assert.deepEqual(result.baselineSize, { width: 10, height: 20 });
    assert.deepEqual(result.actualSize, { width: 10, height: 10 });
    assert.deepEqual(result.comparedRegion, { width: 10, height: 10 });
    assert.equal(result.diffPixels, 5);
    assert.equal(result.totalPixels, 100);
    assert.equal(result.similarity, 0.95);
    assert.equal(result.diffOutputPath, diffPath);
    assert.ok(existsSync(diffPath));
  });
});

test('a missing or non-PNG file throws a clear error naming the file', () => {
  withTempDir((dir) => {
    writeSolidPng(join(dir, 'a.png'), 10, 10, WHITE);
    writeFileSync(join(dir, 'not.png'), 'hello');
    assert.throws(
      () => diffPngFiles(join(dir, 'a.png'), join(dir, 'missing.png'), null, 'compare_screenshots'),
      /compare_screenshots: could not read PNG ".*missing\.png"/
    );
    assert.throws(
      () => diffPngFiles(join(dir, 'a.png'), join(dir, 'not.png'), null, 'compare_screenshots'),
      /compare_screenshots: could not read PNG ".*not\.png"/
    );
  });
});

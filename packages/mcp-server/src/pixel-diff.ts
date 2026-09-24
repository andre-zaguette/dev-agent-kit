import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export interface ImageSize {
  width: number;
  height: number;
}

export interface PixelDiffResult {
  dimensionsMatch: boolean;
  baselineSize: ImageSize;
  actualSize: ImageSize;
  diffPixels: number | null;
  totalPixels: number | null;
  similarity: number | null;
  diffOutputPath: string | null;
  /** The region actually pixel-compared, or null when nothing was compared (widths differ). */
  comparedRegion: ImageSize | null;
}

export function readPng(filePath: string, toolName: string): PNG {
  try {
    return PNG.sync.read(readFileSync(filePath));
  } catch (error) {
    throw new Error(`${toolName}: could not read PNG "${filePath}": ${(error as Error).message}`);
  }
}

/**
 * Pixel-compare two PNGs.
 *
 * Widths must match for any comparison to happen at all: when they differ,
 * the result reports both sizes with null diff fields, and no diff image is
 * written (dimensionsMatch: false, comparedRegion: null).
 *
 * When widths match but heights differ (R3b), the overlapping top region
 * (width x min height) is diffed instead, `similarity` is reported over that
 * region, and `comparedRegion` names its size — `dimensionsMatch` still
 * stays false, since the images are not the same size.
 */
export function diffPngFiles(
  baselinePath: string,
  actualPath: string,
  diffOutputPath: string | null,
  toolName: string
): PixelDiffResult {
  const baseline = readPng(baselinePath, toolName);
  const actual = readPng(actualPath, toolName);
  const baselineSize = { width: baseline.width, height: baseline.height };
  const actualSize = { width: actual.width, height: actual.height };

  if (baseline.width !== actual.width) {
    return {
      dimensionsMatch: false,
      baselineSize,
      actualSize,
      diffPixels: null,
      totalPixels: null,
      similarity: null,
      diffOutputPath: null,
      comparedRegion: null
    };
  }

  const dimensionsMatch = baseline.height === actual.height;
  const width = baseline.width;
  const height = Math.min(baseline.height, actual.height);
  const regionBytes = width * height * 4;
  const baselineData = dimensionsMatch ? baseline.data : baseline.data.subarray(0, regionBytes);
  const actualData = dimensionsMatch ? actual.data : actual.data.subarray(0, regionBytes);

  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(baselineData, actualData, diff.data, width, height, { threshold: 0.1 });
  const totalPixels = width * height;

  if (diffOutputPath) {
    mkdirSync(path.dirname(diffOutputPath), { recursive: true });
    writeFileSync(diffOutputPath, PNG.sync.write(diff));
  }

  return {
    dimensionsMatch,
    baselineSize,
    actualSize,
    diffPixels,
    totalPixels,
    similarity: 1 - diffPixels / totalPixels,
    diffOutputPath: diffOutputPath ?? null,
    comparedRegion: { width, height }
  };
}

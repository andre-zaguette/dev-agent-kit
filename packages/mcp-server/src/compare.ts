import { resolveProjectPath } from './paths.js';
import { withAllowedPages, type Viewport } from './browser.js';
import { loadProjectConfig, type Breakpoint, type ValidationProfile, type ValidationProfileName } from './config.js';
import { isHostAllowed } from './security.js';
import { diffPngFiles, type PixelDiffResult } from './pixel-diff.js';
import {
  evaluateExpectations,
  hasMeasurableProperty,
  measureElements,
  type ElementExpectation,
  type GeometryCheck
} from './geometry.js';

const TOOL = 'compare_screenshots';

export interface CompareScreenshotsInput {
  baselinePath: string;
  actualPath: string;
  diffOutputPath?: string;
  url?: string;
  elements?: ElementExpectation[];
  viewport?: Viewport;
}

export type Verdict = 'pass' | 'fail' | 'incomplete';

export interface CompareScreenshotsResult {
  validationProfile: ValidationProfileName;
  profile: ValidationProfile;
  pixel: PixelDiffResult;
  geometry: GeometryCheck;
  verdict: Verdict;
  failures: string[];
  notes: string[];
}

function size(s: { width: number; height: number }): string {
  return `${s.width}x${s.height}`;
}

export function decideVerdict(
  pixel: PixelDiffResult,
  geometry: GeometryCheck,
  profile: ValidationProfile
): { verdict: Verdict; failures: string[]; notes: string[] } {
  const failures: string[] = [];
  const notes: string[] = [];
  const target = profile.pixelSimilarityTarget;

  // R3b: widths differing is a hard dimension mismatch (as before). Widths
  // matching but heights differing is not: the overlapping top region was
  // already diffed (pixel-diff.ts), so it only earns a note, and the
  // similarity target applies to that region like a normal comparison.
  const widthsMatch = pixel.baselineSize.width === pixel.actualSize.width;
  const heightsOnlyDiffer = !pixel.dimensionsMatch && widthsMatch;
  const heightsDifferNote = () => {
    const region = pixel.comparedRegion ? size(pixel.comparedRegion) : 'n/a';
    return `heights differ (baseline ${size(pixel.baselineSize)} vs actual ${size(pixel.actualSize)}); compared the top ${region} overlap`;
  };

  if (target === 'informational') {
    notes.push('pixel similarity is informational under this profile (rendering noise varies by OS/browser); it does not gate the verdict');
    if (!pixel.dimensionsMatch) {
      notes.push(heightsOnlyDiffer ? heightsDifferNote() : `screenshot dimensions differ: baseline ${size(pixel.baselineSize)} vs actual ${size(pixel.actualSize)}`);
    }
  } else if (!pixel.dimensionsMatch && !widthsMatch) {
    failures.push(`screenshot dimensions differ: baseline ${size(pixel.baselineSize)} vs actual ${size(pixel.actualSize)}`);
  } else {
    if (heightsOnlyDiffer) notes.push(heightsDifferNote());
    if ((pixel.similarity ?? 0) < target) {
      failures.push(`pixel similarity ${pixel.similarity} is below the profile target ${target}`);
    }
  }

  for (const selector of geometry.missingSelectors) {
    failures.push(`selector "${selector}" matched no rendered element`);
  }
  for (const d of geometry.deviations) {
    if (d.withinTolerance) continue;
    failures.push(
      d.kind === 'color'
        ? `${d.selector} ${d.property}: expected ${d.expected}, got ${d.actual}`
        : `${d.selector} ${d.property}: expected ${d.expected}, got ${d.actual} (delta ${d.delta}, tolerance ${d.tolerance})`
    );
  }

  if (failures.length > 0) return { verdict: 'fail', failures, notes };
  if (!geometry.checked) {
    notes.push('geometry was not checked (pass "url" and "elements"); pixel similarity alone never approves a screen (spec §7)');
    return { verdict: 'incomplete', failures, notes };
  }
  return { verdict: 'pass', failures, notes };
}

/**
 * R2: default geometry viewport when `viewport` is not passed.
 * width = baseline width; height = the height of the configured breakpoint
 * whose width equals the baseline width, else 900. If the baseline width is
 * exactly 2x or 3x some configured breakpoint's width, a note flags that it
 * looks like a Nx export.
 */
export function resolveDefaultViewport(
  baselineSize: { width: number; height: number },
  breakpoints: Breakpoint[]
): { viewport: Viewport; notes: string[] } {
  const notes: string[] = [];
  const width = baselineSize.width;

  const exactMatch = breakpoints.find((breakpoint) => breakpoint.width === width);
  if (exactMatch) {
    return { viewport: { width, height: exactMatch.height }, notes };
  }

  for (const factor of [2, 3]) {
    const scaled = breakpoints.find((breakpoint) => breakpoint.width * factor === width);
    if (scaled) {
      notes.push(
        `baseline is ${width}px wide — looks like a ${factor}x export of the ${scaled.name} frame; export at 1x or pass "viewport"`
      );
      break;
    }
  }

  return { viewport: { width, height: 900 }, notes };
}

export async function compareScreenshots(input: CompareScreenshotsInput): Promise<CompareScreenshotsResult> {
  const baselinePath = resolveProjectPath(input.baselinePath, { toolName: TOOL, label: 'baselinePath', extension: '.png' });
  const actualPath = resolveProjectPath(input.actualPath, { toolName: TOOL, label: 'actualPath', extension: '.png' });
  const diffOutputPath = input.diffOutputPath
    ? resolveProjectPath(input.diffOutputPath, { toolName: TOOL, label: 'diffOutputPath', extension: '.png' })
    : null;

  // Minor #6: a diff written over the baseline or actual PNG would silently
  // corrupt the next comparison's input.
  if (diffOutputPath && (diffOutputPath === baselinePath || diffOutputPath === actualPath)) {
    throw new Error(`${TOOL}: diffOutputPath must differ from baselinePath and actualPath`);
  }

  const elements = input.elements ?? [];
  if (elements.length > 0 && !input.url) {
    throw new Error(`${TOOL}: "elements" requires "url" (the page to measure).`);
  }

  // R1: an element with no measurable property is invalid input; reject
  // before any I/O (defence in depth alongside the Zod `.refine`).
  for (const element of elements) {
    if (!hasMeasurableProperty(element)) {
      throw new Error(`${TOOL}: element "${element.selector}" has no expected properties`);
    }
  }

  const config = loadProjectConfig();

  // Minor #7: check the url against the allowlist up front, before
  // diffPngFiles writes anything.
  if (input.url && !isHostAllowed(input.url, config.allowedHosts)) {
    throw new Error(
      `${TOOL}: host not allowed for "${input.url}". Allowed by default: localhost, 127.0.0.1, [::1]. Add other hosts under "allowedHosts:" in .frontend-agent/config.yml.`
    );
  }

  const pixel = diffPngFiles(baselinePath, actualPath, diffOutputPath, TOOL);
  const viewportNotes: string[] = [];

  let geometry: GeometryCheck = { checked: false, deviations: [], missingSelectors: [] };
  if (input.url && elements.length > 0) {
    let viewport: Viewport;
    if (input.viewport) {
      viewport = input.viewport;
    } else {
      const defaulted = resolveDefaultViewport(pixel.baselineSize, config.breakpoints);
      viewport = defaulted.viewport;
      viewportNotes.push(...defaulted.notes);
    }
    const measurements = await withAllowedPages(TOOL, input.url, async (open) => {
      const page = await open(viewport);
      return measureElements(page, elements.map((element) => element.selector));
    });
    geometry = evaluateExpectations(elements, measurements, config.profile);
  }

  const decision = decideVerdict(pixel, geometry, config.profile);
  decision.notes.push(...viewportNotes);
  return {
    validationProfile: config.validationProfile,
    profile: config.profile,
    pixel,
    geometry,
    ...decision
  };
}

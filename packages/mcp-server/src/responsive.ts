import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { resolveProjectPath } from './paths.js';
import { withAllowedPages } from './browser.js';
import { loadProjectConfig, type Breakpoint, type ValidationProfileName, BREAKPOINT_NAME_PATTERN } from './config.js';

const TOOL = 'run_responsive_suite';
const MAX_OVERFLOWING_ELEMENTS = 10;

export interface BreakpointResult {
  name: string;
  width: number;
  height: number;
  hasHorizontalOverflow: boolean;
  scrollWidth: number;
  clientWidth: number;
  overflowingElements: string[];
  screenshotPath: string | null;
}

export interface ResponsiveSuiteResult {
  url: string;
  validationProfile: ValidationProfileName;
  required: boolean;
  passed: boolean;
  breakpoints: BreakpointResult[];
}

export async function runResponsiveSuite(input: {
  url: string;
  outputDir?: string;
  breakpoints?: Breakpoint[];
}): Promise<ResponsiveSuiteResult> {
  const outputDir = input.outputDir
    ? resolveProjectPath(input.outputDir, { toolName: TOOL, label: 'outputDir' })
    : null;
  const config = loadProjectConfig();
  const breakpoints = input.breakpoints ?? config.breakpoints;

  if (breakpoints.length === 0) {
    throw new Error(`${TOOL}: breakpoints array cannot be empty`);
  }

  for (const breakpoint of breakpoints) {
    if (!BREAKPOINT_NAME_PATTERN.test(breakpoint.name)) {
      throw new Error(
        `${TOOL}: invalid breakpoint name "${breakpoint.name}" (allowed: letters, digits, _ and -).`
      );
    }
    if (!Number.isInteger(breakpoint.width) || breakpoint.width <= 0) {
      throw new Error(`${TOOL}: breakpoint width must be a positive integer, got ${breakpoint.width}`);
    }
    if (!Number.isInteger(breakpoint.height) || breakpoint.height <= 0) {
      throw new Error(`${TOOL}: breakpoint height must be a positive integer, got ${breakpoint.height}`);
    }
  }

  const results = await withAllowedPages(TOOL, input.url, async (open) => {
    const collected: BreakpointResult[] = [];
    for (const breakpoint of breakpoints) {
      const page = await open({ width: breakpoint.width, height: breakpoint.height });
      const measured = await page.evaluate((limit) => {
        const doc = document.documentElement;
        const clientWidth = doc.clientWidth;
        const scrollWidth = doc.scrollWidth;
        const offenders: string[] = [];
        if (scrollWidth > clientWidth) {
          for (const el of Array.from(document.body.querySelectorAll('*'))) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.right > clientWidth + 1) {
              const id = el.id ? `#${el.id}` : '';
              const classes = Array.from(el.classList).slice(0, 2).map((c) => `.${c}`).join('');
              offenders.push(`${el.tagName.toLowerCase()}${id}${classes} (right edge ${Math.round(rect.right)}px)`);
              if (offenders.length >= limit) break;
            }
          }
        }
        return { clientWidth, scrollWidth, offenders };
      }, MAX_OVERFLOWING_ELEMENTS);

      let screenshotPath: string | null = null;
      if (outputDir) {
        mkdirSync(outputDir, { recursive: true });
        screenshotPath = path.join(outputDir, `${breakpoint.name}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
      }
      await page.close();

      collected.push({
        name: breakpoint.name,
        width: breakpoint.width,
        height: breakpoint.height,
        hasHorizontalOverflow: measured.scrollWidth > measured.clientWidth,
        scrollWidth: measured.scrollWidth,
        clientWidth: measured.clientWidth,
        overflowingElements: measured.offenders,
        screenshotPath
      });
    }
    return collected;
  });

  return {
    url: input.url,
    validationProfile: config.validationProfile,
    required: config.profile.requireResponsivePass,
    passed: results.every((result) => !result.hasHorizontalOverflow),
    breakpoints: results
  };
}

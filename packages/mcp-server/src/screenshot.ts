import { resolveProjectPath } from './paths.js';
import { withAllowedPages } from './browser.js';

export interface CaptureScreenshotInput {
  url: string;
  width: number;
  height: number;
  outputPath: string;
  /** R3a: capture the full scrollable page (default, keeps v0.2 behaviour) vs just the viewport. */
  fullPage?: boolean;
}

export interface CaptureScreenshotResult {
  outputPath: string;
  width: number;
  height: number;
}

export async function captureScreenshot(input: CaptureScreenshotInput): Promise<CaptureScreenshotResult> {
  const { url, width, height, outputPath, fullPage = true } = input;
  const resolvedOutputPath = resolveProjectPath(outputPath, {
    toolName: 'capture_screenshot',
    label: 'outputPath',
    extension: '.png'
  });

  return withAllowedPages('capture_screenshot', url, async (open) => {
    const page = await open({ width, height });
    await page.screenshot({ path: resolvedOutputPath, fullPage });
    return { outputPath: resolvedOutputPath, width, height };
  });
}

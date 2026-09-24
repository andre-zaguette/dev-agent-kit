import { chromium, type BrowserContext, type Page } from 'playwright';
import { assertNavigationAllowed, isHostAllowed, loadAllowedHosts } from './security.js';

export interface Viewport {
  width: number;
  height: number;
}

export type OpenAllowedPage = (viewport?: Viewport) => Promise<Page>;

/**
 * Check the URL against the allowlist before any browser starts, then launch
 * one headless Chromium and hand `fn` an `open` function. Each `open` call
 * creates a page, navigates to `url`, and re-checks the final URL and redirect
 * chain before returning the page. The browser is always closed.
 */
export async function withAllowedPages<T>(
  toolName: string,
  url: string,
  fn: (open: OpenAllowedPage) => Promise<T>
): Promise<T> {
  const allowedHosts = loadAllowedHosts();
  if (!isHostAllowed(url, allowedHosts)) {
    throw new Error(
      `${toolName}: host not allowed for "${url}". Allowed by default: localhost, 127.0.0.1, [::1]. Add other hosts under "allowedHosts:" in .frontend-agent/config.yml.`
    );
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const contexts: BrowserContext[] = [];
    const open: OpenAllowedPage = async (viewport) => {
      const contextOptions = viewport ? { viewport } : {};
      const context = await browser.newContext(contextOptions);
      contexts.push(context);
      const page = await context.newPage();
      const response = await page.goto(url, { waitUntil: 'networkidle' });
      assertNavigationAllowed(page, response, allowedHosts, toolName);
      return page;
    };
    try {
      return await fn(open);
    } finally {
      await Promise.allSettled(contexts.map((context) => context.close()));
    }
  } finally {
    await browser.close();
  }
}

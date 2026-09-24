// One-off: renders evals/figma/src/*.html into the reference PNGs the Figma mock serves.
// Run: npm run render-figma-assets --workspace=packages/evals
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { findKitRoot } from '../../cli/src/util.ts';

const figmaDir = path.join(findKitRoot(), 'evals', 'figma');
const assets = path.join(figmaDir, 'assets');
mkdirSync(assets, { recursive: true });

// hero.png: a deterministic 1200×800 gradient standing in for a photo asset.
const hero = new PNG({ width: 1200, height: 800 });
for (let y = 0; y < hero.height; y++) {
  for (let x = 0; x < hero.width; x++) {
    const i = (y * hero.width + x) * 4;
    hero.data[i] = 79 + Math.round((x / hero.width) * 100);
    hero.data[i + 1] = 70 + Math.round((y / hero.height) * 120);
    hero.data[i + 2] = 229;
    hero.data[i + 3] = 255;
  }
}
writeFileSync(path.join(assets, 'hero.png'), PNG.sync.write(hero));

const jobs = [
  { html: 'pricing.html', out: 'pricing-desktop.png', width: 1440, height: 900 },
  { html: 'pricing.html', out: 'pricing-mobile.png', width: 390, height: 844, fullPage: true },
  { html: 'pricing.html', out: 'pricing-card.png', width: 1440, height: 900, selector: '.card:nth-of-type(2)' },
  { html: 'hero-motion.html', out: 'hero-motion.png', width: 1440, height: 900 },
  { html: 'checkout.html', out: 'checkout.png', width: 1440, height: 900 },
  { html: 'landing.html', out: 'landing.png', width: 1440, height: 900 }
];

const browser = await chromium.launch();
try {
  for (const job of jobs) {
    const page = await browser.newPage({ viewport: { width: job.width, height: job.height } });
    await page.goto(pathToFileURL(path.join(figmaDir, 'src', job.html)).href);
    const file = path.join(assets, job.out);
    if (job.selector) await page.locator(job.selector).screenshot({ path: file });
    else await page.screenshot({ path: file, fullPage: job.fullPage ?? false });
    await page.close();
    console.log(`rendered ${job.out}`);
  }
} finally {
  await browser.close();
}

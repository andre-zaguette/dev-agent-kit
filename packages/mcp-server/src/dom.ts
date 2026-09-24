import { withAllowedPages } from './browser.js';

export interface InspectDomInput {
  url: string;
  selector: string;
}

export interface InspectDomResult {
  selector: string;
  rect: { x: number; y: number; width: number; height: number };
  styles: { fontSize: string; color: string };
}

export async function inspectDom(input: InspectDomInput): Promise<InspectDomResult> {
  const { url, selector } = input;

  return withAllowedPages('inspect_dom', url, async (open) => {
    const page = await open();
    const element = page.locator(selector).first();

    if ((await element.count()) === 0) {
      throw new Error(`inspect_dom: no element matched selector "${selector}"`);
    }

    const box = await element.boundingBox();
    if (!box) {
      throw new Error(`inspect_dom: element matched selector "${selector}" but is not rendered (no bounding box)`);
    }
    const styles = await element.evaluate((el) => {
      const computed = getComputedStyle(el);
      return { fontSize: computed.fontSize, color: computed.color };
    });
    return {
      selector,
      rect: { x: box.x, y: box.y, width: box.width, height: box.height },
      styles
    };
  });
}

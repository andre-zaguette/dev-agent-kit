import type { Page } from 'playwright';
import type { ValidationProfile } from './config.js';

export interface ElementExpectation {
  selector: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  gap?: number;
  rowGap?: number;
  columnGap?: number;
  fontSize?: number;
  color?: string;
}

/** Expectation keys that are actual measurable properties (everything but `selector`). */
export const MEASURABLE_PROPERTIES = [
  'x', 'y', 'width', 'height',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'gap', 'rowGap', 'columnGap',
  'fontSize', 'color'
] as const satisfies readonly (keyof Omit<ElementExpectation, 'selector'>)[];

/** R1: an element expectation with no measurable property is invalid input. */
export function hasMeasurableProperty(expectation: ElementExpectation): boolean {
  return MEASURABLE_PROPERTIES.some((property) => expectation[property] !== undefined);
}

export interface ElementMeasurement {
  selector: string;
  found: boolean;
  values: Record<string, number | string>;
}

export type DeviationKind = 'geometry' | 'spacing' | 'fontSize' | 'color';

export interface Deviation {
  selector: string;
  property: string;
  kind: DeviationKind;
  expected: number | string;
  actual: number | string;
  delta: number | null;
  tolerance: number | null;
  withinTolerance: boolean;
}

export interface GeometryCheck {
  checked: boolean;
  deviations: Deviation[];
  missingSelectors: string[];
}

const PROPERTY_KINDS: Record<string, DeviationKind> = {
  x: 'geometry',
  y: 'geometry',
  width: 'geometry',
  height: 'geometry',
  paddingTop: 'spacing',
  paddingRight: 'spacing',
  paddingBottom: 'spacing',
  paddingLeft: 'spacing',
  gap: 'spacing',
  rowGap: 'spacing',
  columnGap: 'spacing',
  fontSize: 'fontSize',
  color: 'color'
};

export function normalizeColor(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const hex = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].split('').map((d) => d + d).join('') : hex[1];
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16));
    return `rgb(${r}, ${g}, ${b})`;
  }
  const fn = trimmed.match(/^rgba?\(([^)]*)\)$/);
  if (fn) {
    const parts = fn[1].split(',').map((part) => part.trim());
    if (parts.length === 4 && Number(parts[3]) === 1) parts.pop();
    return parts.length === 4 ? `rgba(${parts.join(', ')})` : `rgb(${parts.join(', ')})`;
  }
  return trimmed;
}

function toleranceFor(kind: DeviationKind, profile: ValidationProfile): number | null {
  if (kind === 'geometry') return profile.geometryTolerancePx;
  if (kind === 'spacing') return profile.spacingTolerancePx;
  if (kind === 'fontSize') return profile.fontSizeTolerancePx;
  return null;
}

export function evaluateExpectations(
  expectations: ElementExpectation[],
  measurements: ElementMeasurement[],
  profile: ValidationProfile
): GeometryCheck {
  const deviations: Deviation[] = [];
  const missingSelectors: string[] = [];

  expectations.forEach((expectation, index) => {
    const measurement = measurements[index];
    if (!measurement?.found) {
      missingSelectors.push(expectation.selector);
      return;
    }
    for (const [property, kind] of Object.entries(PROPERTY_KINDS)) {
      const expected = expectation[property as keyof ElementExpectation];
      if (expected === undefined) continue;
      const actual = measurement.values[property];
      const tolerance = toleranceFor(kind, profile);
      if (kind === 'color') {
        const withinTolerance = normalizeColor(String(expected)) === normalizeColor(String(actual));
        deviations.push({ selector: expectation.selector, property, kind, expected, actual, delta: null, tolerance, withinTolerance });
      } else {
        const delta = Math.abs(Number(actual) - Number(expected));
        deviations.push({
          selector: expectation.selector,
          property,
          kind,
          expected,
          actual,
          delta,
          tolerance,
          withinTolerance: delta <= (tolerance ?? 0)
        });
      }
    }
  });

  return { checked: deviations.length > 0 || missingSelectors.length > 0, deviations, missingSelectors };
}

export async function measureElements(page: Page, selectors: string[]): Promise<ElementMeasurement[]> {
  const measurements: ElementMeasurement[] = [];
  for (const selector of selectors) {
    const element = page.locator(selector).first();
    if ((await element.count()) === 0) {
      measurements.push({ selector, found: false, values: {} });
      continue;
    }
    const box = await element.boundingBox();
    if (!box) {
      measurements.push({ selector, found: false, values: {} });
      continue;
    }
    // NOTE: no named inner functions in this callback (it serializes to the
    // browser; tsx's injected `__name(...)` helper is undefined there).
    const styles = await element.evaluate((el) => {
      const computed = getComputedStyle(el);
      const rowGapValue = computed.rowGap === 'normal' ? 0 : parseFloat(computed.rowGap) || 0;
      const columnGapValue = computed.columnGap === 'normal' ? 0 : parseFloat(computed.columnGap) || 0;
      const isRowFlex =
        (computed.display === 'flex' || computed.display === 'inline-flex') &&
        (computed.flexDirection === 'row' || computed.flexDirection === 'row-reverse');
      const gapValue = isRowFlex ? columnGapValue : rowGapValue;

      // R4: round-trip the computed color through a 1x1 canvas so wide-gamut
      // values (oklch, lab, color(display-p3 ...)) come back as the sRGB
      // triple Chrome actually paints, instead of the raw CSS function text.
      // Follow-up #1: the canvas stores colors premultiplied, so a semi-
      // transparent rgba()/rgb() value can come back off by ±1 per channel
      // after the round-trip. getComputedStyle already normalizes rgba()/rgb()
      // syntax, so skip the round-trip for those and let normalizeColor
      // (Node side) handle the comparison directly.
      let color = computed.color;
      if (!/^rgba?\(/i.test(computed.color)) {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = computed.color;
          ctx.fillRect(0, 0, 1, 1);
          const data = ctx.getImageData(0, 0, 1, 1).data;
          const r = data[0];
          const g = data[1];
          const b = data[2];
          const a = data[3];
          color = a < 255 ? `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 100) / 100})` : `rgb(${r}, ${g}, ${b})`;
        }
      }

      return {
        paddingTop: computed.paddingTop === 'normal' ? 0 : parseFloat(computed.paddingTop) || 0,
        paddingRight: computed.paddingRight === 'normal' ? 0 : parseFloat(computed.paddingRight) || 0,
        paddingBottom: computed.paddingBottom === 'normal' ? 0 : parseFloat(computed.paddingBottom) || 0,
        paddingLeft: computed.paddingLeft === 'normal' ? 0 : parseFloat(computed.paddingLeft) || 0,
        gap: gapValue,
        rowGap: rowGapValue,
        columnGap: columnGapValue,
        fontSize: computed.fontSize === 'normal' ? 0 : parseFloat(computed.fontSize) || 0,
        color
      };
    });
    measurements.push({
      selector,
      found: true,
      values: { x: box.x, y: box.y, width: box.width, height: box.height, ...styles }
    });
  }
  return measurements;
}

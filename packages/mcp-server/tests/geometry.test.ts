import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExpectations, hasMeasurableProperty, normalizeColor } from '../src/geometry.ts';
import { DEFAULT_PROFILES } from '../src/config.ts';

test('normalizeColor maps hex, rgba with full alpha and spacing variants to one rgb() form', () => {
  assert.equal(normalizeColor('#111827'), 'rgb(17, 24, 39)');
  assert.equal(normalizeColor('#fff'), 'rgb(255, 255, 255)');
  assert.equal(normalizeColor('rgba(17,24,39,1)'), 'rgb(17, 24, 39)');
  assert.equal(normalizeColor(' RGB(17 , 24 , 39) '), 'rgb(17, 24, 39)');
  assert.equal(normalizeColor('rgba(0, 0, 0, 0.5)'), 'rgba(0, 0, 0, 0.5)');
});

test('deviations use the tolerance for their kind from the profile', () => {
  const check = evaluateExpectations(
    [{ selector: 'h1', width: 100, paddingTop: 10, fontSize: 32, color: '#111827' }],
    [{ selector: 'h1', found: true, values: { width: 103, paddingTop: 13, fontSize: 33, color: 'rgb(17, 24, 39)' } }],
    DEFAULT_PROFILES.standard
  );
  assert.equal(check.checked, true);
  assert.deepEqual(check.missingSelectors, []);
  const byProperty = Object.fromEntries(check.deviations.map((d) => [d.property, d]));
  assert.deepEqual(
    { kind: byProperty.width.kind, delta: byProperty.width.delta, tolerance: byProperty.width.tolerance, ok: byProperty.width.withinTolerance },
    { kind: 'geometry', delta: 3, tolerance: 3, ok: true }
  );
  assert.deepEqual(
    { kind: byProperty.paddingTop.kind, delta: byProperty.paddingTop.delta, tolerance: byProperty.paddingTop.tolerance, ok: byProperty.paddingTop.withinTolerance },
    { kind: 'spacing', delta: 3, tolerance: 2, ok: false }
  );
  assert.equal(byProperty.fontSize.withinTolerance, true);
  assert.deepEqual(
    { kind: byProperty.color.kind, tolerance: byProperty.color.tolerance, ok: byProperty.color.withinTolerance },
    { kind: 'color', tolerance: null, ok: true }
  );
});

test('pixel-perfect has zero tolerance', () => {
  const check = evaluateExpectations(
    [{ selector: 'h1', x: 10 }],
    [{ selector: 'h1', found: true, values: { x: 10.5 } }],
    DEFAULT_PROFILES['pixel-perfect']
  );
  assert.equal(check.deviations[0].withinTolerance, false);
});

test('a selector that matched nothing goes to missingSelectors instead of deviations', () => {
  const check = evaluateExpectations(
    [{ selector: '.nope', width: 10 }],
    [{ selector: '.nope', found: false, values: {} }],
    DEFAULT_PROFILES.standard
  );
  assert.deepEqual(check.missingSelectors, ['.nope']);
  assert.deepEqual(check.deviations, []);
});

test('R1: hasMeasurableProperty rejects a selector-only expectation and accepts any single measurable field', () => {
  assert.equal(hasMeasurableProperty({ selector: 'h1' }), false);
  assert.equal(hasMeasurableProperty({ selector: 'h1', width: 10 }), true);
  assert.equal(hasMeasurableProperty({ selector: 'h1', color: '#000' }), true);
  assert.equal(hasMeasurableProperty({ selector: 'h1', rowGap: 0 }), true);
});

test('R1 (defence in depth): evaluateExpectations reports checked=false when neither a deviation nor a missing selector was produced', () => {
  const check = evaluateExpectations([], [], DEFAULT_PROFILES.standard);
  assert.equal(check.checked, false);
});

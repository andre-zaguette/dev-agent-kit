import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseProjectConfig,
  loadProjectConfig,
  DEFAULT_PROFILES,
  DEFAULT_BREAKPOINTS
} from '../src/config.ts';

test('an empty config yields the standard profile, spec default breakpoints and no extra hosts', () => {
  const config = parseProjectConfig('');
  assert.equal(config.validationProfile, 'standard');
  assert.deepEqual(config.profile, DEFAULT_PROFILES.standard);
  assert.deepEqual(config.breakpoints, DEFAULT_BREAKPOINTS);
  assert.deepEqual(config.allowedHosts, []);
});

test('spec §7 profile defaults are exact', () => {
  assert.deepEqual(DEFAULT_PROFILES['pixel-perfect'], {
    geometryTolerancePx: 0, spacingTolerancePx: 0, fontSizeTolerancePx: 0,
    maxCriticalA11yIssues: 0, requireResponsivePass: true, pixelSimilarityTarget: 'informational'
  });
  assert.deepEqual(DEFAULT_PROFILES.standard, {
    geometryTolerancePx: 3, spacingTolerancePx: 2, fontSizeTolerancePx: 1,
    maxCriticalA11yIssues: 0, requireResponsivePass: true, pixelSimilarityTarget: 0.95
  });
  assert.deepEqual(DEFAULT_PROFILES.relaxed, {
    geometryTolerancePx: 8, spacingTolerancePx: 6, fontSizeTolerancePx: 2,
    maxCriticalA11yIssues: 0, requireResponsivePass: true, pixelSimilarityTarget: 0.9
  });
  assert.deepEqual(DEFAULT_BREAKPOINTS, [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'laptop', width: 1280, height: 800 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 }
  ]);
});

test('validationProfile selects a profile and a partial override merges with its defaults', () => {
  const config = parseProjectConfig(
    'validationProfile: pixel-perfect\nprofiles:\n  pixel-perfect:\n    geometryTolerancePx: 1\n'
  );
  assert.equal(config.validationProfile, 'pixel-perfect');
  assert.deepEqual(config.profile, { ...DEFAULT_PROFILES['pixel-perfect'], geometryTolerancePx: 1 });
});

test('a breakpoints map replaces the default set, in file order', () => {
  const config = parseProjectConfig('breakpoints:\n  wide: 1920x1080\n  phone: 375x667\n');
  assert.deepEqual(config.breakpoints, [
    { name: 'wide', width: 1920, height: 1080 },
    { name: 'phone', width: 375, height: 667 }
  ]);
});

test('allowedHosts are trimmed and lowercased, and an empty allowedHosts key is treated as absent', () => {
  assert.deepEqual(parseProjectConfig('allowedHosts:\n  - " Staging.Example.com "\n').allowedHosts, ['staging.example.com']);
  assert.deepEqual(parseProjectConfig('allowedHosts:\n').allowedHosts, []);
});

test('invalid YAML, unknown profile names and malformed breakpoints throw an error naming the source', () => {
  assert.throws(() => parseProjectConfig('allowedHosts: [unclosed\n', 'cfg.yml'), /cfg\.yml/);
  assert.throws(() => parseProjectConfig('validationProfile: ultra\n', 'cfg.yml'), /cfg\.yml.*validationProfile/s);
  assert.throws(() => parseProjectConfig('breakpoints:\n  desktop: big\n', 'cfg.yml'), /cfg\.yml.*breakpoints/s);
  assert.throws(() => parseProjectConfig('breakpoints:\n  "../x": 10x10\n', 'cfg.yml'), /cfg\.yml.*breakpoints/s);
  assert.throws(() => parseProjectConfig('profiles:\n  standard:\n    pixelSimilarityTarget: 2\n', 'cfg.yml'), /cfg\.yml.*pixelSimilarityTarget/s);
});

test('an unknown top-level config key throws, naming the file (Minor #9: no other keys are used anywhere in the kit)', () => {
  assert.throws(() => parseProjectConfig('validation_profile: relaxed\n', 'cfg.yml'), /cfg\.yml/);
});

test('loadProjectConfig reads <projectRoot>/.frontend-agent/config.yml and falls back to defaults when absent', () => {
  const root = mkdtempSync(join(tmpdir(), 'frontend-agent-config-'));
  const previous = process.env.FRONTEND_AGENT_PROJECT_ROOT;
  process.env.FRONTEND_AGENT_PROJECT_ROOT = root;
  try {
    assert.equal(loadProjectConfig().validationProfile, 'standard');
    mkdirSync(join(root, '.frontend-agent'));
    writeFileSync(join(root, '.frontend-agent', 'config.yml'), 'validationProfile: relaxed\n');
    assert.equal(loadProjectConfig().validationProfile, 'relaxed');
  } finally {
    if (previous === undefined) delete process.env.FRONTEND_AGENT_PROJECT_ROOT;
    else process.env.FRONTEND_AGENT_PROJECT_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

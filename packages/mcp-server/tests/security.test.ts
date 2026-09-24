import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAllowedHosts, isHostAllowed, loadAllowedHosts } from '../src/security.ts';
import { getProjectRoot } from '../src/project.ts';

test('parseAllowedHosts extracts a flat YAML list under allowedHosts:', () => {
  const yaml = `validationProfile: standard\nallowedHosts:\n  - staging.example.com\n  - preview.example.com\nbreakpoints:\n  desktop: 1440x900\n`;
  assert.deepEqual(parseAllowedHosts(yaml), ['staging.example.com', 'preview.example.com']);
});

test('parseAllowedHosts returns an empty array when the key is absent', () => {
  assert.deepEqual(parseAllowedHosts('validationProfile: standard\n'), []);
});

test('parseAllowedHosts strips surrounding quotes from list items', () => {
  const yaml = `allowedHosts:\n  - "quoted.example.com"\n  - 'single-quoted.example.com'\n`;
  assert.deepEqual(parseAllowedHosts(yaml), ['quoted.example.com', 'single-quoted.example.com']);
});

test('parseAllowedHosts lowercases, trims and strips trailing comments from entries', () => {
  const yaml = `allowedHosts:\n  -   Staging.Example.COM   \n  - preview.example.com  # preview env\n`;
  assert.deepEqual(parseAllowedHosts(yaml), ['staging.example.com', 'preview.example.com']);
});

test('isHostAllowed allows localhost and 127.0.0.1 by default', () => {
  assert.equal(isHostAllowed('http://localhost:5173/'), true);
  assert.equal(isHostAllowed('http://127.0.0.1:3000/'), true);
});

test('isHostAllowed allows [::1] (IPv6 loopback) by default', () => {
  assert.equal(isHostAllowed('http://[::1]:3000/'), true);
});

test('isHostAllowed rejects an arbitrary external host by default', () => {
  assert.equal(isHostAllowed('http://example.com/'), false);
});

test('isHostAllowed allows a host from an explicit extra allowlist', () => {
  assert.equal(isHostAllowed('http://staging.example.com/', ['staging.example.com']), true);
});

test('isHostAllowed rejects a malformed URL', () => {
  assert.equal(isHostAllowed('not-a-url'), false);
});

test('getProjectRoot uses FRONTEND_AGENT_PROJECT_ROOT when set, resolved to an absolute path', () => {
  const previous = process.env.FRONTEND_AGENT_PROJECT_ROOT;
  try {
    process.env.FRONTEND_AGENT_PROJECT_ROOT = '.';
    assert.equal(getProjectRoot(), process.cwd());
  } finally {
    if (previous === undefined) {
      delete process.env.FRONTEND_AGENT_PROJECT_ROOT;
    } else {
      process.env.FRONTEND_AGENT_PROJECT_ROOT = previous;
    }
  }
});

test('loadAllowedHosts reads .frontend-agent/config.yml from FRONTEND_AGENT_PROJECT_ROOT', () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontend-agent-root-'));
  const previous = process.env.FRONTEND_AGENT_PROJECT_ROOT;
  try {
    mkdirSync(join(dir, '.frontend-agent'), { recursive: true });
    writeFileSync(join(dir, '.frontend-agent', 'config.yml'), 'allowedHosts:\n  - staging.example.com\n');
    process.env.FRONTEND_AGENT_PROJECT_ROOT = dir;
    assert.deepEqual(loadAllowedHosts(), ['staging.example.com']);
  } finally {
    if (previous === undefined) {
      delete process.env.FRONTEND_AGENT_PROJECT_ROOT;
    } else {
      process.env.FRONTEND_AGENT_PROJECT_ROOT = previous;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

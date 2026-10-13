import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSelection } from '../src/integrations/select.ts';
import { INTEGRATIONS } from '../src/integrations/index.ts';
import type { Integration } from '../src/integrations/types.ts';

// The registry only holds figma until later tasks add the others, so these tests inject extra entries.
const fake = (id: string, hosts: Integration['hosts'], defaultOn = false): Integration =>
  ({ id: id as never, hosts, defaultOn, detect: async () => ({ state: 'absent' }), plan: () => [], verify: () => [], notes: () => [] });
const registry: readonly Integration[] = [...INTEGRATIONS, fake('headroom', ['claude', 'codex']), fake('cartographer', ['claude'])];
const ids = (list: Integration[]) => list.map((i) => i.id);

test('defaults only: figma', () => {
  assert.deepEqual(ids(resolveSelection({ with: [], without: [] }, ['claude'], [], registry)), ['figma']);
});

test('--with adds, --no-figma removes a default', () => {
  assert.deepEqual(ids(resolveSelection({ with: ['headroom'], without: ['figma'] }, ['claude', 'codex'], [], registry)), ['headroom']);
});

test('duplicate --with ids and ids already recorded produce one entry (no duplicates)', () => {
  const list = resolveSelection({ with: ['headroom', 'headroom'], without: [] }, ['claude'], ['headroom'], registry);
  assert.deepEqual(ids(list), ['figma', 'headroom']);
});

test('selection is sticky: a plain run keeps previously recorded ids; --no-<id> drops one', () => {
  assert.deepEqual(ids(resolveSelection({ with: [], without: [] }, ['claude'], ['headroom'], registry)), ['figma', 'headroom']);
  assert.deepEqual(ids(resolveSelection({ with: [], without: ['headroom'] }, ['claude'], ['headroom'], registry)), ['figma']);
});

test('unknown id is a usage error listing the valid ids', () => {
  assert.throws(() => resolveSelection({ with: ['nope'], without: [] }, ['claude'], [], registry), /unknown integration "nope".*figma, headroom, cartographer/);
});

test('--with on a host the integration does not support names the supported hosts', () => {
  assert.throws(() => resolveSelection({ with: ['cartographer'], without: [] }, ['codex'], [], registry), /cartographer.*claude/);
});

test('--with x and --no-x together conflict', () => {
  assert.throws(() => resolveSelection({ with: ['headroom'], without: ['headroom'] }, ['claude'], [], registry), /conflict/);
});

test('a recorded id unsupported by the selected hosts is skipped silently', () => {
  assert.deepEqual(ids(resolveSelection({ with: [], without: [] }, ['codex'], ['cartographer'], registry)), ['figma']);
});

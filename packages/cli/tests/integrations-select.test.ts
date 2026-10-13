import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSelection, wantedIds } from '../src/integrations/select.ts';
import { INTEGRATIONS } from '../src/integrations/index.ts';
import type { Integration } from '../src/integrations/types.ts';

// Tests inject extra fake entries (e.g. cartographer) to cover host filtering and selection rules.
const fake = (id: string, hosts: Integration['hosts'], defaultOn = false): Integration =>
  ({ id: id as never, hosts, defaultOn, detect: async () => ({ state: 'absent' }), plan: () => [], verify: () => [], notes: () => [] });
const registry: readonly Integration[] = [...INTEGRATIONS, fake('cartographer', ['claude'])];
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
  assert.throws(() => resolveSelection({ with: ['nope'], without: [] }, ['claude'], [], registry), /unknown integration "nope".*figma, headroom, claude-mem, cartographer/);
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

test('wantedIds keeps recorded ids the host does not support; only without drops them; ordered, deduped', () => {
  assert.deepEqual(wantedIds({ with: [], without: [] }, ['cartographer'], registry), ['figma', 'cartographer']);
  assert.deepEqual(wantedIds({ with: [], without: ['cartographer'] }, ['cartographer'], registry), ['figma']);
  assert.deepEqual(wantedIds({ with: ['headroom', 'headroom'], without: [] }, ['cartographer', 'headroom', 'figma'], registry), ['figma', 'headroom', 'cartographer']);
});

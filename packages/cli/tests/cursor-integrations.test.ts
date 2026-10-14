import { test } from 'node:test';
import assert from 'node:assert/strict';
import { figma } from '../src/integrations/figma.ts';
import { headroom } from '../src/integrations/headroom.ts';
import { graphify } from '../src/integrations/graphify.ts';
import { INTEGRATIONS } from '../src/integrations/index.ts';
import { project } from './integration-helpers.ts';

test('hosts: figma, headroom and graphify list cursor; claude-mem and cartographer stay claude-only', () => {
  const hosts = Object.fromEntries(INTEGRATIONS.map((i) => [i.id, [...i.hosts]]));
  assert.deepEqual(hosts.figma, ['claude', 'codex', 'cursor']);
  assert.deepEqual(hosts.headroom, ['claude', 'codex', 'cursor']);
  assert.deepEqual(hosts.graphify, ['claude', 'codex', 'cursor']);
  assert.deepEqual(hosts['claude-mem'], ['claude']);
  assert.deepEqual(hosts.cartographer, ['claude']);
});

test('plans on cursor: figma is the remote url form, headroom is the typed stdio form', () => {
  assert.deepEqual(figma.plan('cursor', { state: 'present' }), [{ name: 'figma', entry: { url: 'https://mcp.figma.com/mcp' } }]);
  assert.deepEqual(headroom.plan('cursor', { state: 'present', binPath: '/abs/headroom' }), [
    { name: 'headroom', entry: { type: 'stdio', command: '/abs/headroom', args: ['mcp', 'serve'] } }
  ]);
  assert.deepEqual(headroom.plan('codex', { state: 'present', binPath: '/abs/headroom' }), [
    { name: 'headroom', entry: { command: '/abs/headroom', args: ['mcp', 'serve'] } }
  ]);
});

test('headroom hints name .cursor/mcp.json on cursor, .mcp.json on claude, and no file on codex', () => {
  const present = { state: 'present', binPath: '/abs/headroom' } as const;
  assert.match(headroom.notes('cursor', present).join(' '), /\.cursor\/mcp\.json/);
  assert.match(headroom.notes('claude', present).join(' '), /\.mcp\.json/);
  assert.doesNotMatch(headroom.notes('claude', present).join(' '), /\.cursor/);
  assert.doesNotMatch(headroom.notes('codex', present).join(' '), /mcp\.json/);
  const { ctx, cleanup } = project();
  try {
    const gone = headroom.verify('cursor', ctx, present, { headroom: { command: '/no/such/headroom', args: ['mcp', 'serve'] } });
    assert.equal(gone[0].warn, true);
    assert.match(gone[0].detail, /\.cursor\/mcp\.json/);
  } finally {
    cleanup();
  }
});

test('graphify verifies on cursor like on the other hosts', () => {
  const { ctx, cleanup } = project();
  try {
    assert.deepEqual(graphify.verify('cursor', ctx, { state: 'present', binPath: '/b/graphify' }, {}).map((c) => [c.ok, !!c.warn]), [[true, false]]);
    assert.equal(graphify.verify('cursor', ctx, { state: 'absent' }, {})[0].warn, true);
  } finally {
    cleanup();
  }
});

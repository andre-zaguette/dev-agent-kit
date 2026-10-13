import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { graphify } from '../src/integrations/graphify.ts';
import { project, fakeBin } from './integration-helpers.ts';

test('detect: graphify on PATH is present, otherwise absent', async () => {
  const { base, ctx, cleanup } = project();
  try {
    assert.deepEqual(await graphify.detect({ ...ctx, env: { PATH: '' } }), { state: 'absent' });
    const bin = fakeBin(join(base, 'bin'), 'graphify');
    assert.deepEqual(await graphify.detect({ ...ctx, env: { PATH: join(base, 'bin') } }), { state: 'present', binPath: bin, detail: bin });
  } finally {
    cleanup();
  }
});

test('verify: binary → ok; graphify-out/GRAPH_REPORT.md → extra ok; missing binary → warn with uv hint', () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    assert.deepEqual(graphify.verify('claude', ctx, { state: 'present', binPath: '/b/graphify' }, {}).map((c) => [c.ok, !!c.warn]), [[true, false]]);
    mkdirSync(join(projectRoot, 'graphify-out'));
    writeFileSync(join(projectRoot, 'graphify-out', 'GRAPH_REPORT.md'), '# report');
    assert.equal(graphify.verify('codex', ctx, { state: 'present', binPath: '/b/graphify' }, {}).length, 2);
    const missing = graphify.verify('claude', ctx, { state: 'absent' }, {});
    assert.equal(missing[0].warn, true);
    assert.match(missing[0].detail, /uv tool install graphifyy/);
  } finally {
    cleanup();
  }
});

test('plan is empty; notes (absent) say the kit never runs graphify install and what it changes', () => {
  assert.deepEqual(graphify.plan('claude', { state: 'present', binPath: '/b/graphify' }), []);
  const notes = graphify.notes('claude', { state: 'absent' }).join(' ');
  assert.match(notes, /uv tool install graphifyy/);
  assert.match(notes, /never runs .graphify install./);
  assert.match(notes, /hooks/);
  assert.deepEqual(graphify.notes('claude', { state: 'present', binPath: '/b/graphify' }), []);
});

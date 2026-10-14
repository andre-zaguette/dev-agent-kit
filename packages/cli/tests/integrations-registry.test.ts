import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTEGRATIONS, integrationById } from '../src/integrations/index.ts';
import { INTEGRATION_IDS } from '../src/integrations/types.ts';
import { project } from './integration-helpers.ts';

test('figma is the only default-on integration and plans the same entries as before', async () => {
  assert.deepEqual(INTEGRATIONS.filter((i) => i.defaultOn).map((i) => i.id), ['figma']);
  const figma = integrationById('figma')!;
  assert.deepEqual(figma.hosts, ['claude', 'codex', 'cursor']);
  assert.deepEqual(figma.plan('claude', { state: 'present' }), [{ name: 'figma', entry: { type: 'http', url: 'https://mcp.figma.com/mcp' } }]);
  assert.deepEqual(figma.plan('codex', { state: 'present' }), [
    { name: 'figma', entry: { url: 'https://mcp.figma.com/mcp' }, hint: 'authenticate with: codex mcp login figma' }
  ]);
  const { ctx, cleanup } = project();
  try {
    assert.deepEqual(await figma.detect(ctx), { state: 'present', detail: 'remote HTTP server' });
    assert.deepEqual(figma.verify('claude', ctx, { state: 'present' }, {}), []);
  } finally {
    cleanup();
  }
});

test('integrationById returns undefined for an unknown id', () => {
  assert.equal(integrationById('nope'), undefined);
});

test('every id in INTEGRATION_IDS has a registered integration, and nothing else is registered', () => {
  assert.deepEqual(INTEGRATIONS.map((i) => i.id).sort(), [...INTEGRATION_IDS].sort());
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { readIntegrationState, persistIntegrationState, assertStateWritable, STATE_FILE } from '../src/integrations/state.ts';
import { project } from './integration-helpers.ts';

test('no state file reads as an empty list without error', () => {
  const { projectRoot, cleanup } = project();
  try {
    assert.deepEqual(readIntegrationState(projectRoot), { ids: [] });
  } finally {
    cleanup();
  }
});

test('persist writes {"enabled": [...]} and read returns the ids', () => {
  const { projectRoot, cleanup } = project();
  try {
    persistIntegrationState(projectRoot, ['figma', 'headroom']);
    assert.deepEqual(JSON.parse(readFileSync(join(projectRoot, STATE_FILE), 'utf8')), { enabled: ['figma', 'headroom'] });
    assert.deepEqual(readIntegrationState(projectRoot), { ids: ['figma', 'headroom'] });
  } finally {
    cleanup();
  }
});

test('persist writes nothing when no file exists and the ids are exactly the defaults', () => {
  const { projectRoot, cleanup } = project();
  try {
    persistIntegrationState(projectRoot, ['figma']);
    assert.equal(existsSync(join(projectRoot, STATE_FILE)), false);
  } finally {
    cleanup();
  }
});

test('malformed JSON, a wrong shape and an unknown id each come back as an error, not a throw', () => {
  const { projectRoot, cleanup } = project();
  try {
    mkdirSync(join(projectRoot, '.dev-agent'));
    for (const bad of ['{not json', '[]', '{"enabled":"headroom"}', '{"enabled":["nope"]}']) {
      writeFileSync(join(projectRoot, STATE_FILE), bad);
      const state = readIntegrationState(projectRoot);
      assert.deepEqual(state.ids, []);
      assert.match(state.error ?? '', /integrations\.json/);
    }
  } finally {
    cleanup();
  }
});

test('a .dev-agent symlink that points outside the project is refused', () => {
  const { base, projectRoot, cleanup } = project();
  try {
    const outside = join(base, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(projectRoot, '.dev-agent'));
    assert.throws(() => assertStateWritable(projectRoot));
    assert.throws(() => persistIntegrationState(projectRoot, ['figma', 'headroom']));
    assert.equal(existsSync(join(outside, 'integrations.json')), false);
  } finally {
    cleanup();
  }
});

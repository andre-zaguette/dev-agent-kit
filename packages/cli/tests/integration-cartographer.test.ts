import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartographer } from '../src/integrations/cartographer.ts';
import { ClaudeCodeAdapter } from '../src/adapters/claude.ts';
import { BLOCK_START } from '../src/managed-block.ts';
import { project } from './integration-helpers.ts';

test('detect: skill directory in the project or in ~/.claude/skills is present; otherwise unknown', async () => {
  const { homeDir, ctx, cleanup } = project();
  try {
    assert.equal((await cartographer.detect(ctx)).state, 'unknown');
    mkdirSync(join(homeDir, '.claude', 'skills', 'cartographer'), { recursive: true });
    assert.equal((await cartographer.detect(ctx)).state, 'present');
  } finally {
    cleanup();
  }
  const second = project();
  try {
    mkdirSync(join(second.projectRoot, '.claude', 'skills', 'cartographer'), { recursive: true });
    assert.equal((await cartographer.detect(second.ctx)).state, 'present');
  } finally {
    second.cleanup();
  }
});

test('verify: skill found → ok; map present → extra ok; neither → warn with both marketplace commands', () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    const none = cartographer.verify('claude', ctx, { state: 'unknown', reason: 'x' }, {});
    assert.deepEqual(none.map((c) => [c.ok, !!c.warn]), [[true, true]]);
    assert.match(none[0].detail, /plugin marketplace add kingbootoshi\/cartographer/);
    assert.match(none[0].detail, /plugin install cartographer/);

    const skill = cartographer.verify('claude', ctx, { state: 'present', detail: '/p' }, {});
    assert.deepEqual(skill.map((c) => [c.ok, !!c.warn]), [[true, false]]);

    mkdirSync(join(projectRoot, 'docs'));
    writeFileSync(join(projectRoot, 'docs', 'CODEBASE_MAP.md'), '# map');
    const both = cartographer.verify('claude', ctx, { state: 'present', detail: '/p' }, {});
    assert.equal(both.length, 2);
    assert.ok(both.every((c) => c.ok && !c.warn));

    const mapOnly = cartographer.verify('claude', ctx, { state: 'unknown', reason: 'x' }, {});
    assert.deepEqual(mapOnly.map((c) => [c.ok, !!c.warn]), [[true, false]]);
    assert.match(mapOnly[0].detail, /map/i);
  } finally {
    cleanup();
  }
});

test('plan is empty: the kit writes nothing for Cartographer', () => {
  assert.deepEqual(cartographer.plan('claude', { state: 'absent' }), []);
});

test('CLAUDE.md coexistence: Cartographer-style text around the kit block survives install and a second install byte for byte', async () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    const before = '# My project\n\n<!-- cartographer:start -->\nSee docs/CODEBASE_MAP.md for the architecture map.\n<!-- cartographer:end -->\n';
    const after = '\n## Notes\nKeep CODEBASE_MAP.md up to date.\n';
    const adapter = new ClaudeCodeAdapter(ctx);
    writeFileSync(join(projectRoot, 'CLAUDE.md'), before);
    await adapter.installInstructions();
    const first = readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8');
    assert.ok(first.length > before.length, 'the kit block was not written');
    assert.ok(first.includes(BLOCK_START), 'kit block start marker missing');
    assert.ok(first.startsWith(before), 'text before the kit block changed');
    writeFileSync(join(projectRoot, 'CLAUDE.md'), `${first}${after}`);
    await adapter.installInstructions();
    const second = readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8');
    assert.ok(second.startsWith(before), 'text before the kit block changed on re-install');
    assert.ok(second.endsWith(after), 'text after the kit block changed on re-install');
    await adapter.installInstructions();
    assert.equal(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8'), second, 'a third install is not idempotent');
  } finally {
    cleanup();
  }
});

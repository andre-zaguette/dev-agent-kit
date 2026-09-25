import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkManifest, checkPackedFiles, REQUIRED_PACKED } from '../src/package-check.ts';
import { findKitRoot } from '../src/util.ts';

const root = findKitRoot();

test('the root package manifest is publishable and coherent with the workspaces', () => {
  assert.deepEqual(checkManifest(root), []);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'dev-agent-kit');
  assert.equal(pkg.version, '1.0.0');
});

test('a packed file list must hold the required files and none of the forbidden ones', () => {
  const good = [...REQUIRED_PACKED, 'skills/verification/SKILL.md', 'docs/cli.md', 'README.md'];
  assert.deepEqual(checkPackedFiles(good), []);
  const missing = checkPackedFiles(good.filter((f) => f !== 'integrations/claude/CLAUDE.md'));
  assert.equal(missing.length, 1);
  assert.match(missing[0], /missing.*integrations\/claude\/CLAUDE\.md/);
  for (const bad of [
    'packages/core/tests/x.test.ts',
    'evals/results/run.json',
    '.worktrees/v1/a.txt',
    'docs/superpowers/plans/p.md',
    '.env',
    'packages/core/.env.local',
    '.dev-agent/tasks/A-1.md',
    '.frontend-agent/config.yml',
    'fixtures/a.pyc',
    'node_modules/x/index.js'
  ]) {
    const problems = checkPackedFiles([...good, bad]);
    assert.equal(problems.length, 1, bad);
    assert.match(problems[0], /forbidden/);
  }
});

test('a manifest with a private flag, a stale version, a missing bin or a missing dependency is reported', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'dak-manifest-'));
  try {
    mkdirSync(join(dir, 'packages', 'core'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dev-agent-kit', version: '1.0.0', private: true, bin: { x: 'bin/x.mjs' }, files: ['bin'], dependencies: {} }));
    writeFileSync(join(dir, 'packages', 'core', 'package.json'), JSON.stringify({ name: 'c', version: '0.9.0', dependencies: { yaml: '^2.9.1' } }));
    const text = checkManifest(dir).join('\n');
    assert.match(text, /private/);
    assert.match(text, /version 0\.9\.0/);
    assert.match(text, /bin\/x\.mjs/);
    assert.match(text, /yaml/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

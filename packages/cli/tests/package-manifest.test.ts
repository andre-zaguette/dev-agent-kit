import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkImports, checkManifest, checkPackedFiles, checkSkillsPacked, REQUIRED_PACKED } from '../src/package-check.ts';
import { findKitRoot } from '../src/util.ts';

import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const root = findKitRoot();

test('the root package manifest is publishable and coherent with the workspaces', () => {
  assert.deepEqual(checkManifest(root), []);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'dev-agent-kit');
  assert.equal(pkg.version, '1.0.0');
  assert.equal(pkg.license, 'MIT');
  assert.match(readFileSync(join(root, 'LICENSE'), 'utf8'), /^MIT License/);
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

test('runtime imports must be packed files or root dependencies', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'dak-imports-'));
  try {
    mkdirSync(join(dir, 'packages', 'core', 'src'), { recursive: true });
    mkdirSync(join(dir, 'bin'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dev-agent-kit', dependencies: { yaml: '^2' } }));
    writeFileSync(join(dir, 'packages/core/src/a.ts'), "import { x } from './b.js';\nimport YAML from 'yaml';\nimport fs from 'node:fs';\nimport { z } from 'zod';\nimport('../../missing/src/y.js');\nimport type { T } from './types.js';\n");
    writeFileSync(join(dir, 'packages/core/src/b.ts'), 'export const x = 1;\n');
    writeFileSync(join(dir, 'packages/core/src/types.ts'), 'export type T = 1;\n');
    writeFileSync(join(dir, 'bin/run.mjs'), "await import(new URL('../packages/core/src/a.ts', import.meta.url).href);\nimport { register } from 'tsx/esm/api';\n");
    const problems = checkImports(dir, ['package.json', 'bin/run.mjs', 'packages/core/src/a.ts', 'packages/core/src/b.ts']).join('\n');
    assert.match(problems, /zod/);
    assert.match(problems, /tsx/);
    assert.match(problems, /types\.js/);
    assert.match(problems, /missing\/src\/y\.js/);
    assert.doesNotMatch(problems, /yaml|node:fs|b\.js/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the real package has no unresolved runtime import and ships every skill', () => {
  const { execFileSync } = require_('node:child_process');
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const files: string[] = JSON.parse(raw)[0].files.map((f: { path: string }) => f.path);
  assert.deepEqual(checkImports(root, files), []);
  assert.deepEqual(checkSkillsPacked(root, files), []);
});

test('no component announces a stale hard-coded version', () => {
  for (const file of ['packages/mcp-server/src/index.ts', 'packages/cli/src/checks.ts']) {
    assert.doesNotMatch(readFileSync(join(root, file), 'utf8'), /version: '\d+\.\d+\.\d+'/, file);
  }
});

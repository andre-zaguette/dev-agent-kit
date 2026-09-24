import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScenarioSchema, AssertionSchema } from '../src/schema.ts';
import { evalsLayout, loadScenarios } from '../src/load.ts';

const base = {
  id: 'demo', category: 'base', title: 'Demo', fixture: 'app', figma: 'design', prompt: 'do it',
  expected: [{ type: 'file_exists', path: 'index.html' }]
};

test('a minimal scenario parses with defaults', () => {
  const s = ScenarioSchema.parse(base);
  assert.equal(s.timeoutSec, 900);
  assert.deepEqual(s.forbidden, []);
});

test('assertions reject path traversal, absolute paths, bad regex, g flag and malformed tool names', () => {
  const bad = [
    { type: 'file_exists', path: '../etc/passwd' },
    { type: 'file_exists', path: '/etc/passwd' },
    { type: 'file_matches', glob: 'a//b', pattern: 'x' },
    { type: 'file_matches', glob: '**/*.html', pattern: '(' },
    { type: 'output_matches', pattern: 'x', flags: 'g' },
    { type: 'output_matches', pattern: 'x'.repeat(301) },
    { type: 'tool_called', tool: 'no-slash' },
    { type: 'tool_called', tool: 'a/b', extra: 1 }
  ];
  for (const a of bad) assert.equal(AssertionSchema.safeParse(a).success, false, JSON.stringify(a));
  assert.equal(AssertionSchema.safeParse({ type: 'tool_called', tool: 'figma/get_design_context', args: { nodeId: '^1[:-]2$' } }).success, true);
});

test('loadScenarios reports every problem at once: id/file mismatch, missing fixture, missing figma, duplicate id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fak-evals-schema-'));
  try {
    const layout = evalsLayout(dir);
    mkdirSync(layout.scenariosDir, { recursive: true });
    mkdirSync(join(layout.fixturesDir, 'app'), { recursive: true });
    mkdirSync(layout.figmaDir, { recursive: true });
    writeFileSync(join(layout.figmaDir, 'design.json'), JSON.stringify({ fileKey: 'K', metadata: '<page/>', variables: {}, nodes: { '1:2': { name: 'Frame', designContext: 'x', screenshot: 'assets/missing.png' } } }));
    writeFileSync(join(layout.scenariosDir, 'demo.json'), JSON.stringify(base));
    writeFileSync(join(layout.scenariosDir, 'other.json'), JSON.stringify({ ...base, fixture: 'nope', figma: 'nope' }));
    assert.throws(() => loadScenarios(layout), (error: Error) => {
      assert.match(error.message, /design\.json: .*assets\/missing\.png does not exist/);
      assert.match(error.message, /other\.json: id "demo" must match the file name/);
      assert.match(error.message, /other\.json: fixture "nope" not found/);
      assert.match(error.message, /other\.json: figma "nope" not found/);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a scenario may omit the Figma fixture, and the backend category is valid', () => {
  const noFigma = { id: 'backend-x', category: 'backend', title: 'Backend scenario', fixture: 'django-app', prompt: 'Do the thing.', expected: [{ type: 'file_exists', path: 'a.py' }] };
  assert.equal(ScenarioSchema.safeParse(noFigma).success, true);
  assert.equal(ScenarioSchema.safeParse({ ...noFigma, figma: 'pricing' }).success, true);
  assert.equal(ScenarioSchema.safeParse({ ...noFigma, figma: 'Not A Name' }).success, false);
  assert.equal(ScenarioSchema.safeParse({ ...noFigma, category: 'nope' }).success, false);
});

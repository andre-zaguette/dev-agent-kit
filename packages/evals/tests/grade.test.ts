import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { grade, globToRegExp, listWorkspaceFiles } from '../src/grade.ts';
import { ScenarioSchema } from '../src/schema.ts';
import type { RunRecord } from '../src/types.ts';

function record(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    host: 'claude', durationMs: 1, exitCode: 0, timedOut: false, stderrTail: '',
    toolCalls: [{ tool: 'figma/get_design_context', args: { nodeId: '1:2' }, ok: true }],
    finalText: 'All good. VEREDITO: PASS',
    ...overrides
  };
}

function scenario(expected: unknown[], forbidden: unknown[] = []) {
  return ScenarioSchema.parse({ id: 's', category: 'base', title: 'S', fixture: 'f', figma: 'g', prompt: 'p', expected, forbidden });
}

function withWs(fn: (ws: string) => void) {
  const ws = mkdtempSync(join(tmpdir(), 'fak-grade-'));
  try {
    fn(ws);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
}

test('globToRegExp supports **, *, ? and {a,b}', () => {
  assert.ok(globToRegExp('src/**/PricingCard.{tsx,jsx}').test('src/components/PricingCard.tsx'));
  assert.ok(globToRegExp('src/**/PricingCard.{tsx,jsx}').test('src/PricingCard.jsx'));
  assert.ok(!globToRegExp('src/*.ts').test('src/a/b.ts'));
  assert.ok(globToRegExp('**/*pricing*').test('pages/pricing.html'));
  assert.ok(globToRegExp('a?.css').test('ab.css'));
});

test('pass when all expected hold and no forbidden does; fail otherwise, with details', () => {
  withWs((ws) => {
    mkdirSync(join(ws, 'pages'));
    writeFileSync(join(ws, 'pages', 'pricing.html'), '<link href="../styles/tokens.css">');
    const s = scenario(
      [
        { type: 'tool_called', tool: 'figma/get_design_context', args: { nodeId: '^1[:-]2$' } },
        { type: 'output_matches', pattern: 'veredito:\\s*pass', flags: 'i' },
        { type: 'file_matches', glob: 'pages/*.html', pattern: 'tokens\\.css' },
        { type: 'file_exists', path: 'pages/pricing.html' }
      ],
      [{ type: 'file_matches', glob: 'pages/*.html', pattern: '#4F46E5' }]
    );
    assert.equal(grade(s, record(), ws).verdict, 'pass');

    writeFileSync(join(ws, 'pages', 'pricing.html'), '<style>a{color:#4F46E5}</style>');
    const failed = grade(s, record({ toolCalls: [] }), ws);
    assert.equal(failed.verdict, 'fail');
    assert.equal(failed.expected[0].satisfied, false);
    assert.equal(failed.expected[2].satisfied, false);
    assert.match(failed.expected[2].detail, /1 file\(s\) matched the glob, none matched the pattern/);
    assert.equal(failed.forbidden[0].satisfied, true);
    assert.match(failed.forbidden[0].detail, /pages\/pricing\.html/);
  });
});

test('timeout, non-zero exit and a transcript error are "error" even when every assertion holds', () => {
  withWs((ws) => {
    const s = scenario([{ type: 'output_matches', pattern: 'PASS' }]);
    assert.equal(grade(s, record({ timedOut: true, error: 'no result event' }), ws).verdict, 'error');
    assert.match(grade(s, record({ timedOut: true }), ws).error ?? '', /timed out after 900s/);
    assert.match(grade(s, record({ exitCode: 3 }), ws).error ?? '', /exited with code 3/);
    assert.match(grade(s, record({ error: 'claude transcript has no result event' }), ws).error ?? '', /no result event/);
  });
});

test('symlinks in the workspace are never followed and kit/host dirs are ignored', () => {
  withWs((ws) => {
    const outside = mkdtempSync(join(tmpdir(), 'fak-grade-outside-'));
    try {
      writeFileSync(join(outside, 'secret.html'), 'SECRET');
      symlinkSync(join(outside, 'secret.html'), join(ws, 'leak.html'));
      symlinkSync(outside, join(ws, 'linked-dir'));
      mkdirSync(join(ws, '.claude', 'skills'), { recursive: true });
      writeFileSync(join(ws, '.claude', 'skills', 'x.html'), 'SECRET');
      assert.deepEqual(listWorkspaceFiles(ws), []);
      const s = scenario([
        { type: 'file_matches', glob: '**/*.html', pattern: 'SECRET' },
        { type: 'file_exists', path: 'leak.html' }
      ]);
      const result = grade(s, record(), ws);
      assert.equal(result.expected[0].satisfied, false);
      assert.equal(result.expected[1].satisfied, false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

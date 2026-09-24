import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { evalsLayout, loadScenarios } from '../src/load.ts';
import { createWorkspace, removeWorkspace } from '../src/workspace.ts';
import { findKitRoot } from '../../cli/src/util.ts';
import { grade } from '../src/grade.ts';
import type { RunRecord } from '../src/types.ts';

const kitRoot = findKitRoot();
const layout = evalsLayout(join(kitRoot, 'evals'));

test('the catalog loads: 7 base, 8 stack, 3 profile', () => {
  const scenarios = loadScenarios(layout);
  const count = (c: string) => scenarios.filter((s) => s.category === c).length;
  assert.deepEqual([count('base'), count('stack'), count('profile')], [7, 8, 3]);
});

test('every stack scenario maps to a figma-to-code reference and asserts it was read', () => {
  const refs = readdirSync(join(kitRoot, 'skills', 'figma-to-code', 'references')).map((f) => f.replace(/\.md$/, ''));
  const stacks = loadScenarios(layout).filter((s) => s.category === 'stack');
  assert.deepEqual(stacks.map((s) => s.id.replace(/^stack-/, '')).sort(), refs.sort());
  for (const s of stacks) {
    const stack = s.id.replace(/^stack-/, '');
    assert.ok(s.expected.some((a) => a.type === 'tool_called' && a.tool === `reference/${stack}`), s.id);
  }
});

test('the three profile scenarios cover each validationProfile and demand an explicit verdict line', () => {
  const profiles = loadScenarios(layout).filter((s) => s.category === 'profile');
  assert.deepEqual(profiles.map((s) => s.profile).sort(), ['pixel-perfect', 'relaxed', 'standard']);
  for (const s of profiles) assert.match(s.prompt, /VEREDITO: PASS/);
});

test('every fixture copies cleanly (no symlinks) and every prompt that needs the app uses {{baseUrl}}', () => {
  const scenarios = loadScenarios(layout);
  for (const fixture of new Set(scenarios.map((s) => s.fixture))) {
    const ws = createWorkspace(join(layout.fixturesDir, fixture));
    removeWorkspace(ws);
  }
  for (const s of scenarios.filter((s) => s.category !== 'stack')) assert.match(s.prompt, /\{\{baseUrl\}\}/, s.id);
});

test('every "do not change files" scenario also forbids a shell edit, not just Edit/Write/file_change', () => {
  const validationScenarios = loadScenarios(layout).filter((s) => s.forbidden.some((a) => a.type === 'tool_called' && a.tool === 'builtin/Edit'));
  assert.ok(validationScenarios.length >= 4, 'expected the 4 base-visual-divergence/profile-* scenarios');
  for (const s of validationScenarios) {
    assert.ok(
      s.forbidden.some((a) => a.type === 'tool_called' && a.tool === 'builtin/shell' && a.args?.command),
      `${s.id}: missing a forbidden builtin/shell write check (a Codex "sed -i" edit would slip past Edit/Write/file_change)`
    );
  }
});

test('the shell-write forbidden check actually catches a Codex sed -i edit (final-review finding: file_change alone misses it)', () => {
  const s = loadScenarios(layout).find((sc) => sc.id === 'base-visual-divergence')!;
  const ws = createWorkspace(join(layout.fixturesDir, s.fixture));
  try {
    const record: RunRecord = {
      host: 'codex',
      durationMs: 1,
      exitCode: 0,
      timedOut: false,
      stderrTail: '',
      toolCalls: [
        { tool: 'frontend-agent/compare_screenshots', args: {}, ok: true },
        { tool: 'frontend-agent/inspect_dom', args: {}, ok: true },
        { tool: 'builtin/shell', args: { command: `sed -i 's/28px/24px/' pages/pricing.html` }, ok: true }
      ],
      finalText: 'padding divergente, 28px. VEREDITO: FAIL'
    };
    const result = grade(s, record, ws);
    assert.equal(result.verdict, 'fail');
    assert.ok(result.forbidden.some((r) => r.assertion.type === 'tool_called' && r.assertion.tool === 'builtin/shell' && r.satisfied));
  } finally {
    removeWorkspace(ws);
  }
});

test('reference screenshots were rendered', () => {
  for (const png of ['pricing-desktop.png', 'pricing-mobile.png', 'pricing-card.png', 'hero-motion.png', 'checkout.png', 'landing.png', 'hero.png']) {
    assert.ok(existsSync(join(layout.figmaDir, 'assets', png)), png);
  }
});

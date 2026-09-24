import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBench, selectScenarios } from '../src/bench.ts';
import { writeReport } from '../src/report.ts';
import { findKitRoot } from '../../cli/src/util.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const evalsDir = join(here, 'data', 'bench-evals');
const fakeClaude = { command: process.execPath, prefixArgs: [join(here, 'data', 'fake-claude.mjs')] };

function withOut(fn: (out: string) => Promise<void>) {
  const out = mkdtempSync(join(tmpdir(), 'fak-bench-out-'));
  return fn(out).finally(() => rmSync(out, { recursive: true, force: true }));
}

const benchWorkspaces = () => readdirSync(tmpdir()).filter((n) => n.startsWith('fak-bench-') && !n.startsWith('fak-bench-out-'));

test('end to end with a fake Claude: install, serve, run, grade pass, clean up, report', async () => {
  await withOut(async (out) => {
    const before = new Set(benchWorkspaces());
    const results = await runBench({ kitRoot: findKitRoot(), evalsDir, hosts: ['claude'], outDir: out, binaries: { claude: fakeClaude } });
    assert.equal(results.length, 1);
    const [r] = results;
    assert.equal(r.verdict, 'pass', JSON.stringify(r.grade, null, 2));
    assert.equal(r.model, 'fake-model');
    assert.deepEqual(r.usage, { inputTokens: 10, outputTokens: 5, costUsd: 0.01 });
    assert.ok(existsSync(r.transcriptPath));
    assert.deepEqual(benchWorkspaces().filter((n) => !before.has(n)), [], 'workspace removed');

    const { summaryPath, reportPath } = writeReport(out, results, {
      startedAt: 'a', finishedAt: 'b', kitVersion: '0.5.0', hosts: ['claude'], models: {}
    });
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    assert.deepEqual(summary.byHost.claude, { total: 1, pass: 1, fail: 0, error: 0, passRate: 1 });
    assert.match(readFileSync(reportPath, 'utf8'), /\| fake-simple \| base \| pass \|/);
  });
});

test('a missing host binary is an error per case; the other host still runs; --keep keeps the workspace', async () => {
  await withOut(async (out) => {
    const results = await runBench({
      kitRoot: findKitRoot(),
      evalsDir,
      hosts: ['claude', 'codex'],
      outDir: out,
      keep: true,
      binaries: { claude: fakeClaude, codex: { command: join(out, 'no-codex'), prefixArgs: [] } }
    });
    const byHost = Object.fromEntries(results.map((r) => [r.host, r]));
    assert.equal(byHost.claude.verdict, 'pass');
    assert.equal(byHost.codex.verdict, 'error');
    assert.match(byHost.codex.grade.error ?? '', /host command not found/);
    for (const r of results) {
      assert.ok(r.workspace && existsSync(r.workspace));
      rmSync(r.workspace!, { recursive: true, force: true });
    }
  });
});

test('timeout override makes a hanging host an error', async () => {
  await withOut(async (out) => {
    process.env.FAKE_PID_FILE = join(out, 'pid');
    try {
      const results = await runBench({
        kitRoot: findKitRoot(),
        evalsDir,
        hosts: ['claude'],
        outDir: out,
        timeoutMsOverride: 1500,
        binaries: { claude: { command: process.execPath, prefixArgs: [join(here, 'data', 'fake-hang.mjs')] } }
      });
      assert.equal(results[0].verdict, 'error');
      assert.match(results[0].grade.error ?? '', /timed out/);
    } finally {
      delete process.env.FAKE_PID_FILE;
    }
  });
});

test('selectScenarios filters by id and category and rejects unknown ids', () => {
  const all = [
    { id: 'a', category: 'base' },
    { id: 'b', category: 'stack' }
  ] as any;
  assert.deepEqual(selectScenarios(all, undefined, ['stack']).map((s: any) => s.id), ['b']);
  assert.deepEqual(selectScenarios(all, ['a']).map((s: any) => s.id), ['a']);
  assert.throws(() => selectScenarios(all, ['zzz']), /unknown scenario "zzz"/);
});

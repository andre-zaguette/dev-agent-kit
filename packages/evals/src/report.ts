import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CaseResult } from './bench.js';
import type { HostId } from './schema.js';

export interface BenchMeta {
  startedAt: string;
  finishedAt: string;
  kitVersion: string;
  hosts: HostId[];
  models: Partial<Record<HostId, string>>;
}

export interface HostSummary {
  total: number;
  pass: number;
  fail: number;
  error: number;
  passRate: number;
}

export interface Summary {
  meta: BenchMeta;
  byHost: Record<string, HostSummary>;
  byHostCategory: Record<string, Record<string, HostSummary>>;
  cases: CaseResult[];
}

function tally(cases: CaseResult[]): HostSummary {
  const count = (v: string) => cases.filter((c) => c.verdict === v).length;
  const total = cases.length;
  const pass = count('pass');
  return { total, pass, fail: count('fail'), error: count('error'), passRate: total ? Math.round((pass / total) * 1000) / 1000 : 0 };
}

export function summarize(results: CaseResult[], meta: BenchMeta): Summary {
  const byHost: Record<string, HostSummary> = {};
  const byHostCategory: Record<string, Record<string, HostSummary>> = {};
  for (const host of meta.hosts) {
    const mine = results.filter((r) => r.host === host);
    byHost[host] = tally(mine);
    byHostCategory[host] = {};
    for (const category of [...new Set(mine.map((r) => r.category))]) {
      byHostCategory[host][category] = tally(mine.filter((r) => r.category === category));
    }
  }
  return { meta, byHost, byHostCategory, cases: results };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function renderMarkdown(summary: Summary): string {
  const { meta } = summary;
  const lines = [
    `# Frontend Agent Kit — benchmark`,
    '',
    `Kit ${meta.kitVersion} · ${meta.startedAt} → ${meta.finishedAt}`,
    '',
    '## Pass rate por host',
    '',
    '| Host | Modelo | Pass | Fail | Error | Pass rate |',
    '|------|--------|------|------|-------|-----------|'
  ];
  for (const host of meta.hosts) {
    const s = summary.byHost[host];
    const model = meta.models[host] ?? summary.cases.find((c) => c.host === host && c.model)?.model ?? '—';
    lines.push(`| ${host} | ${model} | ${s.pass} | ${s.fail} | ${s.error} | ${pct(s.passRate)} |`);
  }
  lines.push('', '## Por categoria', '', '| Host | Categoria | Pass | Total | Pass rate |', '|------|-----------|------|-------|-----------|');
  for (const host of meta.hosts) {
    for (const [category, s] of Object.entries(summary.byHostCategory[host])) {
      lines.push(`| ${host} | ${category} | ${s.pass} | ${s.total} | ${pct(s.passRate)} |`);
    }
  }
  lines.push('', '## Cenários', '', '| Cenário | Categoria | ' + meta.hosts.join(' | ') + ' |', '|---|---|' + meta.hosts.map(() => '---').join('|') + '|');
  for (const id of [...new Set(summary.cases.map((c) => c.scenarioId))]) {
    const cases = summary.cases.filter((c) => c.scenarioId === id);
    lines.push(`| ${id} | ${cases[0].category} | ${meta.hosts.map((h) => cases.find((c) => c.host === h)?.verdict ?? '—').join(' | ')} |`);
  }
  lines.push('', '## Falhas e erros', '');
  for (const c of summary.cases.filter((c) => c.verdict !== 'pass')) {
    lines.push(`### ${c.scenarioId} — ${c.host}: ${c.verdict}`, '');
    if (c.grade.error) lines.push(`- erro: ${c.grade.error}`);
    for (const r of c.grade.expected.filter((r) => !r.satisfied)) lines.push(`- expected não satisfeito: \`${JSON.stringify(r.assertion)}\` — ${r.detail}`);
    for (const r of c.grade.forbidden.filter((r) => r.satisfied)) lines.push(`- forbidden satisfeito: \`${JSON.stringify(r.assertion)}\` — ${r.detail}`);
    lines.push(`- duração: ${Math.round(c.durationMs / 1000)}s${c.usage?.costUsd !== undefined ? ` · custo: $${c.usage.costUsd.toFixed(3)}` : ''}${c.usage?.inputTokens !== undefined ? ` · tokens in/out: ${c.usage.inputTokens}/${c.usage.outputTokens ?? '?'}` : ''}`, '');
  }
  return `${lines.join('\n')}\n`;
}

export function writeReport(outDir: string, results: CaseResult[], meta: BenchMeta): { summaryPath: string; reportPath: string } {
  mkdirSync(outDir, { recursive: true });
  const summary = summarize(results, meta);
  const summaryPath = path.join(outDir, 'summary.json');
  const reportPath = path.join(outDir, 'report.md');
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(reportPath, renderMarkdown(summary));
  return { summaryPath, reportPath };
}

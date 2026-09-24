import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { auditContext, estimateTokens, formatAuditReport, MAX_INSTRUCTION_TOKENS } from '../src/context.ts';
import { headSha } from '../src/git.ts';
import { writeKnowledge } from '../src/repo-memory.ts';
import { commitFile, makeRepo } from './helpers.ts';

function project(files: Record<string, string>): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'dak-ctx-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const PARAGRAPH = 'Always run the full test suite before reporting a task as finished, and record the exact command and its result in the task notes.';
const skill = (body: string) => `---\nname: s\ndescription: d\n---\n\n${body}\n`;

test('estimateTokens is ceil(chars / 4)', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2);
});

test('a small clean project has no findings', () => {
  const p = project({ 'CLAUDE.md': '# Rules\n\nInspect before editing.\n' });
  try {
    const report = auditContext(p.dir);
    assert.deepEqual(report.findings, []);
    assert.ok(report.alwaysOnTokens > 0);
    assert.equal(report.removableTokens, 0);
    assert.match(formatAuditReport(report), /no findings/i);
  } finally {
    p.cleanup();
  }
});

test('an instruction file over the limit is flagged with the excess as removable', () => {
  const p = project({ 'CLAUDE.md': 'x'.repeat(4 * (MAX_INSTRUCTION_TOKENS + 100)) });
  try {
    const finding = auditContext(p.dir).findings.find((f) => f.kind === 'large-instruction-file');
    assert.equal(finding?.path, 'CLAUDE.md');
    assert.equal(finding?.removableTokens, 100);
  } finally {
    p.cleanup();
  }
});

test('the same paragraph in an instruction file and a skill is a duplicate; short repeats are not', () => {
  const p = project({
    'CLAUDE.md': `${PARAGRAPH}\n\nShort line.\n`,
    '.claude/skills/verify/SKILL.md': skill(`${PARAGRAPH}\n\nShort line.`)
  });
  try {
    const duplicates = auditContext(p.dir).findings.filter((f) => f.kind === 'duplicate-content');
    assert.equal(duplicates.length, 1);
    assert.equal(duplicates[0].path, '.claude/skills/verify/SKILL.md');
    assert.match(duplicates[0].detail, /CLAUDE\.md/);
    assert.equal(duplicates[0].removableTokens, estimateTokens(PARAGRAPH));
  } finally {
    p.cleanup();
  }
});

test('CLAUDE.md and AGENTS.md symlinked to one file are counted once, not as duplicates', () => {
  const p = project({ 'CLAUDE.md': `${PARAGRAPH}\n` });
  try {
    symlinkSync(join(p.dir, 'CLAUDE.md'), join(p.dir, 'AGENTS.md'));
    const report = auditContext(p.dir);
    assert.deepEqual(report.findings, []);
    assert.equal(report.alwaysOnTokens, estimateTokens(`${PARAGRAPH}\n`));
  } finally {
    p.cleanup();
  }
});

test('a skill installed for both hosts is read once', () => {
  const body = skill(PARAGRAPH);
  const p = project({ '.claude/skills/verify/SKILL.md': body, '.agents/skills/verify/SKILL.md': body });
  try {
    assert.deepEqual(auditContext(p.dir).findings, []);
  } finally {
    p.cleanup();
  }
});

test('an instruction file naming three or more frameworks is flagged as lazy-loadable knowledge', () => {
  const p = project({
    'CLAUDE.md': '# Stack\n\nUse React hooks for state.\nUse Django views for the API.\nStyle with Tailwind utilities.\nAlways write tests.\n'
  });
  try {
    const finding = auditContext(p.dir).findings.find((f) => f.kind === 'framework-knowledge');
    assert.ok(finding);
    assert.match(finding!.detail, /react/i);
    assert.ok(finding!.removableTokens > 0);
  } finally {
    p.cleanup();
  }
});

test('an oversized skill is flagged', () => {
  const p = project({ '.claude/skills/big/SKILL.md': skill('y'.repeat(4 * 2600)) });
  try {
    assert.equal(auditContext(p.dir).findings.find((f) => f.kind === 'oversized-skill')?.path, '.claude/skills/big/SKILL.md');
  } finally {
    p.cleanup();
  }
});

test('stale repo knowledge is reported; fresh knowledge is not', () => {
  const repo = makeRepo();
  try {
    commitFile(repo, 'a.txt');
    const dir = join(repo, '.dev-agent', 'knowledge');
    writeKnowledge(dir, 'repository', 'Fresh facts about the repository layout.', { sourceSha: headSha(repo)! });
    assert.deepEqual(auditContext(repo).findings.filter((f) => f.kind === 'stale-knowledge'), []);
    commitFile(repo, 'b.txt');
    const stale = auditContext(repo).findings.filter((f) => f.kind === 'stale-knowledge');
    assert.equal(stale.length, 1);
    assert.equal(stale[0].path, '.dev-agent/knowledge/repository.md');
    assert.match(stale[0].detail, /file\(s\) changed since/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('formatAuditReport lists each finding and the totals', () => {
  const p = project({ 'CLAUDE.md': `${PARAGRAPH}\n\n${PARAGRAPH}\n` });
  try {
    const text = formatAuditReport(auditContext(p.dir));
    assert.match(text, /always-on: ~\d+ tokens/);
    assert.match(text, /\[duplicate-content\] CLAUDE\.md/);
    assert.match(text, /removable: ~\d+ tokens/);
  } finally {
    p.cleanup();
  }
});

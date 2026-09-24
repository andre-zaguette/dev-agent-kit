import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkResume } from '../src/resume.ts';
import { ingestWorkItem, recordCheckpoint } from '../src/ledger.ts';
import { writeKnowledge } from '../src/repo-memory.ts';
import { headSha } from '../src/git.ts';
import { commitFile, makeRepo, sh } from './helpers.ts';
import type { TaskSourceConfig, WorkItem } from '../src/task-sources/types.ts';

const cfg = { taskDocsDir: '.dev-agent/tasks', stateDir: '.dev-agent/state', knowledgeDir: '.dev-agent/knowledge', taskSources: [{ id: 'company' } as TaskSourceConfig] };
const item: WorkItem = { source: 'company', id: '1', key: 'HEF-1', title: 'T', description: 'd', acceptanceCriteria: [], comments: [], attachments: [], links: [] };

function prepared(): { dir: string; base: string } {
  const dir = makeRepo();
  commitFile(dir, 'a.txt');
  const base = headSha(dir)!;
  ingestWorkItem(dir, cfg, item, { now: '2026-09-24T14:00:00Z' });
  sh(dir, 'switch', '-c', 'feat/hef-1-t');
  recordCheckpoint(dir, cfg, 'HEF-1', { phase: 'implementation', state: { baseBranch: 'main', baseSha: base, workingBranch: 'feat/hef-1-t' } }, '2026-09-24T15:00:00Z');
  return { dir, base };
}

test('a consistent task resumes at its recorded phase', () => {
  const { dir } = prepared();
  commitFile(dir, 'work.txt');
  const r = checkResume(dir, cfg, 'HEF-1');
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.phase, 'implementation');
  assert.equal(r.sourceConfigured, true);
  assert.deepEqual(r.staleKnowledge, []);
});

test('unsaved work in the tree does not block resuming', () => {
  const { dir } = prepared();
  writeFileSync(join(dir, 'wip.txt'), 'unsaved');
  assert.equal(checkResume(dir, cfg, 'HEF-1').ok, true);
});

test('a different branch, or a history that no longer contains the base, needs reconciling', () => {
  const { dir } = prepared();
  sh(dir, 'switch', '-q', 'main');
  let r = checkResume(dir, cfg, 'HEF-1');
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.reasons.some((x) => /on branch "main".*"feat\/hef-1-t"/.test(x)));
  sh(dir, 'switch', '-q', 'feat/hef-1-t');
  sh(dir, 'checkout', '-q', '--orphan', 'rewritten');
  sh(dir, 'commit', '-q', '--allow-empty', '-m', 'new root');
  sh(dir, 'branch', '-q', '-D', 'feat/hef-1-t');
  sh(dir, 'branch', '-q', '-m', 'feat/hef-1-t');
  r = checkResume(dir, cfg, 'HEF-1');
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.reasons.some((x) => /base commit/.test(x)));
});

test('missing state or ledger is reported, not thrown', () => {
  const dir = makeRepo();
  commitFile(dir, 'a.txt');
  const r = checkResume(dir, cfg, 'NOPE-1');
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reasons[0], /no saved state for NOPE-1/);
  assert.equal(checkResume(dir, cfg, '../x').ok, false);
});

test('a removed source keeps the ledger usable and is flagged', () => {
  const { dir } = prepared();
  const r = checkResume(dir, { ...cfg, taskSources: [] }, 'HEF-1');
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.sourceConfigured, false);
});

test('stale repository knowledge is listed for revalidation', () => {
  const { dir } = prepared();
  writeKnowledge(dir, 'commands', 'test: npm test', { sourceSha: headSha(dir)! });
  commitFile(dir, 'later.txt');
  const r = checkResume(dir, cfg, 'HEF-1');
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.staleKnowledge, ['commands']);
});

test('a deleted ledger file is reported', () => {
  const { dir } = prepared();
  rmSync(`${dir}/.dev-agent/tasks/HEF-1.md`);
  const r = checkResume(dir, cfg, 'HEF-1');
  assert.equal(r.ok, false);
});

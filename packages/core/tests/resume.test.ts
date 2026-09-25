import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

test('a symlinked knowledge directory is reported instead of being read', () => {
  const { dir } = prepared();
  const other = mkdtempSync(join(tmpdir(), 'dak-resume-other-'));
  try {
    mkdirSync(join(dir, '.dev-agent'), { recursive: true });
    rmSync(join(dir, '.dev-agent', 'knowledge'), { recursive: true, force: true });
    writeFileSync(join(other, 'commands.md'), '---\nsourceSha: abcdef1\nupdatedAt: x\n---\n\nbody\n');
    symlinkSync(other, join(dir, '.dev-agent', 'knowledge'), 'dir');
    const r = checkResume(dir, cfg, 'HEF-1');
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.reasons.some((x) => /symbolic link/.test(x)), JSON.stringify(r.reasons));
  } finally {
    rmSync(other, { recursive: true, force: true });
  }
});

// ---- multi-workspace (Pumpkin-shaped: a plain root holding one repository per folder) ----

const wsCfg = (names: string[]) => ({ ...cfg, workspaces: names.map((n) => ({ name: n, path: n, dependsOn: [] as string[] })) });

function pumpkin(): { root: string; bases: Record<string, string> } {
  const root = mkdtempSync(join(tmpdir(), 'dak-pumpkin-'));
  const bases: Record<string, string> = {};
  for (const name of ['models', 'backend', 'client']) {
    const dir = join(root, name);
    mkdirSync(dir);
    sh(dir, 'init', '-q', '-b', 'main');
    sh(dir, 'config', 'user.email', 't@example.com');
    sh(dir, 'config', 'user.name', 'Test');
    sh(dir, 'config', 'commit.gpgsign', 'false');
    commitFile(dir, 'a.txt');
    bases[name] = sh(dir, 'rev-parse', 'HEAD');
    sh(dir, 'switch', '-q', '-c', 'feat/hef-1-t');
  }
  ingestWorkItem(root, cfg, item, { now: '2026-09-24T14:00:00Z' });
  const workspaces = Object.fromEntries(Object.entries(bases).map(([n, sha]) => [n, { status: 'in-progress' as const, baseBranch: 'main', baseSha: sha, workingBranch: 'feat/hef-1-t' }]));
  recordCheckpoint(root, cfg, 'HEF-1', { phase: 'implementation', state: { workspaces } }, '2026-09-24T15:00:00Z');
  return { root, bases };
}

test('every recorded workspace on its branch resumes, and the plain root is fine', () => {
  const { root } = pumpkin();
  const r = checkResume(root, wsCfg(['models', 'backend', 'client']), 'HEF-1');
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.workspaceReports.map((w) => [w.workspace, w.ok]).sort(), [['backend', true], ['client', true], ['models', true]]);
});

test('uncommitted work in a workspace is a note, not a blocker', () => {
  const { root } = pumpkin();
  writeFileSync(join(root, 'backend', 'wip.txt'), 'x');
  const r = checkResume(root, wsCfg(['models', 'backend', 'client']), 'HEF-1');
  assert.equal(r.ok, true);
  if (r.ok) assert.match(r.workspaceReports.find((w) => w.workspace === 'backend')!.notes.join(' '), /uncommitted/);
});

test('a workspace on the wrong branch is named in the reason', () => {
  const { root } = pumpkin();
  sh(join(root, 'client'), 'switch', '-q', 'main');
  const r = checkResume(root, wsCfg(['models', 'backend', 'client']), 'HEF-1');
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.reasons.includes('client: on branch "main" but the task recorded "feat/hef-1-t"'));
    assert.equal(r.reasons.filter((x) => !x.startsWith('client: ')).length, 0);
  }
});

test('a rewritten base, a non-repository and a workspace missing from the config are reasons', () => {
  const { root } = pumpkin();
  const models = join(root, 'models');
  sh(models, 'checkout', '-q', '--orphan', 'rewritten');
  commitFile(models, 'b.txt');
  const r1 = checkResume(root, wsCfg(['models', 'backend', 'client']), 'HEF-1');
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.ok(r1.reasons.some((x) => /^models: .*not in the current history|^models: on branch/.test(x)));
  rmSync(join(root, 'backend', '.git'), { recursive: true });
  const r2 = checkResume(root, wsCfg(['backend', 'client']), 'HEF-1');
  assert.equal(r2.ok, false);
  if (!r2.ok) {
    assert.ok(r2.reasons.some((x) => /^backend: not a Git repository/.test(x)));
    assert.ok(r2.reasons.some((x) => /^models: .*workspaces configuration/.test(x)));
  }
});

test('a workspace that is a plain folder inside a repository is not its own repository', () => {
  const { root } = pumpkin();
  rmSync(join(root, 'backend', '.git'), { recursive: true });
  sh(root, 'init', '-q', '-b', 'main');
  const r = checkResume(root, wsCfg(['models', 'backend', 'client']), 'HEF-1');
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.reasons.some((x) => /^backend: not a Git repository/.test(x)));
});

test('without workspaces in the state, resume is the v1.0 check', () => {
  const { dir } = prepared();
  const r = checkResume(dir, { ...cfg, workspaces: [{ name: 'x', path: 'x', dependsOn: [] }] }, 'HEF-1');
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.workspaceReports, []);
});

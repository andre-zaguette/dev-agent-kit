import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runDev } from '../src/dev-cli.ts';
import { ingestWorkItem, recordCheckpoint } from '../../core/src/index.ts';
import { setup } from './dev-helpers.ts';

const CONFIG = String.raw`
taskSources:
  company:
    adapter: generic-mcp
    server: company-tasks
    default: true
    identifiers:
      - '^HEF-\d+$'
    tools:
      get: { name: get_issue }
      comments: { name: get_comments }
    mapping: { key: key, title: summary }
  personal:
    adapter: generic-mcp
    server: my-notes
    identifiers:
      - '^ME-\d+$'
    tools:
      get: { name: read_ticket }
    mapping: { key: reference, title: subject }
`;
const cfg = (yaml: string) => ({ '.dev-agent/config.yml': yaml });

test('sources lists each configured source, and says so when there are none', async () => {
  const t = setup(cfg(CONFIG));
  const none = setup();
  try {
    assert.equal(await runDev(['sources', '--project', t.projectRoot], t.io), 0);
    assert.match(t.text(), /company\s+generic-mcp\s+default\s+company-tasks\s+\^HEF-\\d\+\$/);
    assert.match(t.text(), /personal\s+generic-mcp\s+-\s+my-notes/);
    t.out.length = 0;
    assert.equal(await runDev(['sources', '--project', t.projectRoot, '--json'], t.io), 0);
    assert.deepEqual(JSON.parse(t.text()).map((s: { id: string }) => s.id), ['company', 'personal']);
    assert.equal(await runDev(['sources', '--project', none.projectRoot], none.io), 0);
    assert.match(none.text(), /no task sources configured/);
  } finally {
    t.cleanup();
    none.cleanup();
  }
});

test('sources exits 1 on a config that does not parse', async () => {
  const t = setup(cfg('taskSources: {A: {adapter: generic-mcp}}'));
  try {
    assert.equal(await runDev(['sources', '--project', t.projectRoot], t.io), 1);
    assert.match(t.err.join('\n'), /taskSources\.A/);
  } finally {
    t.cleanup();
  }
});

test('sources verify passes a good config and lists capabilities', async () => {
  const t = setup(cfg(CONFIG));
  try {
    assert.equal(await runDev(['sources', 'verify', '--project', t.projectRoot], t.io), 0);
    assert.match(t.text(), /✔ config parses/);
    assert.match(t.text(), /✔ company: generic-mcp adapter builds \(comments\)/);
    assert.match(t.text(), /✔ personal: generic-mcp adapter builds/);
  } finally {
    t.cleanup();
  }
});

test('sources verify reports a broken config as a finding, and warns about ambiguity risks and unsupported adapters', async () => {
  const broken = setup(cfg('git:\n  requireCleanTree: false'));
  const risky = setup(
    cfg(String.raw`
taskSources:
  a:
    adapter: generic-mcp
    server: s1
    identifiers: ['^X-\d+$']
    tools: { get: { name: g } }
    mapping: { key: k, title: t }
  b:
    adapter: generic-mcp
    server: s2
    identifiers: ['^X-\d+$']
    tools: { get: { name: g } }
    mapping: { key: k, title: t }
  c:
    adapter: custom-thing
`)
  );
  try {
    assert.equal(await runDev(['sources', 'verify', '--project', broken.projectRoot], broken.io), 2);
    assert.match(broken.text(), /✘ config: .*requireCleanTree/);
    assert.equal(await runDev(['sources', 'verify', '--project', risky.projectRoot], risky.io), 0);
    assert.match(risky.text(), /! a and b share the identifier pattern \^X-\\d\+\$/);
    assert.match(risky.text(), /! c: adapter "custom-thing" cannot be loaded in this version/);
    assert.match(risky.text(), /! no default source/);
  } finally {
    broken.cleanup();
    risky.cleanup();
  }
});

test('task resolve reports each resolution outcome with the right exit code', async () => {
  const t = setup(cfg(CONFIG));
  const two = setup(
    cfg(String.raw`
taskSources:
  a: { adapter: generic-mcp, server: s1, identifiers: ['^X-\d+$'], tools: { get: { name: g } }, mapping: { key: k, title: t } }
  b: { adapter: generic-mcp, server: s2, identifiers: ['^X-\d+$'], tools: { get: { name: g } }, mapping: { key: k, title: t } }
`)
  );
  try {
    const resolve = async (project: string, io: typeof t.io, out: string[], ...args: string[]) => {
      out.length = 0;
      const code = await runDev(['task', 'resolve', ...args, '--project', project], io);
      return { code, text: out.join('\n') };
    };
    assert.deepEqual(await resolve(t.projectRoot, t.io, t.out, 'ME-3'), { code: 0, text: 'resolved: personal (via pattern)' });
    assert.deepEqual(await resolve(t.projectRoot, t.io, t.out, '12345'), { code: 0, text: 'resolved: company (via default)' });
    assert.deepEqual(await resolve(t.projectRoot, t.io, t.out, 'HEF-1', '--source', 'personal'), { code: 0, text: 'resolved: personal (via explicit)' });
    assert.deepEqual(await resolve(t.projectRoot, t.io, t.out, 'HEF-1', '--source', 'nope'), { code: 2, text: 'unknown-source: nope (known: company, personal)' });
    assert.deepEqual(await resolve(two.projectRoot, two.io, two.out, 'X-1'), { code: 2, text: 'ambiguous: a, b' });
    const none = setup();
    try {
      assert.deepEqual(await resolve(none.projectRoot, none.io, none.out, 'X-1'), { code: 2, text: 'unresolved: no task sources are configured' });
    } finally {
      none.cleanup();
    }
    t.out.length = 0;
    assert.equal(await runDev(['task', 'resolve', 'ME-3', '--json', '--project', t.projectRoot], t.io), 0);
    assert.deepEqual(JSON.parse(t.text()), { status: 'resolved', source: 'personal', via: 'pattern' });
    assert.equal(await runDev(['task', 'resolve', '--project', t.projectRoot], t.io), 1);
  } finally {
    t.cleanup();
    two.cleanup();
  }
});

const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function taskProject() {
  const t = setup(cfg(CONFIG));
  git(t.projectRoot, 'init', '-q', '-b', 'main');
  git(t.projectRoot, 'config', 'user.email', 't@example.com');
  git(t.projectRoot, 'config', 'user.name', 'T');
  git(t.projectRoot, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(t.projectRoot, 'a.txt'), 'x');
  git(t.projectRoot, 'add', '-A');
  git(t.projectRoot, 'commit', '-q', '-m', 'init');
  const base = git(t.projectRoot, 'rev-parse', '--short=12', 'HEAD');
  const dirs = { taskDocsDir: '.dev-agent/tasks', stateDir: '.dev-agent/state' };
  const item = { source: 'company', id: '1', key: 'HEF-1', title: 'Card', description: 'Show it.', acceptanceCriteria: [], comments: [], attachments: [], links: [] };
  ingestWorkItem(t.projectRoot, dirs, item, { now: '2026-09-24T14:00:00Z' });
  git(t.projectRoot, 'switch', '-q', '-c', 'feat/hef-1-card');
  recordCheckpoint(t.projectRoot, dirs, 'HEF-1', { phase: 'implementation', state: { baseBranch: 'main', baseSha: base, workingBranch: 'feat/hef-1-card' } }, '2026-09-24T15:00:00Z');
  return t;
}

test('task status is 0 for a consistent task and 2 with reasons after the branch changed', async () => {
  const t = taskProject();
  try {
    assert.equal(await runDev(['task', 'status', 'HEF-1', '--project', t.projectRoot], t.io), 0);
    assert.match(t.text(), /phase: implementation/);
    assert.match(t.text(), /branch: feat\/hef-1-card/);
    assert.match(t.text(), /source configured: yes/);
    git(t.projectRoot, 'switch', '-q', 'main');
    t.out.length = 0;
    assert.equal(await runDev(['task', 'status', 'HEF-1', '--project', t.projectRoot], t.io), 2);
    assert.match(t.text(), /reconcil/i);
    assert.match(t.text(), /on branch "main"/);
    t.out.length = 0;
    assert.equal(await runDev(['task', 'status', 'NOPE-1', '--project', t.projectRoot, '--json'], t.io), 2);
    assert.equal(JSON.parse(t.text()).ok, false);
    assert.equal(await runDev(['task', 'status', '../../x', '--project', t.projectRoot], t.io), 1);
  } finally {
    t.cleanup();
  }
});

test('task show prints the ledger, and a missing or invalid key is an error', async () => {
  const t = taskProject();
  try {
    assert.equal(await runDev(['task', 'show', 'HEF-1', '--project', t.projectRoot], t.io), 0);
    assert.match(t.text(), /^# HEF-1 - Card/);
    assert.match(t.text(), /## Final status\nimplementing/);
    assert.equal(await runDev(['task', 'show', 'NOPE-1', '--project', t.projectRoot], t.io), 1);
    assert.match(t.err.join('\n'), /no ledger for NOPE-1/);
    assert.equal(await runDev(['task', 'show', '../../etc/passwd', '--project', t.projectRoot], t.io), 1);
  } finally {
    t.cleanup();
  }
});

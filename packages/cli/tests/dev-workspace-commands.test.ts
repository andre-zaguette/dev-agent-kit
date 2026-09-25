import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runDev, DEV_HELP } from '../src/dev-cli.ts';
import { ingestWorkItem, recordCheckpoint } from '../../core/src/index.ts';
import { setup } from './dev-helpers.ts';

const CONFIG = `workspaces:
  models:     { path: models, role: library }
  backend:    { path: backend, role: backend, dependsOn: [models] }
  policy-api: { path: policy-api, role: api, dependsOn: [backend] }
  client:     { path: client, role: frontend, dependsOn: [policy-api], baseBranch: develop }
  admin:      { path: admin, role: frontend, dependsOn: [policy-api] }
`;
const dirs = { taskDocsDir: '.dev-agent/tasks', stateDir: '.dev-agent/state' };

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.email=t@example.com', '-c', 'user.name=Test', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function repo(root: string, name: string, files: Record<string, string>): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  for (const [rel, text] of Object.entries(files)) writeFileSync(join(dir, rel), text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

/** models, backend and client are repositories (client's base is `develop`); policy-api and admin are plain folders. */
function pumpkin(config: string | null = CONFIG) {
  const t = setup(config === null ? {} : { '.dev-agent/config.yml': config });
  const root = t.projectRoot;
  repo(root, 'models', { 'pyproject.toml': '[project]\nname = "models"\nversion = "1.2.0"\ndependencies = []\n' });
  repo(root, 'backend', { 'pyproject.toml': '[project]\nname = "backend"\nversion = "0.5.0"\ndependencies = ["models>=1.3.0"]\n', 'app.py': 'x = 1\n' });
  const client = repo(root, 'client', { 'package.json': JSON.stringify({ name: 'client', dependencies: { react: '^18.0.0' } }) });
  writeFileSync(join(client, 'work.txt'), 'work');
  git(client, 'add', '-A');
  git(client, 'commit', '-q', '-m', 'work');
  git(client, 'branch', 'develop');
  for (const plain of ['policy-api', 'admin']) {
    mkdirSync(join(root, plain));
    writeFileSync(join(root, plain, 'README.md'), 'plain');
  }
  return t;
}

test('workspaces lists every workspace in dependency order with its Git state', async () => {
  const t = pumpkin();
  try {
    assert.equal(await runDev(['workspaces', '--project', t.projectRoot], t.io), 0);
    const lines = t.out;
    assert.deepEqual(lines.map((l) => l.split(/\s+/)[0]), ['models', 'backend', 'policy-api', 'admin', 'client']);
    assert.match(lines[0], /role: library.*git: repo, main, clean/);
    assert.match(lines[1], /dependsOn: models/);
    assert.match(lines[2], /git: not a repository/);
    assert.match(lines[4], /languages: .*javascript/i);
  } finally {
    t.cleanup();
  }
});

test('workspaces --json is parseable and reports missing directories and dirty trees', async () => {
  const t = pumpkin();
  try {
    writeFileSync(join(t.projectRoot, 'backend', 'wip.py'), 'x');
    rmSync(join(t.projectRoot, 'admin'), { recursive: true });
    assert.equal(await runDev(['workspaces', '--json', '--project', t.projectRoot], t.io), 0);
    const rows = JSON.parse(t.text());
    const by = Object.fromEntries(rows.map((r: { name: string }) => [r.name, r]));
    assert.equal(by.backend.git.state, 'repo');
    assert.equal(by.backend.git.dirty, true);
    assert.equal(by.admin.git.state, 'missing');
    assert.equal(by['policy-api'].git.state, 'not-a-repository');
    assert.deepEqual(by.client.dependsOn, ['policy-api']);
  } finally {
    t.cleanup();
  }
});

test('without workspaces configured the three commands say so and exit 0', async () => {
  const t = pumpkin(null);
  try {
    for (const argv of [['workspaces'], ['workspaces', 'verify'], ['workspaces', 'order']]) {
      t.out.length = 0;
      assert.equal(await runDev([...argv, '--project', t.projectRoot], t.io), 0, argv.join(' '));
      assert.equal(t.text(), 'no workspaces configured');
    }
  } finally {
    t.cleanup();
  }
});

test('workspaces verify reports paths, repositories and one pin line per edge', async () => {
  const t = pumpkin();
  try {
    assert.equal(await runDev(['workspaces', 'verify', '--project', t.projectRoot], t.io), 0);
    const text = t.text();
    assert.match(text, /✔ models: .*repository/);
    assert.match(text, /! policy-api: not a repository/);
    assert.match(text, /pin backend -> models: ahead/);
    assert.match(text, /pin policy-api -> backend: unknown/);
    assert.match(text, /pin client -> policy-api: unknown/);
    t.out.length = 0;
    assert.equal(await runDev(['workspaces', 'verify', '--json', '--project', t.projectRoot], t.io), 0);
    const json = JSON.parse(t.text());
    assert.equal(json.ok, true);
    assert.equal(json.pins.find((p: { dependent: string }) => p.dependent === 'backend').status, 'ahead');
  } finally {
    t.cleanup();
  }
});

test('workspaces verify exits 2 for a missing directory or a bad config, naming it', async () => {
  const t = pumpkin();
  try {
    rmSync(join(t.projectRoot, 'models'), { recursive: true });
    assert.equal(await runDev(['workspaces', 'verify', '--project', t.projectRoot], t.io), 2);
    assert.match(t.text(), /✘ models: .*does not exist/);
  } finally {
    t.cleanup();
  }
  const u = pumpkin('workspaces:\n  a: { path: ../x }\n');
  try {
    assert.equal(await runDev(['workspaces', 'verify', '--project', u.projectRoot], u.io), 2);
    assert.match(u.text(), /workspaces\.a\.path/);
  } finally {
    u.cleanup();
  }
});

test('workspaces order prints one name per line, with --only and --with-deps', async () => {
  const t = pumpkin();
  try {
    assert.equal(await runDev(['workspaces', 'order', '--project', t.projectRoot], t.io), 0);
    assert.deepEqual(t.out, ['models', 'backend', 'policy-api', 'admin', 'client']);
    t.out.length = 0;
    await runDev(['workspaces', 'order', '--only', 'client', '--project', t.projectRoot], t.io);
    assert.deepEqual(t.out, ['client']);
    t.out.length = 0;
    await runDev(['workspaces', 'order', '--only', 'client,admin', '--with-deps', '--project', t.projectRoot], t.io);
    assert.deepEqual(t.out, ['models', 'backend', 'policy-api', 'admin', 'client']);
    t.out.length = 0;
    assert.equal(await runDev(['workspaces', 'order', '--only', 'ghost', '--project', t.projectRoot], t.io), 1);
    assert.match(t.err.join('\n'), /unknown workspace "ghost"/);
  } finally {
    t.cleanup();
  }
});

test('--workspace runs inspect, repo index and repo similar inside that workspace', async () => {
  const t = pumpkin();
  try {
    assert.equal(await runDev(['inspect', '--workspace', 'client', '--project', t.projectRoot], t.io), 0);
    assert.match(t.text(), /languages: .*(javascript|typescript)/i);
    t.out.length = 0;
    assert.equal(await runDev(['inspect', '--workspace', 'backend', '--project', t.projectRoot], t.io), 0);
    assert.match(t.text(), /languages: .*python/i);
    t.out.length = 0;
    assert.equal(await runDev(['repo', 'index', '--workspace', 'backend', '--json', '--project', t.projectRoot], t.io), 0);
    const index = JSON.parse(t.text());
    const exts = index.extensions.map((e: { ext: string }) => e.ext);
    assert.ok(exts.includes('py'));
    assert.ok(!exts.includes('txt'));
    t.out.length = 0;
    assert.equal(await runDev(['repo', 'similar', 'app', '--workspace', 'backend', '--project', t.projectRoot], t.io), 0);
  } finally {
    t.cleanup();
  }
});

test('--workspace errors: unknown name, no workspaces configured, "all" outside diff review', async () => {
  const t = pumpkin();
  try {
    assert.equal(await runDev(['inspect', '--workspace', 'ghost', '--project', t.projectRoot], t.io), 1);
    assert.match(t.err.join('\n'), /unknown workspace "ghost".*models/);
    assert.equal(await runDev(['inspect', '--workspace', 'all', '--project', t.projectRoot], t.io), 1);
    assert.match(t.err.join('\n'), /"all".*diff review/);
    assert.equal(await runDev(['repo', 'index', '--workspace', 'all', '--project', t.projectRoot], t.io), 1);
  } finally {
    t.cleanup();
  }
  const u = pumpkin(null);
  try {
    assert.equal(await runDev(['inspect', '--workspace', 'models', '--project', u.projectRoot], u.io), 1);
    assert.match(u.err.join('\n'), /no workspaces configured/);
  } finally {
    u.cleanup();
  }
});

test('diff review --workspace uses the workspace baseBranch', async () => {
  const t = pumpkin();
  try {
    assert.equal(await runDev(['diff', 'review', '--workspace', 'client', '--json', '--project', t.projectRoot], t.io), 0);
    assert.equal(JSON.parse(t.text()).files.length, 0);
    t.out.length = 0;
    assert.equal(await runDev(['diff', 'review', '--workspace', 'client', '--base', 'HEAD~1', '--json', '--project', t.projectRoot], t.io), 0);
    assert.deepEqual(JSON.parse(t.text()).files.map((f: { path: string }) => f.path), ['work.txt']);
  } finally {
    t.cleanup();
  }
});

test('diff review --workspace all reviews repositories and skips the rest with a note', async () => {
  const t = pumpkin();
  try {
    assert.equal(await runDev(['diff', 'review', '--workspace', 'all', '--project', t.projectRoot], t.io), 0);
    const text = t.text();
    assert.match(text, /workspace models/);
    assert.match(text, /workspace client/);
    assert.match(text, /skipped policy-api: not a repository/);
    assert.match(text, /skipped admin: not a repository/);
    t.out.length = 0;
    writeFileSync(join(t.projectRoot, 'backend', 'leak.py'), 'AWS_KEY = "AKIAIOSFODNN7EXAMPLE"\n');
    assert.equal(await runDev(['diff', 'review', '--workspace', 'all', '--project', t.projectRoot], t.io), 2);
    assert.match(t.text(), /workspace backend[\s\S]*error/);
    t.out.length = 0;
    assert.equal(await runDev(['diff', 'review', '--workspace', 'all', '--json', '--project', t.projectRoot], t.io), 2);
    const json = JSON.parse(t.text());
    assert.ok(json.workspaces.backend.findings.length > 0);
    assert.match(json.workspaces['policy-api'].skipped, /not a repository/);
  } finally {
    t.cleanup();
  }
});

test('diff review --workspace all exits 1 when no workspace is a repository', async () => {
  const t = setup({ '.dev-agent/config.yml': 'workspaces:\n  a: { path: a }\n', 'a/x.txt': 'x' });
  try {
    assert.equal(await runDev(['diff', 'review', '--workspace', 'all', '--project', t.projectRoot], t.io), 1);
    assert.match(t.text(), /skipped a: not a repository/);
  } finally {
    t.cleanup();
  }
});

test('task status prints the per-workspace reports', async () => {
  const t = pumpkin();
  const cfg = { ...dirs, knowledgeDir: '.dev-agent/knowledge' };
  try {
    const item = { source: 'company', id: '1', key: 'APP-1', title: 'T', description: 'd', acceptanceCriteria: [], comments: [], attachments: [], links: [] };
    ingestWorkItem(t.projectRoot, cfg, item, { now: '2026-09-25T10:00:00Z' });
    const sha = git(join(t.projectRoot, 'models'), 'rev-parse', 'HEAD');
    git(join(t.projectRoot, 'models'), 'switch', '-q', '-c', 'feat/app-1');
    recordCheckpoint(t.projectRoot, cfg, 'APP-1', { phase: 'implementation', state: { workspaces: { models: { status: 'in-progress', baseSha: sha, workingBranch: 'feat/app-1' } } } });
    assert.equal(await runDev(['task', 'status', 'APP-1', '--project', t.projectRoot], t.io), 0);
    assert.match(t.text(), /workspaces:\n- models: ok/);
    git(join(t.projectRoot, 'models'), 'switch', '-q', 'main');
    t.out.length = 0;
    assert.equal(await runDev(['task', 'status', 'APP-1', '--project', t.projectRoot], t.io), 2);
    assert.match(t.text(), /- models: on branch "main" but the task recorded "feat\/app-1"/);
  } finally {
    t.cleanup();
  }
});

test('the help lists the new commands and options', () => {
  for (const line of ['dev-agent workspaces [', 'dev-agent workspaces verify', 'dev-agent workspaces order', '--workspace <name>']) assert.ok(DEV_HELP.includes(line), line);
});

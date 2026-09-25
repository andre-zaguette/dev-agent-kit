import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEV_HELP, runDev } from '../src/dev-cli.ts';
import { setup } from './dev-helpers.ts';

const DJANGO: Record<string, string> = {
  'requirements.txt': 'django\n',
  'manage.py': '',
  'notes/models.py': '',
  'notes/views.py': '',
  'notes/serializers.py': '',
  'notes/urls.py': '',
  'notes/migrations/0001_initial.py': '',
  'notes/tests/test_notes.py': '',
  'users/models.py': '',
  'users/views.py': ''
};

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function gitProject(files: Record<string, string> = DJANGO, commit = true) {
  const t = setup(files);
  git(t.projectRoot, 'init', '-q', '-b', 'main');
  git(t.projectRoot, 'config', 'user.email', 't@example.test');
  git(t.projectRoot, 'config', 'user.name', 'T');
  git(t.projectRoot, 'config', 'commit.gpgsign', 'false');
  if (commit) {
    git(t.projectRoot, 'add', '-A');
    git(t.projectRoot, 'commit', '-q', '-m', 'init');
  }
  return t;
}
function put(dir: string, rel: string, content: string): void {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), content);
}
const dev = (t: ReturnType<typeof setup>, ...args: string[]) => runDev([...args, '--project', t.projectRoot], t.io);

test('repo index prints layers and features; --json parses', async () => {
  const t = gitProject();
  try {
    assert.equal(await dev(t, 'repo', 'index'), 0);
    assert.match(t.text(), /files: 10/);
    assert.match(t.text(), /migration/);
    assert.match(t.text(), /note/);
    t.out.length = 0;
    assert.equal(await dev(t, 'repo', 'index', '--json'), 0);
    assert.ok(Array.isArray(JSON.parse(t.text()).features));
  } finally {
    t.cleanup();
  }
});

test('repo index --write stamps knowledge with the source SHA and is idempotent', async () => {
  const t = gitProject();
  try {
    assert.equal(await dev(t, 'repo', 'index', '--write'), 0);
    assert.match(t.text(), /wrote: .*architecture.*sourceSha [0-9a-f]{7,}/);
    const file = join(t.projectRoot, '.dev-agent/knowledge/architecture.md');
    const first = readFileSync(file, 'utf8');
    assert.match(first, /sourceSha/);
    assert.equal(await dev(t, 'repo', 'index', '--write'), 0);
    const stable = (text: string) => text.replace(/updatedAt: .*\n/, '');
    assert.equal(stable(readFileSync(file, 'utf8')), stable(first));
  } finally {
    t.cleanup();
  }
});

test('repo index --write refuses a repository without commits and a symlinked .dev-agent', async () => {
  const t = gitProject(DJANGO, false);
  const outside = setup();
  try {
    assert.equal(await dev(t, 'repo', 'index', '--write'), 1);
    assert.match(t.err.join('\n'), /at least one commit/);
    git(t.projectRoot, 'add', '-A');
    git(t.projectRoot, 'commit', '-q', '-m', 'init');
    symlinkSync(outside.projectRoot, join(t.projectRoot, '.dev-agent'));
    t.err.length = 0;
    assert.equal(await dev(t, 'repo', 'index', '--write'), 1);
    assert.match(t.err.join('\n'), /symbolic link/i);
    assert.equal(existsSync(join(outside.projectRoot, 'knowledge')), false);
  } finally {
    t.cleanup();
    outside.cleanup();
  }
});

test('repo index honors an invalid config as an error', async () => {
  const t = gitProject({ ...DJANGO, '.dev-agent/config.yml': 'knowledgeDir: /etc\n' });
  try {
    assert.equal(await dev(t, 'repo', 'index', '--write'), 1);
  } finally {
    t.cleanup();
  }
});

test('repo similar lists the closest feature, honors --limit and --json, and reports no match', async () => {
  const t = gitProject();
  try {
    assert.equal(await dev(t, 'repo', 'similar', 'add', 'archive', 'endpoint', 'for', 'notes'), 0);
    assert.match(t.text(), /note/);
    t.out.length = 0;
    assert.equal(await dev(t, 'repo', 'similar', 'notes', '--limit', '1', '--json'), 0);
    const parsed = JSON.parse(t.text());
    assert.equal(parsed.length, 1);
    t.out.length = 0;
    assert.equal(await dev(t, 'repo', 'similar', 'notes', '--limit', 'abc'), 1);
    const empty = gitProject({ 'README.md': 'x' });
    try {
      assert.equal(await dev(empty, 'repo', 'similar', 'zzz'), 0);
      assert.match(empty.text(), /no similar feature found/);
    } finally {
      empty.cleanup();
    }
  } finally {
    t.cleanup();
  }
});

test('diff review: clean repo exits 0, edited migration and secrets exit 2 without echoing the secret, bad base exits 1', async () => {
  const t = gitProject();
  try {
    assert.equal(await dev(t, 'diff', 'review'), 0);
    assert.match(t.text(), /empty-diff/);
    put(t.projectRoot, 'notes/migrations/0001_initial.py', 'changed');
    t.out.length = 0;
    assert.equal(await dev(t, 'diff', 'review'), 2);
    assert.match(t.text(), /migration-edited/);
    assert.match(t.text(), /✘ error/);
    git(t.projectRoot, 'checkout', '--', '.');
    put(t.projectRoot, 'notes/extra.txt', 'password = "hunter2hunter2"\n');
    t.out.length = 0;
    assert.equal(await dev(t, 'diff', 'review'), 2);
    assert.doesNotMatch(t.text(), /hunter2/);
    assert.match(t.text(), /secret-in-diff/);
    t.out.length = 0;
    assert.equal(await dev(t, 'diff', 'review', '--json'), 2);
    assert.doesNotMatch(t.text(), /hunter2/);
    assert.equal(JSON.parse(t.text()).findings[0].id, 'secret-in-diff');
    assert.equal(await dev(t, 'diff', 'review', '--base', 'nope'), 1);
    assert.match(t.err.join('\n'), /is not a commit/);
  } finally {
    t.cleanup();
  }
});

test('diff review caps the file list and a non-git directory is a usage error', async () => {
  const t = gitProject({ 'README.md': 'x' });
  const plain = setup({ 'a.txt': 'x' });
  try {
    for (let i = 0; i < 45; i++) put(t.projectRoot, `bulk/f${String(i).padStart(2, '0')}.txt`, 'x');
    assert.equal(await dev(t, 'diff', 'review'), 0);
    assert.match(t.text(), /… and 5 more/);
    assert.equal(await dev(plain, 'diff', 'review'), 1);
  } finally {
    t.cleanup();
    plain.cleanup();
  }
});

test('help lists the three commands and unknown subcommands are errors', async () => {
  for (const c of ['repo index', 'repo similar', 'diff review']) assert.ok(DEV_HELP.includes(`dev-agent ${c}`), c);
  const t = setup();
  try {
    assert.equal(await runDev(['repo', 'nope'], t.io), 1);
    assert.equal(await runDev(['diff', 'nope'], t.io), 1);
  } finally {
    t.cleanup();
  }
});

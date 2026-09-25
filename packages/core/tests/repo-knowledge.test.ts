import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { indexRepository } from '../src/repo-index.ts';
import { renderKnowledge, writeRepoKnowledge } from '../src/repo-knowledge.ts';
import { checkFreshness, readKnowledgeIn } from '../src/repo-memory.ts';
import { commitFile, makeRepo, sh } from './helpers.ts';

function put(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
}
const DJANGO = {
  'requirements.txt': 'django\npsycopg2\n',
  'manage.py': 'MARKER_FILE_CONTENT_QQ',
  'config/settings.py': '',
  'notes/models.py': '',
  'notes/views.py': '',
  'notes/serializers.py': '',
  'notes/urls.py': '',
  'notes/migrations/0001_initial.py': '',
  'notes/tests/test_notes.py': '',
  'users/models.py': '',
  'users/views.py': ''
};

function djangoRepo(): string {
  const dir = makeRepo();
  put(dir, DJANGO);
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

test('a Django-like index renders repository, commands, architecture and backend, but not frontend', () => {
  const dir = djangoRepo();
  try {
    const bodies = renderKnowledge(indexRepository(dir));
    assert.deepEqual(Object.keys(bodies).sort(), ['architecture', 'backend', 'commands', 'repository']);
    assert.match(bodies.repository!, /django/i);
    assert.match(bodies.repository!, /python/i);
    assert.match(bodies.commands!, /none detected|pytest|test/i);
    assert.match(bodies.architecture!, /note/);
    assert.match(bodies.architecture!, /migration/);
    assert.match(bodies.backend!, /notes\/migrations/);
    assert.equal(bodies.frontend, undefined);
    for (const body of Object.values(bodies)) assert.doesNotMatch(body!, /MARKER_FILE_CONTENT_QQ/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a React-like index renders frontend and no backend; a plain one renders the three base files only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dak-know-'));
  const plain = mkdtempSync(join(tmpdir(), 'dak-know-'));
  try {
    put(dir, { 'package.json': JSON.stringify({ dependencies: { react: '^18' } }), 'src/components/card.tsx': '', 'src/components/list.tsx': '', 'src/pages/home.tsx': '' });
    put(plain, { 'a.txt': '', 'docs/b.md': '' });
    const ui = renderKnowledge(indexRepository(dir));
    assert.ok(ui.frontend && /react/i.test(ui.frontend) && /src\/components/.test(ui.frontend));
    assert.equal(ui.backend, undefined);
    assert.deepEqual(Object.keys(renderKnowledge(indexRepository(plain))).sort(), ['architecture', 'commands', 'repository']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(plain, { recursive: true, force: true });
  }
});

test('every body stays under the size cap even with many features', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dak-know-'));
  try {
    const files: Record<string, string> = { 'requirements.txt': 'django\n' };
    for (let i = 0; i < 80; i++) for (const f of ['models.py', 'views.py', 'urls.py']) files[`feature${String(i).padStart(3, '0')}/${f}`] = '';
    put(dir, files);
    for (const body of Object.values(renderKnowledge(indexRepository(dir)))) assert.ok(body!.length <= 6000, `${body!.length}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeRepoKnowledge stamps the source commit, is idempotent and shows as fresh, then stale after a commit', () => {
  const dir = djangoRepo();
  try {
    const first = writeRepoKnowledge(dir, indexRepository(dir));
    assert.deepEqual(first.written.sort(), ['architecture', 'backend', 'commands', 'repository']);
    const doc = readKnowledgeIn(dir, '.dev-agent/knowledge', 'architecture')!;
    assert.equal(doc.sourceSha, first.sourceSha);
    const before = ['architecture', 'repository', 'commands', 'backend'].map((n) => readKnowledgeIn(dir, '.dev-agent/knowledge', n as never)!.body);
    writeRepoKnowledge(dir, indexRepository(dir));
    const after = ['architecture', 'repository', 'commands', 'backend'].map((n) => readKnowledgeIn(dir, '.dev-agent/knowledge', n as never)!.body);
    assert.deepEqual(after, before);
    assert.equal(checkFreshness(dir, doc).state, 'fresh');
    commitFile(dir, 'later.txt');
    assert.equal(checkFreshness(dir, doc).state, 'stale');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeRepoKnowledge refuses a repository without commits and a symlinked .dev-agent', () => {
  const empty = makeRepo();
  const linked = djangoRepo();
  const other = mkdtempSync(join(tmpdir(), 'dak-know-other-'));
  try {
    put(empty, { 'a.txt': '' });
    assert.throws(() => writeRepoKnowledge(empty, indexRepository(empty)), /git repository with at least one commit/);
    symlinkSync(other, join(linked, '.dev-agent'), 'dir');
    assert.throws(() => writeRepoKnowledge(linked, indexRepository(linked)), /symbolic link/);
    assert.equal(readFileSyncSafe(join(other, 'knowledge', 'repository.md')), null);
  } finally {
    [empty, linked, other].forEach((d) => rmSync(d, { recursive: true, force: true }));
  }
});

function readFileSyncSafe(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

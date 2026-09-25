import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { classifyPath, featureKey, indexRepository } from '../src/repo-index.ts';

function tree(files: Record<string, string> | string[]): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'dak-index-'));
  const entries = Array.isArray(files) ? files.map((f) => [f, ''] as const) : Object.entries(files);
  for (const [rel, content] of entries) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('classifyPath recognizes the common layers across stacks, and tests win over everything', () => {
  const table: Array<[string, string]> = [
    ['src/controllers/note_controller.py', 'controller'],
    ['app/Http/Controllers/NoteController.php', 'controller'],
    ['notes/views.py', 'controller'],
    ['src/routes/notes.ts', 'route'],
    ['config/routes.rb', 'route'],
    ['src/services/notes.ts', 'service'],
    ['src/main/java/com/example/NoteService.java', 'service'],
    ['notes/models.py', 'model'],
    ['app/models/note.rb', 'model'],
    ['src/notes/dto/create-note.dto.ts', 'schema'],
    ['notes/serializers.py', 'schema'],
    ['db/migrate/20240101_create_notes.rb', 'migration'],
    ['notes/migrations/0001_initial.py', 'migration'],
    ['src/main/resources/db/migration/V1__create.sql', 'migration'],
    ['tests/test_notes.py', 'test'],
    ['src/notes.test.ts', 'test'],
    ['spec/requests/notes_spec.rb', 'test'],
    ['src/test/java/com/example/NoteControllerTest.java', 'test'],
    ['Notes.Tests/NotesTests.cs', 'test'],
    ['tests/controllers/x.py', 'test'],
    ['src/components/Card.tsx', 'component'],
    ['src/views/Home.vue', 'component'],
    ['config/settings.py', 'config'],
    ['src/repositories/note_repository.ts', 'repository'],
    ['README.md', 'other'],
    ['LICENSE', 'other']
  ];
  for (const [path, role] of table) assert.equal(classifyPath(path), role, path);
});

test('featureKey names the feature from the directory or the file stem, and refuses generic files', () => {
  const table: Array<[string, string | null]> = [
    ['notes/views.py', 'note'],
    ['notes/models.py', 'note'],
    ['notes/migrations/0001_initial.py', 'note'],
    ['src/services/notes.ts', 'note'],
    ['app/Http/Controllers/NoteController.php', 'note'],
    ['src/users/users.controller.ts', 'user'],
    ['app/models/user_profile.rb', 'user'],
    ['src/main/java/com/example/OrderService.java', 'order'],
    ['src/main/java/com/example/notes/model/Note.java', 'note'],
    ['src/address/address.service.ts', 'address'],
    ['src/status/status.controller.ts', 'status'],
    ['src/index.ts', null],
    ['src/utils/helpers.ts', null],
    ['main.py', null],
    ['__init__.py', null],
    ['config/settings.py', null]
  ];
  for (const [path, key] of table) assert.equal(featureKey(path), key, path);
});

test('a Django-like tree yields a complete note feature, snake_case naming and the framework', () => {
  const t = tree({
    'requirements.txt': 'django\n',
    'manage.py': '',
    'config/settings.py': '',
    'notes/models.py': '',
    'notes/views.py': '',
    'notes/serializers.py': '',
    'notes/urls.py': '',
    'notes/permissions.py': '',
    'notes/migrations/0001_initial.py': '',
    'notes/tests/test_notes.py': '',
    'users/models.py': '',
    'users/views.py': '',
    'notes/note_admin.py': '',
    'notes/note_forms.py': '',
    'notes/note_signals.py': '',
    'notes/note_helpers.py': ''
  });
  try {
    const index = indexRepository(t.dir);
    assert.ok(index.profile.frameworks.includes('django'));
    assert.equal(index.features[0].name, 'note');
    for (const role of ['model', 'controller', 'schema', 'route', 'migration', 'test']) assert.ok(index.features[0].roles.includes(role as never), role);
    assert.equal(index.conventions.fileNaming, 'snake_case');
    assert.equal(index.conventions.testSuffix, undefined);
    assert.ok(index.roles.migration?.includes('notes/migrations'));
    assert.equal(index.truncated, false);
    assert.ok(index.fileCount >= 16);
  } finally {
    t.cleanup();
  }
});

test('Spring-, Rails-, Express- and React-like trees produce plausible features, naming and test suffixes', () => {
  const spring = tree([
    'pom.xml',
    'src/main/java/com/example/notes/NoteController.java',
    'src/main/java/com/example/notes/NoteService.java',
    'src/main/java/com/example/notes/NoteRepository.java',
    'src/main/java/com/example/notes/Note.java',
    'src/test/java/com/example/notes/NoteControllerTest.java',
    'src/test/java/com/example/notes/NoteServiceTest.java'
  ]);
  const rails = tree(['Gemfile', 'config/routes.rb', 'app/controllers/notes_controller.rb', 'app/models/note.rb', 'db/migrate/20240101_create_notes.rb', 'spec/requests/notes_spec.rb', 'spec/models/note_spec.rb']);
  const express = tree(['package.json', 'src/routes/notes.ts', 'src/services/notes.ts', 'src/notes.test.ts', 'src/routes/users.ts', 'src/services/users.ts', 'src/users.test.ts', 'src/types.ts']);
  const react = tree(['package.json', 'src/components/note-card.tsx', 'src/components/note-list.tsx', 'src/pages/notes.tsx', 'src/hooks/use-notes.ts', 'src/components/user-menu.tsx', 'src/components/note-form.tsx']);
  try {
    const s = indexRepository(spring.dir);
    assert.equal(s.features[0].name, 'note');
    assert.equal(s.conventions.testSuffix, 'Test.java');
    assert.equal(s.conventions.fileNaming, 'PascalCase');
    const r = indexRepository(rails.dir);
    assert.equal(r.features[0].name, 'note');
    assert.equal(r.conventions.testSuffix, '_spec.rb');
    const e = indexRepository(express.dir);
    assert.deepEqual(e.features.map((f) => f.name).sort(), ['note', 'user']);
    assert.equal(e.conventions.testSuffix, '.test.ts');
    const ui = indexRepository(react.dir);
    assert.equal(ui.conventions.fileNaming, 'kebab-case');
    assert.ok(ui.roles.component && ui.roles.component.length > 0);
  } finally {
    [spring, rails, express, react].forEach((x) => x.cleanup());
  }
});

test('a repository with no recognizable layers gives an honest, empty result', () => {
  const t = tree(['a.txt', 'b.txt', 'docs/x.md']);
  try {
    const index = indexRepository(t.dir);
    assert.deepEqual(index.features, []);
    assert.equal(index.conventions.fileNaming, 'unknown');
    assert.deepEqual(Object.keys(index.roles), []);
    assert.equal(index.fileCount, 3);
  } finally {
    t.cleanup();
  }
});

test('the walk is bounded: file cap, depth cap, skipped directories and no symlinks followed', () => {
  const started = performance.now();
  const many = tree({});
  const flat: string[] = [];
  mkdirSync(join(many.dir, 'flat'));
  for (let i = 0; i < 30_000; i++) writeFileSync(join(many.dir, 'flat', `f${String(i).padStart(5, '0')}.txt`), '');
  const nested = tree({ 'node_modules/x/models.py': '', 'src/keep.ts': '' });
  const deep = tree({});
  mkdirSync(join(deep.dir, 'd/'.repeat(200)), { recursive: true });
  writeFileSync(join(deep.dir, 'd/'.repeat(200), 'bottom.txt'), '');
  const links = tree({ 'real/a.ts': '' });
  symlinkSync('.', join(links.dir, 'loop'));
  symlinkSync(join(links.dir, 'real'), join(links.dir, 'alias'));
  try {
    void flat;
    const capped = indexRepository(many.dir, { maxFiles: 500 });
    assert.equal(capped.truncated, true);
    assert.equal(capped.fileCount, 500);
    const skipped = indexRepository(nested.dir);
    assert.equal(skipped.fileCount, 1);
    const shallow = indexRepository(deep.dir);
    assert.equal(shallow.fileCount, 0);
    const safe = indexRepository(links.dir);
    assert.equal(safe.fileCount, 1);
    assert.ok(performance.now() - started < 4000, `took ${Math.round(performance.now() - started)}ms`);
  } finally {
    [many, nested, deep, links].forEach((x) => x.cleanup());
  }
});

test('the index is deterministic regardless of creation order', () => {
  const files = ['notes/models.py', 'notes/views.py', 'notes/tests/test_notes.py', 'users/models.py', 'users/views.py', 'requirements.txt'];
  const a = tree(files);
  const b = tree([...files].reverse());
  try {
    assert.deepEqual(indexRepository(a.dir), indexRepository(b.dir));
    assert.deepEqual(indexRepository(a.dir), indexRepository(a.dir));
  } finally {
    a.cleanup();
    b.cleanup();
  }
});

test('in a git repository ignored files are left out and the excluded directory is skipped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fak-idx-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    mkdirSync(join(dir, '.tox/lib/auth'), { recursive: true });
    mkdirSync(join(dir, 'env/lib/x'), { recursive: true });
    mkdirSync(join(dir, 'docs/knowledge'), { recursive: true });
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, '.gitignore'), '.tox/\nenv/\n');
    for (const rel of ['.tox/lib/auth/models.py', 'env/lib/x/views.py', 'docs/knowledge/repository.md', 'src/a.py']) writeFileSync(join(dir, rel), '');
    const paths = (o = {}) => Object.values(indexRepository(dir, o).roles).flat().concat(indexRepository(dir, o).topDirs.map((d) => d.name));
    const idx = indexRepository(dir, { exclude: ['docs/knowledge'] });
    assert.equal(idx.fileCount, 2); // .gitignore + src/a.py
    assert.ok(!JSON.stringify(idx).includes('.tox'));
    assert.ok(!JSON.stringify(idx).includes('env/lib'));
    assert.equal(paths({ exclude: ['docs/knowledge'] }).includes('docs'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('documents and images are never layers, even when their names look like one', () => {
  assert.equal(classifyPath('docs/payment-service.md'), 'other');
  assert.equal(classifyPath('assets/user-model.png'), 'other');
  assert.equal(classifyPath('src/payment-service.ts'), 'service');
});

test('the feature list is capped at 60', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fak-idx-'));
  try {
    for (let i = 0; i < 80; i++) {
      const d = join(dir, `mod${String(i).padStart(2, '0')}x`);
      mkdirSync(d, { recursive: true });
      for (const f of ['models.py', 'views.py', 'urls.py']) writeFileSync(join(d, f), '');
    }
    assert.equal(indexRepository(dir).features.length, 60);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('single-word capitalized names do not decide the naming style', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fak-idx-'));
  try {
    mkdirSync(join(dir, 'src'));
    for (const f of ['Note.cs', 'User.cs', 'Order.cs', 'Item.cs', 'Cart.cs', 'Tag.cs']) writeFileSync(join(dir, 'src', f), '');
    assert.equal(indexRepository(dir).conventions.fileNaming, 'unknown');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a tree with more directories than the limit is reported as truncated', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fak-idx-'));
  try {
    for (let i = 0; i < 30; i++) mkdirSync(join(dir, `d${i}`));
    assert.equal(indexRepository(dir, { maxDirs: 10 }).truncated, true);
    assert.equal(indexRepository(dir).truncated, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Feature, Role, RepoIndex } from '../src/repo-index.ts';
import { findSimilar } from '../src/repo-similar.ts';

const feature = (name: string, entries: Array<[string, Role]>): Feature => ({
  name,
  files: entries.map(([path, role]) => ({ path, role })),
  roles: [...new Set(entries.map(([, r]) => r).filter((r) => r !== 'other'))].sort()
});
const index = (features: Feature[]): RepoIndex =>
  ({
    profile: { languages: [], frameworks: [], testCommands: [], lintCommands: [], typecheckCommands: [], docker: false },
    headSha: null,
    fileCount: 0,
    truncated: false,
    topDirs: [],
    extensions: [],
    roles: {},
    features,
    conventions: { fileNaming: 'unknown', testDirs: [] }
  }) as RepoIndex;

const NOTE = feature('note', [['notes/models.py', 'model'], ['notes/views.py', 'controller'], ['notes/serializers.py', 'schema'], ['notes/urls.py', 'route'], ['notes/tests/test_notes.py', 'test']]);
const USER = feature('user', [['users/models.py', 'model'], ['users/views.py', 'controller']]);
const ORDER = feature('order', [['orders/models.py', 'model'], ['orders/views.py', 'controller'], ['orders/serializers.py', 'schema'], ['orders/tests/test_orders.py', 'test']]);
const idx = index([NOTE, USER, ORDER]);

test('a query naming a feature ranks it first with a name match', () => {
  const [first] = findSimilar(idx, 'add archive endpoint for notes');
  assert.equal(first.name, 'note');
  assert.equal(first.reason, 'name-match');
  assert.ok(first.score >= 3);
  assert.ok(first.files.length >= 2);
});

test('a path-only match is reported as such, and matches in file paths count', () => {
  const idx2 = index([feature('billing', [['billing/models.py', 'model'], ['billing/invoice_views.py', 'controller']]), NOTE]);
  const [first] = findSimilar(idx2, 'invoice export');
  assert.equal(first.name, 'billing');
  assert.equal(first.reason, 'path-match');
});

test('no match falls back to the most complete features, only when they have three or more roles', () => {
  const result = findSimilar(idx, 'invoices');
  assert.deepEqual(result.map((r) => [r.name, r.reason, r.score]), [['note', 'most-complete', 0], ['order', 'most-complete', 0]]);
  assert.deepEqual(findSimilar(index([USER]), 'invoices'), []);
});

test('stopword-only, empty, accented and very long queries are handled', () => {
  assert.equal(findSimilar(idx, 'the and for with').length > 0, true);
  assert.deepEqual(findSimilar(index([]), ''), []);
  assert.doesNotThrow(() => findSimilar(idx, 'Ação de cadastro'));
  const started = performance.now();
  const r = findSimilar(idx, 'note '.repeat(2000));
  assert.equal(r[0].name, 'note');
  assert.ok(performance.now() - started < 200);
});

test('ties resolve by file count then name, deterministically, and limit is respected', () => {
  const a = feature('alpha', [['alpha/models.py', 'model'], ['alpha/views.py', 'controller'], ['alpha/x.py', 'other']]);
  const b = feature('beta', [['beta/models.py', 'model'], ['beta/views.py', 'controller']]);
  const tie = index([b, a]);
  const first = findSimilar(tie, 'alpha beta', 5).map((r) => r.name);
  assert.deepEqual(first, findSimilar(index([a, b]), 'alpha beta', 5).map((r) => r.name));
  assert.deepEqual(first, ['alpha', 'beta']);
  assert.equal(findSimilar(idx, 'notes users orders', 2).length, 2);
});

test('a feature with a single file never appears', () => {
  const lone = feature('lone', [['lone/models.py', 'model']]);
  assert.deepEqual(findSimilar(index([lone]), 'lone'), []);
});

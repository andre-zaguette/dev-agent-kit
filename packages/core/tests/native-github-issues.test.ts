// packages/core/tests/native-github-issues.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGithubIssuesAdapter } from '../src/task-sources/native/github-issues.ts';
import { ledgerKey } from '../src/task-sources/native/common.ts';
import { SourceUnavailableError, WorkItemNotFoundError } from '../src/task-sources/types.ts';
import { fakeFetch, sourceConfig } from './native-helpers.ts';

const API = 'https://api.github.com/repos/acme/app/issues/42';
const ISSUE = {
  id: 1001, number: 42, title: 'Export to CSV', state: 'open', html_url: 'https://github.com/acme/app/issues/42',
  body: 'Users want CSV.\n\n## Acceptance criteria\n- header row\n- UTF-8',
  labels: [{ name: 'bug' }, { name: 'api' }], assignee: { id: 7, login: 'octo' }
};
const COMMENTS = [{ id: 1, user: { login: 'octo' }, body: 'First', created_at: '2026-10-01T10:00:00Z' }];
const adapterWith = (routes: Parameters<typeof fakeFetch>[0], extra = {}) => {
  const f = fakeFetch(routes);
  return { ...f, adapter: createGithubIssuesAdapter({ config: sourceConfig('github-issues', { repo: 'acme/app', ...extra }), token: 'gh-token-123', fetch: f.fetch }) };
};

test('reads an issue with comments and normalizes it', async () => {
  const { adapter, calls } = adapterWith([{ match: API, json: ISSUE }, { match: `${API}/comments?per_page=100&page=1`, json: COMMENTS }]);
  const item = await adapter.getWorkItem('42');
  assert.equal(item.source, 'work');
  assert.equal(item.id, '1001');
  assert.equal(item.key, 'app-42');
  assert.equal(item.title, 'Export to CSV');
  assert.equal(item.status, 'open');
  assert.equal(item.type, 'issue');
  assert.deepEqual(item.labels, ['bug', 'api']);
  assert.deepEqual(item.assignee, { id: '7', name: 'octo' });
  assert.equal(item.rawUrl, 'https://github.com/acme/app/issues/42');
  assert.deepEqual(item.acceptanceCriteria, ['header row', 'UTF-8']);
  assert.deepEqual(item.comments, [{ id: '1', author: 'octo', body: 'First', createdAt: '2026-10-01T10:00:00Z' }]);
  assert.equal(item.metadata?.reference, 'acme/app#42');
  assert.equal(item.metadata?.partial, undefined);
  assert.equal(calls[0].headers.Authorization, 'Bearer gh-token-123');
  assert.equal(calls[0].headers['X-GitHub-Api-Version'], '2022-11-28');
  assert.deepEqual(adapter.capabilities(), { search: false, comments: true, attachments: false, links: false, write: false });
});

test('accepts #n, n and owner/name#n, and rejects anything else before any request', async () => {
  const other = 'https://api.github.com/repos/other/lib/issues/7';
  const { adapter, calls } = adapterWith([
    { match: API, json: ISSUE }, { match: `${API}/comments?per_page=100&page=1`, json: [] },
    { match: other, json: { ...ISSUE, id: 2, number: 7 } }, { match: `${other}/comments?per_page=100&page=1`, json: [] }
  ]);
  await adapter.getWorkItem('#42');
  assert.equal((await adapter.getWorkItem('other/lib#7')).key, 'lib-7');
  const before = calls.length;
  for (const bad of ['../..#1', 'acme/..#1', './.#1', '.../x#1', 'abc', '../x', '42?a=b', '42/../43', 'a/b/c#1', '4%2f2', '', '#', '1234567890']) {
    await assert.rejects(adapter.getWorkItem(bad), WorkItemNotFoundError, bad);
  }
  assert.equal(calls.length, before);
});

test('a failing comments lookup makes the item partial, not failed', async () => {
  const { adapter } = adapterWith([{ match: API, json: ISSUE }, { match: () => true, status: 500, text: 'oops' }]);
  const item = await adapter.getWorkItem('42');
  assert.deepEqual(item.comments, []);
  assert.deepEqual(item.metadata?.partial, ['comments']);
});

test('comments are paginated and capped at 100', async () => {
  const page = (n: number) => Array.from({ length: 100 }, (_, i) => ({ id: n * 100 + i, user: { login: 'u' }, body: `c${n}-${i}`, created_at: '2026-10-01T00:00:00Z' }));
  const { adapter, calls } = adapterWith([{ match: API, json: ISSUE }, { match: (c) => c.url.endsWith('page=1'), json: page(0) }, { match: (c) => c.url.endsWith('page=2'), json: page(1).slice(0, 1) }]);
  const item = await adapter.getWorkItem('42');
  assert.equal(item.comments.length, 100);
  assert.deepEqual(item.metadata?.partial, ['comments']);
  assert.equal(calls.length, 2);
});

test('a self-hosted base URL is honoured, and errors map to the typed errors', async () => {
  const { adapter } = adapterWith([{ match: 'https://ghe.example.com/api/v3/repos/acme/app/issues/42', json: ISSUE }, { match: () => true, json: [] }], { baseUrl: 'https://ghe.example.com/api/v3' });
  assert.equal((await adapter.getWorkItem('42')).title, 'Export to CSV');
  const gone = adapterWith([{ match: () => true, status: 404, text: '{"message":"Not Found"}' }]);
  await assert.rejects(gone.adapter.getWorkItem('42'), WorkItemNotFoundError);
  const denied = adapterWith([{ match: () => true, status: 401, text: '{"message":"Bad credentials"}' }]);
  await assert.rejects(denied.adapter.getWorkItem('42'), (e: Error) => e instanceof SourceUnavailableError && e.reason === 'auth');
});

test('ledgerKey is ledger-safe', () => {
  assert.equal(ledgerKey('app', '42'), 'app-42');
  assert.equal(ledgerKey('my repo/..x', '5'), 'my-repo-.x-5');
  assert.match(ledgerKey('x'.repeat(200), '123456789'), /^x+-123456789$/);
  assert.ok(ledgerKey('x'.repeat(200), '123456789').length <= 64);
  assert.match(ledgerKey('.hidden', '1'), /^[A-Za-z0-9]/);
});

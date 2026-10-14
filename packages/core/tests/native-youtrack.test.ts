// packages/core/tests/native-youtrack.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createYoutrackAdapter } from '../src/task-sources/native/youtrack.ts';
import { SourceUnavailableError, WorkItemNotFoundError } from '../src/task-sources/types.ts';
import { fakeFetch, sourceConfig } from './native-helpers.ts';

const BASE = 'https://tracker.example.com';
const ISSUE = {
  id: '2-1', idReadable: 'PROJ-7', summary: 'Add export', description: 'Body\n\n## Acceptance criteria\n- csv\n- json',
  customFields: [{ name: 'State', value: { name: 'Open' } }, { name: 'Priority', value: { name: 'Major' } }, { name: 'Type', value: { name: 'Task' } }, { name: 'Assignee', value: { login: 'ana', fullName: 'Ana' } }],
  tags: [{ name: 'export' }],
  links: [
    { direction: 'OUTWARD', linkType: { name: 'Depend', sourceToTarget: 'is required for', targetToSource: 'depends on' }, issues: [{ idReadable: 'PROJ-9', summary: 'Report' }] },
    { direction: 'INWARD', linkType: { name: 'Subtask', sourceToTarget: 'parent for', targetToSource: 'subtask of' }, issues: [{ idReadable: 'PROJ-1', summary: 'Epic' }] },
    { direction: 'BOTH', linkType: { name: 'Relates', sourceToTarget: 'relates to', targetToSource: 'relates to' }, issues: [{ idReadable: 'PROJ-5', summary: 'Near' }] }
  ],
  attachments: [{ id: '1-1', name: 'spec.pdf', mimeType: 'application/pdf', url: '/api/files/1-1?sign=abc' }]
};
const COMMENTS = [{ id: '4-1', text: 'Looks good', created: 1790000000000, author: { login: 'ana', fullName: 'Ana' } }];
const make = (routes: Parameters<typeof fakeFetch>[0], extra = {}) => {
  const f = fakeFetch(routes);
  return { ...f, adapter: createYoutrackAdapter({ config: sourceConfig('youtrack', { baseUrl: BASE, ...extra }), token: 'perm-token-1', fetch: f.fetch }) };
};
const isIssue = (c: { url: string }) => c.url.startsWith(`${BASE}/api/issues/PROJ-7?fields=`);

test('reads an issue, its custom fields, links, attachments and comments', async () => {
  const { adapter, calls } = make([{ match: isIssue, json: ISSUE }, { match: (c) => c.url.startsWith(`${BASE}/api/issues/PROJ-7/comments?`) && c.url.endsWith('$top=100&$skip=0'), json: COMMENTS }]);
  const item = await adapter.getWorkItem('PROJ-7');
  assert.equal(calls[0].headers.Authorization, 'Bearer perm-token-1');
  assert.equal(item.key, 'PROJ-7');
  assert.equal(item.id, '2-1');
  assert.equal(item.status, 'Open');
  assert.equal(item.priority, 'Major');
  assert.equal(item.type, 'Task');
  assert.deepEqual(item.assignee, { id: 'ana', name: 'Ana' });
  assert.deepEqual(item.labels, ['export']);
  assert.equal(item.rawUrl, `${BASE}/issue/PROJ-7`);
  assert.deepEqual(item.acceptanceCriteria, ['csv', 'json']);
  assert.deepEqual(item.comments, [{ id: '4-1', author: 'Ana', body: 'Looks good', createdAt: new Date(1790000000000).toISOString() }]);
  assert.deepEqual(item.attachments, [{ id: '1-1', name: 'spec.pdf', mimeType: 'application/pdf', url: `${BASE}/api/files/1-1?sign=abc` }]);
  assert.deepEqual(item.links.map((l) => [l.type, l.key]), [['blocks', 'PROJ-9'], ['parent', 'PROJ-1'], ['relates-to', 'PROJ-5']]);
  assert.equal(item.links[0].url, `${BASE}/issue/PROJ-9`);
  assert.deepEqual(adapter.capabilities(), { search: false, comments: true, attachments: true, links: true, write: false });
});

test('a context path in the base URL is kept, and a failing comments lookup is partial', async () => {
  const { adapter } = make([{ match: (c) => c.url.startsWith('https://h.example.com/youtrack/api/issues/PROJ-7?fields='), json: ISSUE }, { match: () => true, status: 500, text: 'x' }], { baseUrl: 'https://h.example.com/youtrack' });
  const item = await adapter.getWorkItem('PROJ-7');
  assert.equal(item.rawUrl, 'https://h.example.com/youtrack/issue/PROJ-7');
  assert.deepEqual(item.metadata?.partial, ['comments']);
});

test('errors and invalid keys', async () => {
  await assert.rejects(make([{ match: () => true, status: 404, text: '{"error":"Not Found"}' }]).adapter.getWorkItem('PROJ-7'), WorkItemNotFoundError);
  await assert.rejects(make([{ match: () => true, status: 401, text: 'Unauthorized' }]).adapter.getWorkItem('PROJ-7'), (e: Error) => e instanceof SourceUnavailableError && e.reason === 'auth');
  const { adapter, calls } = make([{ match: () => true, json: {} }]);
  for (const bad of ['', 'PROJ', '7', 'PROJ-7/../x', 'PROJ-7?fields=x', '../PROJ-7', 'PROJ-7%2f', 'PROJ-1 PROJ-2']) await assert.rejects(adapter.getWorkItem(bad), WorkItemNotFoundError, bad);
  assert.equal(calls.length, 0);
});

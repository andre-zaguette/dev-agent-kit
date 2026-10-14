// packages/core/tests/native-linear.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLinearAdapter } from '../src/task-sources/native/linear.ts';
import { SourceUnavailableError, WorkItemNotFoundError } from '../src/task-sources/types.ts';
import { fakeFetch, sourceConfig } from './native-helpers.ts';

const ISSUE = {
  id: 'uuid-1', identifier: 'ENG-123', title: 'Add export', description: 'Body\n\n## Acceptance criteria\n- csv\n- json',
  url: 'https://linear.app/acme/issue/ENG-123', priorityLabel: 'High', state: { name: 'In Progress' }, assignee: { id: 'u1', name: 'Ana' },
  labels: { nodes: [{ name: 'api' }] },
  parent: { identifier: 'ENG-100', title: 'Epic', url: 'https://linear.app/acme/issue/ENG-100' },
  children: { nodes: [{ identifier: 'ENG-124', title: 'Sub', url: 'https://linear.app/acme/issue/ENG-124' }] },
  relations: { nodes: [{ type: 'blocks', relatedIssue: { identifier: 'ENG-130', title: 'Later', url: 'https://linear.app/acme/issue/ENG-130' } }, { type: 'related', relatedIssue: { identifier: 'ENG-131', title: 'Near', url: 'https://linear.app/acme/issue/ENG-131' } }] },
  inverseRelations: { nodes: [{ type: 'blocks', issue: { identifier: 'ENG-90', title: 'Before', url: 'https://linear.app/acme/issue/ENG-90' } }] },
  attachments: { nodes: [{ id: 'a1', title: 'Design', url: 'https://example.com/design' }] },
  comments: { nodes: [{ id: 'c1', body: 'Looks good', createdAt: '2026-10-01T10:00:00Z', user: { name: 'Ana' } }], pageInfo: { hasNextPage: false } }
};
const make = (routes: Parameters<typeof fakeFetch>[0]) => {
  const f = fakeFetch(routes);
  return { ...f, adapter: createLinearAdapter({ config: sourceConfig('linear'), token: 'lin-key-123', fetch: f.fetch }) };
};

test('reads an issue in one GraphQL request, with variables', async () => {
  const { adapter, calls } = make([{ match: () => true, json: { data: { issue: ISSUE } } }]);
  const item = await adapter.getWorkItem('ENG-123');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.linear.app/graphql');
  assert.equal(calls[0].headers.Authorization, 'lin-key-123');
  const sent = JSON.parse(calls[0].body!);
  assert.deepEqual(sent.variables, { id: 'ENG-123' });
  assert.equal(sent.query.includes('ENG-123'), false);
  assert.equal(item.key, 'ENG-123');
  assert.equal(item.id, 'uuid-1');
  assert.equal(item.status, 'In Progress');
  assert.equal(item.priority, 'High');
  assert.deepEqual(item.assignee, { id: 'u1', name: 'Ana' });
  assert.deepEqual(item.labels, ['api']);
  assert.deepEqual(item.acceptanceCriteria, ['csv', 'json']);
  assert.deepEqual(item.comments, [{ id: 'c1', author: 'Ana', body: 'Looks good', createdAt: '2026-10-01T10:00:00Z' }]);
  assert.deepEqual(item.attachments, [{ id: 'a1', name: 'Design', url: 'https://example.com/design' }]);
  assert.deepEqual(item.links.map((l) => [l.type, l.key]), [['parent', 'ENG-100'], ['child', 'ENG-124'], ['blocks', 'ENG-130'], ['relates-to', 'ENG-131'], ['blocked-by', 'ENG-90']]);
  assert.deepEqual(adapter.capabilities(), { search: false, comments: true, attachments: true, links: true, write: false });
});

test('more comments than one page marks the item partial', async () => {
  const more = { ...ISSUE, comments: { ...ISSUE.comments, pageInfo: { hasNextPage: true } } };
  const item = await make([{ match: () => true, json: { data: { issue: more } } }]).adapter.getWorkItem('ENG-123');
  assert.deepEqual(item.metadata?.partial, ['comments']);
});

test('errors: null issue, GraphQL errors, HTTP errors and invalid identifiers', async () => {
  await assert.rejects(make([{ match: () => true, json: { data: { issue: null } } }]).adapter.getWorkItem('ENG-1'), WorkItemNotFoundError);
  await assert.rejects(make([{ match: () => true, json: { errors: [{ message: 'Entity not found: Issue' }] } }]).adapter.getWorkItem('ENG-1'), WorkItemNotFoundError);
  await assert.rejects(make([{ match: () => true, json: { errors: [{ message: 'Authentication required, not authenticated' }] } }]).adapter.getWorkItem('ENG-1'), (e: Error) => e instanceof SourceUnavailableError && e.reason === 'auth');
  await assert.rejects(make([{ match: () => true, status: 401, text: 'unauthorized' }]).adapter.getWorkItem('ENG-1'), (e: Error) => e instanceof SourceUnavailableError && e.reason === 'auth');
  const { adapter, calls } = make([{ match: () => true, json: {} }]);
  for (const bad of ['', 'ENG', '123', 'ENG-1/../2', 'ENG-1 OR 1=1', 'ENG-1"}', '../ENG-1', 'ENG-12345678901']) await assert.rejects(adapter.getWorkItem(bad), WorkItemNotFoundError, bad);
  assert.equal(calls.length, 0);
});

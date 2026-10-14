// packages/core/tests/native-jira.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adfToText, createJiraAdapter } from '../src/task-sources/native/jira.ts';
import { SourceUnavailableError, WorkItemNotFoundError } from '../src/task-sources/types.ts';
import { fakeFetch, sourceConfig } from './native-helpers.ts';

const BASE = 'https://acme.example.net';
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const ADF = { type: 'doc', version: 1, content: [para('Export the report.'), { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Acceptance criteria' }] }, { type: 'bulletList', content: [{ type: 'listItem', content: [para('csv')] }, { type: 'listItem', content: [para('json')] }] }] };
const ISSUE = {
  id: '10001', key: 'PROJ-7',
  fields: {
    summary: 'Add export', description: ADF, status: { name: 'To Do' }, issuetype: { name: 'Story' }, priority: { name: 'High' }, labels: ['api'],
    assignee: { accountId: 'acc-1', displayName: 'Ana' },
    attachment: [{ id: '5', filename: 'spec.pdf', mimeType: 'application/pdf', content: `${BASE}/secure/attachment/5/spec.pdf` }],
    issuelinks: [
      { type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, outwardIssue: { key: 'PROJ-9', fields: { summary: 'Report' } } },
      { type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, inwardIssue: { key: 'PROJ-3', fields: { summary: 'Setup' } } }
    ],
    parent: { key: 'PROJ-1', fields: { summary: 'Epic' } },
    subtasks: [{ key: 'PROJ-8', fields: { summary: 'Sub' } }]
  }
};
const COMMENTS = { total: 1, comments: [{ id: '1', author: { displayName: 'Ana' }, body: { type: 'doc', content: [para('Looks good')] }, created: '2026-10-01T10:00:00.000+0000' }] };
const issueUrl = (v: string) => `${BASE}/rest/api/${v}/issue/PROJ-7`;
const make = (routes: Parameters<typeof fakeFetch>[0], extra = {}, email: string | null = 'me@example.com') => {
  const f = fakeFetch(routes);
  return { ...f, adapter: createJiraAdapter({ config: sourceConfig('jira', { baseUrl: BASE, auth: 'cloud', emailEnv: 'E', ...extra }), token: 'tok', email: email ?? undefined, fetch: f.fetch }) };
};

test('Cloud: Basic auth, v3, ADF description and comments, links in both directions', async () => {
  const { adapter, calls } = make([{ match: (c) => c.url.startsWith(`${issueUrl('3')}?fields=`), json: ISSUE }, { match: `${issueUrl('3')}/comment?startAt=0&maxResults=100`, json: COMMENTS }]);
  const item = await adapter.getWorkItem('PROJ-7');
  assert.equal(calls[0].headers.Authorization, `Basic ${Buffer.from('me@example.com:tok').toString('base64')}`);
  assert.equal(item.key, 'PROJ-7');
  assert.equal(item.id, '10001');
  assert.equal(item.title, 'Add export');
  assert.equal(item.status, 'To Do');
  assert.equal(item.type, 'Story');
  assert.equal(item.priority, 'High');
  assert.deepEqual(item.assignee, { id: 'acc-1', name: 'Ana' });
  assert.equal(item.rawUrl, `${BASE}/browse/PROJ-7`);
  assert.match(item.description, /^Export the report\./);
  assert.deepEqual(item.acceptanceCriteria, ['csv', 'json']);
  assert.deepEqual(item.comments, [{ id: '1', author: 'Ana', body: 'Looks good', createdAt: '2026-10-01T10:00:00.000+0000' }]);
  assert.deepEqual(item.attachments, [{ id: '5', name: 'spec.pdf', mimeType: 'application/pdf', url: `${BASE}/secure/attachment/5/spec.pdf` }]);
  assert.deepEqual(item.links.map((l) => [l.type, l.key]), [['blocks', 'PROJ-9'], ['blocked-by', 'PROJ-3'], ['parent', 'PROJ-1'], ['child', 'PROJ-8']]);
  assert.deepEqual(adapter.capabilities(), { search: false, comments: true, attachments: true, links: true, write: false });
});

test('self-hosted: Bearer auth, /rest/api/2 and a plain-text description', async () => {
  const plain = { ...ISSUE, fields: { ...ISSUE.fields, description: 'Plain body\n\nAcceptance criteria:\n- one' } };
  const { adapter, calls } = make([{ match: (c) => c.url.startsWith(`${issueUrl('2')}?fields=`), json: plain }, { match: () => true, json: { total: 0, comments: [] } }], { auth: 'bearer', emailEnv: undefined }, null);
  const item = await adapter.getWorkItem('PROJ-7');
  assert.equal(calls[0].headers.Authorization, 'Bearer tok');
  assert.match(item.description, /^Plain body/);
  assert.deepEqual(item.acceptanceCriteria, ['one']);
});

test('comments are paginated by startAt and a failing lookup is partial', async () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i), author: { displayName: 'A' }, body: 'x', created: '2026-10-01T00:00:00.000+0000' }));
  const paged = make([{ match: (c) => c.url.includes('?fields='), json: ISSUE }, { match: (c) => c.url.includes('startAt=0'), json: { comments: mk(100) } }, { match: (c) => c.url.includes('startAt=100'), json: { comments: mk(5) } }]);
  const item = await paged.adapter.getWorkItem('PROJ-7');
  assert.equal(item.comments.length, 100);
  assert.deepEqual(item.metadata?.partial, ['comments']);
  const failing = make([{ match: (c) => c.url.includes('?fields='), json: ISSUE }, { match: () => true, status: 500, text: 'x' }]);
  assert.deepEqual((await failing.adapter.getWorkItem('PROJ-7')).metadata?.partial, ['comments']);
});

test('errors and invalid keys', async () => {
  await assert.rejects(make([{ match: () => true, status: 404, text: '{"errorMessages":["Issue Does Not Exist"]}' }]).adapter.getWorkItem('PROJ-7'), WorkItemNotFoundError);
  await assert.rejects(make([{ match: () => true, status: 401, text: 'Unauthorized' }]).adapter.getWorkItem('PROJ-7'), (e: Error) => e instanceof SourceUnavailableError && e.reason === 'auth');
  const { adapter, calls } = make([{ match: () => true, json: {} }]);
  for (const bad of ['', 'proj-7', 'PROJ', '7', 'PROJ-7/../x', 'PROJ-7?expand=names', '../PROJ-7', 'PROJ-7%2f']) await assert.rejects(adapter.getWorkItem(bad), WorkItemNotFoundError, bad);
  assert.equal(calls.length, 0);
});

test('a cloud source without an e-mail cannot be built', () => {
  assert.throws(() => make([], {}, null), /e-mail/);
});

test('adfToText covers the common nodes and never throws on hostile input', () => {
  assert.equal(adfToText('already text'), 'already text');
  assert.equal(adfToText(null), '');
  assert.equal(adfToText({ type: 'doc', content: [para('a'), para('b')] }), 'a\n\nb');
  assert.equal(adfToText({ type: 'doc', content: [{ type: 'orderedList', content: [{ type: 'listItem', content: [para('x')] }, { type: 'listItem', content: [para('y')] }] }] }), '1. x\n2. y');
  assert.equal(adfToText({ type: 'doc', content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'let a = 1;' }] }] }), '```\nlet a = 1;\n```');
  assert.equal(adfToText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi ' }, { type: 'mention', attrs: { text: '@ana' } }, { type: 'hardBreak' }, { type: 'inlineCard', attrs: { url: 'https://example.com/x' } }] }] }), 'hi @ana\nhttps://example.com/x');
  assert.equal(adfToText({ type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [para('a')] }, { type: 'tableCell', content: [para('b')] }] }] }] }), 'a | b');
  assert.equal(adfToText({ type: 'doc', content: [{ type: 'unknownNode', content: [{ type: 'text', text: 'kept' }] }, 42, null, { type: 'text' }] }), 'kept');
  let deep: Record<string, unknown> = { type: 'text', text: 'bottom' };
  for (let i = 0; i < 5000; i++) deep = { type: 'blockquote', content: [deep] };
  assert.doesNotThrow(() => adfToText(deep));
  assert.equal(adfToText({ type: 'doc', content: 'not-an-array' }), '');
});

// packages/core/tests/native-http.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMessage, collectPages, httpJson, joinUrl, safeMessage, type FetchLike } from '../src/task-sources/http.ts';
import { SourceUnavailableError, WorkItemNotFoundError } from '../src/task-sources/types.ts';
import { fakeFetch } from './native-helpers.ts';

const ctxOf = (fetch: FetchLike, extra: object = {}) => ({ sourceId: 'work', fetch, headers: { Authorization: 'Bearer tok' }, ...extra });

test('GET sends the headers, never follows redirects, and parses JSON', async () => {
  const { fetch, calls } = fakeFetch([{ match: 'https://api.example.com/a', json: { ok: 1 } }]);
  assert.deepEqual(await httpJson(ctxOf(fetch), 'https://api.example.com/a'), { ok: 1 });
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].redirect, 'manual');
  assert.equal(calls[0].headers.Authorization, 'Bearer tok');
  assert.equal(calls[0].headers.Accept, 'application/json');
  assert.equal(calls[0].body, undefined);
});

test('a body makes it a JSON POST', async () => {
  const { fetch, calls } = fakeFetch([{ match: () => true, json: { data: 1 } }]);
  await httpJson(ctxOf(fetch), 'https://api.example.com/graphql', { query: 'q', variables: { id: 'X' } });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].body!), { query: 'q', variables: { id: 'X' } });
});

test('status codes map to the right errors', async () => {
  const run = (status: number, extra: object = {}) => httpJson(ctxOf(fakeFetch([{ match: () => true, status, ...extra }]).fetch), 'https://api.example.com/a');
  await assert.rejects(run(404, { text: 'Not Found' }), WorkItemNotFoundError);
  await assert.rejects(run(401, { text: 'Bad credentials' }), (e: Error) => e instanceof SourceUnavailableError && e.reason === 'auth');
  await assert.rejects(run(403, { text: 'Forbidden' }), (e: Error) => e instanceof SourceUnavailableError && e.reason === 'auth');
  await assert.rejects(run(400, { text: 'Authentication required' }), (e: Error) => e instanceof SourceUnavailableError && e.reason === 'auth');
  await assert.rejects(run(403, { text: 'API rate limit exceeded' }), (e: Error) => e instanceof SourceUnavailableError && e.reason === 'unavailable' && /rate limiting/.test(e.message));
  await assert.rejects(run(429, { headers: { 'retry-after': '30' }, text: '' }), (e: Error) => /rate limiting.*retry after 30/.test(e.message));
  await assert.rejects(run(502, { text: 'bad gateway' }), (e: Error) => e instanceof SourceUnavailableError && e.reason === 'unavailable');
  await assert.rejects(run(200, { text: '<html>' }), /malformed response/);
});

test('a redirect is reported, not followed', async () => {
  const { fetch, calls } = fakeFetch([{ match: () => true, status: 302, headers: { location: 'https://evil.example.org/' } }]);
  await assert.rejects(httpJson(ctxOf(fetch), 'https://api.example.com/a'), /redirect \(302\).*not followed/);
  assert.equal(calls.length, 1);
});

test('oversized responses are refused, declared or actual', async () => {
  await assert.rejects(httpJson(ctxOf(fakeFetch([{ match: () => true, headers: { 'content-length': '5000000' }, text: '{}' }]).fetch), 'https://api.example.com/a'), /more than 2097152 bytes/);
  await assert.rejects(httpJson(ctxOf(fakeFetch([{ match: () => true, text: JSON.stringify({ x: 'a'.repeat(200) }) }]).fetch, { maxBytes: 100 }), 'https://api.example.com/a'), /more than 100 bytes/);
});

test('a hanging request times out', async () => {
  const hang: FetchLike = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  await assert.rejects(httpJson(ctxOf(hang, { timeoutMs: 20 }), 'https://api.example.com/a'), /unreachable \(timed out\)/);
});

test('secrets never reach an error message, pattern-matched or not', async () => {
  const ghToken = `ghp_${'A'.repeat(36)}`;
  const plain = 'plain-token-value-123';
  const { fetch } = fakeFetch([{ match: () => true, status: 500, text: `boom token=${ghToken} and ${plain} echoed` }]);
  await assert.rejects(httpJson(ctxOf(fetch, { secrets: [plain] }), 'https://api.example.com/a'), (e: Error) => !e.message.includes(ghToken) && !e.message.includes(plain) && e.message.length < 400);
  assert.equal(safeMessage(`x ${plain} y`, [plain]).includes(plain), false);
  assert.equal(classifyMessage('work', `Authentication failed for ${plain}`, [plain]).message.includes(plain), false);
});

test('network failures become unavailable, with the message scrubbed', async () => {
  const boom: FetchLike = async () => { throw new Error('connect ECONNREFUSED'); };
  await assert.rejects(httpJson(ctxOf(boom), 'https://api.example.com/a'), (e: Error) => e instanceof SourceUnavailableError && /ECONNREFUSED/.test(e.message));
});

test('classifyMessage and joinUrl', () => {
  assert.ok(classifyMessage('work', 'Entity not found: Issue') instanceof WorkItemNotFoundError);
  assert.equal((classifyMessage('work', 'invalid token') as SourceUnavailableError).reason, 'auth');
  assert.equal((classifyMessage('work', 'something else') as SourceUnavailableError).reason, 'unavailable');
  assert.equal(joinUrl('https://h.example.com/base/', '/api/x'), 'https://h.example.com/base/api/x');
});

test('collectPages stops on a short page and caps items and pages', async () => {
  const pages = [[1, 2], [3]];
  assert.deepEqual(await collectPages(async (p) => pages[p] ?? [], 2), { items: [1, 2, 3], truncated: false });
  assert.deepEqual(await collectPages(async () => [1, 2], 2, 3), { items: [1, 2, 1], truncated: true });
  let calls = 0;
  const forever = await collectPages(async () => (calls++, [1, 2]), 2, 1000, 3);
  assert.equal(calls, 3);
  assert.equal(forever.truncated, true);
  assert.deepEqual(await collectPages(async () => [], 2), { items: [], truncated: false });
});

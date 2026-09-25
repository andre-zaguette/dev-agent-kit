import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyClientUsage } from '../src/contract-usage.ts';
import { parseContract } from '../src/contract.ts';

const post = parseContract({ method: 'POST', path: '/api/users', request: { email: 'string' }, response: { id: 'uuid' }, errors: { '409': ['EMAIL_ALREADY_EXISTS'], '400': ['INVALID_INPUT'] } });

test('a client that posts to the path and handles every error code is fully confirmed', () => {
  const r = verifyClientUsage(post, [
    { path: 'src/api/users.ts', text: "export const createUser = (b) => request('/api/users', { method: 'POST', body: JSON.stringify(b) });" },
    { path: 'src/components/Form.tsx', text: "if (e.code === 'EMAIL_ALREADY_EXISTS') setError('exists'); else if (e.code === 'INVALID_INPUT') setError('bad');" }
  ]);
  assert.deepEqual(r, { used: true, methodConfirmed: true, files: ['src/api/users.ts'], pathOnlyFiles: [], missingErrorCodes: [] });
});

test('a client that never calls the path is not used, and an unhandled error code is reported', () => {
  assert.deepEqual(verifyClientUsage(post, [{ path: 'a.ts', text: "fetch('/api/people')" }]), { used: false, methodConfirmed: false, files: [], pathOnlyFiles: [], missingErrorCodes: ['EMAIL_ALREADY_EXISTS', 'INVALID_INPUT'] });
  const r = verifyClientUsage(post, [{ path: 'a.ts', text: "axios.post('/api/users', body); // handles EMAIL_ALREADY_EXISTS" }]);
  assert.equal(r.used, true);
  assert.equal(r.methodConfirmed, true);
  assert.deepEqual(r.missingErrorCodes, ['INVALID_INPUT']);
});

test('a route called only with another verb is not used, and is listed as path-only', () => {
  const r = verifyClientUsage(post, [{ path: 'a.ts', text: "axios.get('/api/users')" }]);
  assert.equal(r.used, false);
  assert.equal(r.methodConfirmed, false);
  assert.deepEqual(r.files, []);
  assert.deepEqual(r.pathOnlyFiles, ['a.ts']);
});

test('a method: option that belongs to an earlier call never confirms the next one', () => {
  const text = "fetch('/api/other', { method: 'POST' });\nfetch('/api/users');";
  const r = verifyClientUsage(post, [{ path: 'a.ts', text }]);
  assert.equal(r.used, false);
  assert.deepEqual(r.pathOnlyFiles, ['a.ts']);
  const both = verifyClientUsage(post, [{ path: 'a.ts', text: "fetch('/api/users');\nfetch('/api/users', { method: 'POST', body });" }]);
  assert.equal(both.used, true);
});

test('files are judged one by one: a POST in another file does not confirm this file', () => {
  const r = verifyClientUsage(post, [
    { path: 'get.ts', text: "axios.get('/api/users')" },
    { path: 'post.ts', text: "axios.post('/api/users', body)" }
  ]);
  assert.deepEqual(r.files, ['post.ts']);
  assert.deepEqual(r.pathOnlyFiles, ['get.ts']);
});

test('GET calls count with fetch defaults or .get, and parameterized paths match templates and concatenation', () => {
  const get = parseContract({ method: 'GET', path: '/api/users/{id}', response: { id: 'uuid' }, errors: {} });
  assert.equal(verifyClientUsage(get, [{ path: 'a.ts', text: 'const r = await fetch(`/api/users/${id}`);' }]).methodConfirmed, true);
  assert.equal(verifyClientUsage(get, [{ path: 'a.ts', text: "http.get('/api/users/' + id)" }]).methodConfirmed, true);
  assert.equal(verifyClientUsage(get, [{ path: 'a.ts', text: "fetch(`/api/users/${id}`, { method: 'DELETE' })" }]).methodConfirmed, false);
  assert.equal(verifyClientUsage(get, [{ path: 'a.ts', text: "fetch('/api/usersettings')" }]).used, false);
});

const used = (contract: ReturnType<typeof parseContract>, text: string) => verifyClientUsage(contract, [{ path: 'a.ts', text }]).used;
const get = parseContract({ method: 'GET', path: '/api/users', response: {}, errors: {} });

test('real clients with base URLs, options-style calls and framework helpers are recognized', () => {
  assert.equal(used(post, 'axios.post(`${API}/api/users`, b)'), true);
  assert.equal(used(post, "api.post(API_BASE + '/api/users', b)"), true);
  assert.equal(used(post, "axios({ method: 'post', url: '/api/users' })"), true);
  assert.equal(used(post, "axios({ url: '/api/users', method: 'POST', data })"), true);
  assert.equal(used(post, "fetch(buildUrl('/api/users'), { method: 'POST', body })"), true);
  assert.equal(used(post, "postJson('/api/users', body)"), true);
  assert.equal(used(get, 'fetch(`${BASE}/api/users`)'), true);
  assert.equal(used(get, "useFetch('/api/users')"), true);
  assert.equal(used(get, "useSWR('/api/users', fetcher)"), true);
  assert.equal(used(get, "axios('/api/users')"), true);
  assert.equal(used(get, "request<User[]>('/api/users')"), true);
});

test('a method: belonging to a different call, or a path that is not inside any call, never confirms', () => {
  assert.equal(used(post, "export const USERS = '/api/users';\nexport const logout = () => fetch('/auth/logout', { method: 'POST' });"), false);
  assert.equal(used(post, "const routes = ['/api/users', '/api/items']; fetch(routes[1], { method: 'DELETE' });"), false);
  assert.equal(used(post, "axios.get('/api/users'); axios.post('/api/other', b);"), false);
  assert.equal(used(get, "fetch('/api/users', { method: 'DELETE' })"), false);
  assert.equal(used(post, "axios.get(`${API}/api/users`)"), false);
  assert.equal(used(post, "useFetch('/api/users')"), false);
});

test('hostile client text stays fast', () => {
  const started = performance.now();
  for (const text of ['('.repeat(100_000) + "'/api/users'", ".get(".repeat(50_000) + "'/api/users'", "'".repeat(100_000) + '/api/users', ')'.repeat(100_000) + "'/api/users'"]) verifyClientUsage(post, [{ path: 'a.ts', text }]);
  assert.ok(performance.now() - started < 1000, `took ${Math.round(performance.now() - started)}ms`);
});

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
  assert.deepEqual(r, { used: true, methodConfirmed: true, files: ['src/api/users.ts'], missingErrorCodes: [] });
});

test('a client that never calls the path is not used, and an unhandled error code is reported', () => {
  assert.deepEqual(verifyClientUsage(post, [{ path: 'a.ts', text: "fetch('/api/people')" }]), { used: false, methodConfirmed: false, files: [], missingErrorCodes: ['EMAIL_ALREADY_EXISTS', 'INVALID_INPUT'] });
  const r = verifyClientUsage(post, [{ path: 'a.ts', text: "axios.post('/api/users', body); // handles EMAIL_ALREADY_EXISTS" }]);
  assert.equal(r.used, true);
  assert.equal(r.methodConfirmed, true);
  assert.deepEqual(r.missingErrorCodes, ['INVALID_INPUT']);
});

test('the method is not confirmed when the call uses another verb', () => {
  const r = verifyClientUsage(post, [{ path: 'a.ts', text: "axios.get('/api/users')" }]);
  assert.equal(r.used, true);
  assert.equal(r.methodConfirmed, false);
});

test('GET calls count with fetch defaults or .get, and parameterized paths match templates and concatenation', () => {
  const get = parseContract({ method: 'GET', path: '/api/users/{id}', response: { id: 'uuid' }, errors: {} });
  assert.equal(verifyClientUsage(get, [{ path: 'a.ts', text: 'const r = await fetch(`/api/users/${id}`);' }]).methodConfirmed, true);
  assert.equal(verifyClientUsage(get, [{ path: 'a.ts', text: "http.get('/api/users/' + id)" }]).methodConfirmed, true);
  assert.equal(verifyClientUsage(get, [{ path: 'a.ts', text: "fetch(`/api/users/${id}`, { method: 'DELETE' })" }]).methodConfirmed, false);
  assert.equal(verifyClientUsage(get, [{ path: 'a.ts', text: "fetch('/api/usersettings')" }]).used, false);
});

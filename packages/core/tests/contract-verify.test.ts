import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractErrorCode, matchesPrimitive, verifyExchange } from '../src/contract-verify.ts';
import { parseContract } from '../src/contract.ts';

const contract = parseContract({
  method: 'POST',
  path: '/api/users',
  request: { email: 'email', name: 'string', nickname: 'string?' },
  response: { id: 'uuid', email: 'email', name: 'string', tags: 'string[]', profile: { age: 'integer', bio: 'string?' } },
  errors: { '400': ['INVALID_INPUT'], '409': ['EMAIL_ALREADY_EXISTS'] },
  successStatus: 201
});
const ID = '3f2b8a4e-9d1c-4b6a-8e2f-0a1b2c3d4e5f';
const ok = { method: 'POST', path: '/api/users', requestBody: { email: 'a@example.test', name: 'Ana' }, status: 201, responseBody: { id: ID, email: 'a@example.test', name: 'Ana', tags: ['x'], profile: { age: 30 } } };
const kinds = (r: ReturnType<typeof verifyExchange>) => r.violations.map((v) => `${v.severity}:${v.kind}:${v.field ?? ''}`).sort();

test('a conforming exchange has no violations', () => {
  assert.deepEqual(verifyExchange(contract, ok), { ok: true, violations: [] });
});

test('primitive checks', () => {
  assert.equal(matchesPrimitive(ID, 'uuid'), true);
  assert.equal(matchesPrimitive('nope', 'uuid'), false);
  assert.equal(matchesPrimitive('a@b.co', 'email'), true);
  assert.equal(matchesPrimitive('a@b', 'email'), false);
  assert.equal(matchesPrimitive(3, 'integer'), true);
  assert.equal(matchesPrimitive(3.5, 'integer'), false);
  assert.equal(matchesPrimitive(3.5, 'number'), true);
  assert.equal(matchesPrimitive(NaN, 'number'), false);
  assert.equal(matchesPrimitive('2026-09-24T14:00:00Z', 'datetime'), true);
  assert.equal(matchesPrimitive('2026-09-24', 'date'), true);
  assert.equal(matchesPrimitive({}, 'object'), true);
  assert.equal(matchesPrimitive([], 'object'), false);
  assert.equal(matchesPrimitive(null, 'any'), true);
  assert.equal(matchesPrimitive('x', 'mystery'), false);
});

test('missing, wrong-typed and unexpected response fields are reported precisely', () => {
  const r = verifyExchange(contract, { ...ok, responseBody: { id: 'not-a-uuid', email: 'a@example.test', tags: 'x', profile: { age: 'old' }, extra: 1 } });
  assert.equal(r.ok, false);
  assert.deepEqual(kinds(r), ['error:missing:name', 'error:type:id', 'error:type:profile.age', 'error:type:tags', 'warning:unexpected:extra']);
});

test('optional fields may be absent or null; unexpected fields alone do not fail the exchange', () => {
  const r = verifyExchange(contract, { ...ok, requestBody: { email: 'a@example.test', name: 'Ana', nickname: null }, responseBody: { ...(ok.responseBody as object), profile: { age: 1, bio: null }, more: true } });
  assert.equal(r.ok, true);
  assert.deepEqual(kinds(r), ['warning:unexpected:more']);
});

test('a bad request body is reported against the request schema', () => {
  const r = verifyExchange(contract, { ...ok, requestBody: { email: 'nope' } });
  assert.deepEqual(kinds(r), ['error:missing:name', 'error:type:email']);
  assert.deepEqual(new Set(r.violations.map((v) => v.where)), new Set(['request']));
  assert.equal(verifyExchange(contract, { ...ok, requestBody: undefined }).ok, false);
});

test('the route must match: method, path template, query strings and trailing slashes', () => {
  assert.equal(verifyExchange(contract, { ...ok, method: 'post' }).ok, true);
  assert.equal(verifyExchange(contract, { ...ok, path: '/api/users?debug=1' }).ok, true);
  assert.equal(verifyExchange(contract, { ...ok, path: '/api/users/' }).ok, true);
  for (const wrong of [{ method: 'GET' }, { path: '/api/people' }]) {
    const r = verifyExchange(contract, { ...ok, ...wrong });
    assert.deepEqual(kinds(r), ['error:route:']);
  }
  const param = parseContract({ method: 'GET', path: '/api/users/{id}', response: {}, errors: {} });
  assert.equal(verifyExchange(param, { method: 'GET', path: '/api/users/42', status: 200, responseBody: {} }).ok, true);
  assert.equal(verifyExchange(param, { method: 'GET', path: '/api/users/42/extra', status: 200, responseBody: {} }).ok, false);
});

test('error statuses must be listed and carry a listed code, in any common envelope', () => {
  for (const body of [{ code: 'EMAIL_ALREADY_EXISTS' }, { error: { code: 'EMAIL_ALREADY_EXISTS' } }, { detail: { code: 'EMAIL_ALREADY_EXISTS' } }]) {
    assert.equal(verifyExchange(contract, { ...ok, status: 409, responseBody: body }).ok, true, JSON.stringify(body));
  }
  assert.deepEqual(kinds(verifyExchange(contract, { ...ok, status: 500, responseBody: { code: 'BOOM' } })), ['error:status:']);
  assert.deepEqual(kinds(verifyExchange(contract, { ...ok, status: 409, responseBody: { code: 'SOMETHING_ELSE' } })), ['error:error-code:']);
  assert.deepEqual(kinds(verifyExchange(contract, { ...ok, status: 409, responseBody: { message: 'exists' } })), ['error:error-code:']);
  assert.equal(extractErrorCode({ detail: [{ msg: 'x' }] }), undefined);
});

test('the success status must equal successStatus when the contract sets one, and any 2xx otherwise', () => {
  assert.deepEqual(kinds(verifyExchange(contract, { ...ok, status: 200 })), ['error:status:']);
  const open = parseContract({ ...contract, successStatus: undefined });
  assert.equal(verifyExchange(open, { ...ok, status: 200 }).ok, true);
  assert.equal(verifyExchange(open, { ...ok, status: 302 }).ok, false);
});

test('odd bodies never crash the verifier', () => {
  for (const body of [null, undefined, 'text', 42, [], [1, 2], true]) {
    const r = verifyExchange(contract, { ...ok, responseBody: body });
    assert.equal(r.ok, false, JSON.stringify(body));
    assert.ok(r.violations.length > 0);
  }
  for (const body of [null, undefined, 'text', []]) assert.equal(verifyExchange(contract, { ...ok, status: 409, responseBody: body }).ok, false);
});

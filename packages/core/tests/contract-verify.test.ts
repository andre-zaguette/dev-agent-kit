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

test('an empty response body is fine when the contract declares no response fields (204)', () => {
  const del = parseContract({ method: 'DELETE', path: '/api/users/{id}', response: {}, errors: { '404': ['USER_NOT_FOUND'] }, successStatus: 204 });
  for (const body of [undefined, null, '']) assert.equal(verifyExchange(del, { method: 'DELETE', path: '/api/users/1', status: 204, responseBody: body }).ok, true, String(body));
  assert.equal(verifyExchange(del, { method: 'DELETE', path: '/api/users/1', status: 204, responseBody: { x: 1 } }).ok, true);
});

test('route matching stays fast on hostile paths with many adjacent parameters', () => {
  const started = performance.now();
  const many = parseContract({ method: 'GET', path: '/{a}-{b}-{c}-{d}-{e}', response: {}, errors: {} });
  assert.equal(verifyExchange(many, { method: 'GET', path: `/${'-'.repeat(200)}`, status: 200, responseBody: {} }).ok, true);
  const file = parseContract({ method: 'GET', path: '/files/{name}.{ext}', response: {}, errors: {} });
  assert.equal(verifyExchange(file, { method: 'GET', path: `/files/${'a'.repeat(50_000)}`, status: 200, responseBody: {} }).ok, false);
  assert.equal(verifyExchange(file, { method: 'GET', path: '/files/report.pdf', status: 200, responseBody: {} }).ok, true);
  assert.equal(verifyExchange(many, { method: 'GET', path: `/${'-'.repeat(10_000)}`, status: 200, responseBody: {} }).ok, false);
  assert.ok(performance.now() - started < 500, `took ${Math.round(performance.now() - started)}ms`);
});

const listContract = parseContract({ method: 'GET', path: '/api/users', response: [{ id: 'uuid', email: 'email' }], errors: {} });
const list = (body: unknown) => verifyExchange(listContract, { method: 'GET', path: '/api/users', status: 200, responseBody: body });

test('an array response body is checked element by element', () => {
  assert.equal(list([{ id: ID, email: 'a@example.test' }]).ok, true);
  assert.equal(list([]).ok, true);
  assert.deepEqual(kinds(list({})), ['error:type:']);
  assert.deepEqual(kinds(list([{ id: ID, email: 'a@example.test' }, { id: ID }])), ['error:missing:[1].email']);
  assert.deepEqual(kinds(list([{ id: 'nope', email: 'a@example.test' }])), ['error:type:[0].id']);
  assert.equal(list(null).ok, false);
});

test('arrays of objects and primitives inside fields, and optional nested keys', () => {
  const c = parseContract({ method: 'GET', path: '/x', response: { users: [{ id: 'uuid' }], tags: ['string'], 'profile?': { age: 'integer' } }, errors: {} });
  const run = (body: unknown) => verifyExchange(c, { method: 'GET', path: '/x', status: 200, responseBody: body });
  assert.equal(run({ users: [{ id: ID }], tags: ['a'] }).ok, true);
  assert.deepEqual(kinds(run({ users: [{ id: 5 }], tags: ['a'] })), ['error:type:users[0].id']);
  assert.deepEqual(kinds(run({ users: 'x', tags: ['a'] })), ['error:type:users']);
  assert.deepEqual(kinds(run({ users: [], tags: ['a', 3] })), ['error:type:tags[1]']);
  assert.equal(run({ users: [], tags: [], profile: null }).ok, true);
  assert.equal(run({ users: [], tags: [], profile: { age: 3 } }).ok, true);
  assert.deepEqual(kinds(run({ users: [], tags: [], profile: { age: 'old' } })), ['error:type:profile.age']);
});

test('an array request body is verified, and the 204 shortcut does not apply to array responses', () => {
  const c = parseContract({ method: 'POST', path: '/bulk', request: [{ id: 'uuid' }], response: [{ id: 'uuid' }], errors: {}, successStatus: 200 });
  assert.equal(verifyExchange(c, { method: 'POST', path: '/bulk', requestBody: [], status: 200, responseBody: [] }).ok, true);
  assert.equal(verifyExchange(c, { method: 'POST', path: '/bulk', requestBody: [{ id: 'x' }], status: 200, responseBody: [] }).ok, false);
  assert.equal(verifyExchange(c, { method: 'POST', path: '/bulk', requestBody: [], status: 200, responseBody: undefined }).ok, false);
});

test('an undefined body is described as undefined, not "a undefined"', () => {
  const r = verifyExchange(contract, { ...ok, responseBody: undefined });
  assert.ok(r.violations.some((v) => /got undefined/.test(v.message)), JSON.stringify(r.violations));
  assert.ok(!r.violations.some((v) => /a undefined/.test(v.message)));
});

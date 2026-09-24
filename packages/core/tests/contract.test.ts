import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contractPath, parseContract, readContract, writeContract } from '../src/contract.ts';

const dirs = { taskDocsDir: '.dev-agent/tasks', stateDir: '.dev-agent/state' };
const SPEC_EXAMPLE = {
  method: 'POST',
  path: '/api/users',
  request: { email: 'string', name: 'string' },
  response: { id: 'uuid', email: 'string', name: 'string' },
  errors: { '400': ['INVALID_INPUT'], '409': ['EMAIL_ALREADY_EXISTS'] }
};
function tmp(): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'dak-contract-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('the spec example parses, from a value and from JSON text', () => {
  assert.deepEqual(parseContract(SPEC_EXAMPLE), SPEC_EXAMPLE);
  assert.deepEqual(parseContract(JSON.stringify(SPEC_EXAMPLE)), SPEC_EXAMPLE);
});

test('optional, array and nested field types are accepted, with a success status', () => {
  const c = parseContract({
    method: 'GET',
    path: '/api/users/{id}',
    response: { id: 'uuid', nickname: 'string?', tags: 'string[]', roles: 'string[]?', profile: { age: 'integer', bio: 'string?' }, created: 'datetime' },
    errors: { '404': ['USER_NOT_FOUND'] },
    successStatus: 200
  });
  assert.equal(c.path, '/api/users/{id}');
  assert.equal(c.successStatus, 200);
  assert.deepEqual(c.response.profile, { age: 'integer', bio: 'string?' });
});

const bad = (over: Record<string, unknown>, pattern: RegExp) => assert.throws(() => parseContract({ ...SPEC_EXAMPLE, ...over }), pattern, JSON.stringify(over));

test('malformed contracts are refused with the field named', () => {
  bad({ method: 'post' }, /method/);
  bad({ method: 'TRACE' }, /method/);
  bad({ path: 'api/users' }, /path/);
  bad({ path: '/api/users?x=1' }, /path/);
  bad({ path: '/api/../users' }, /path/);
  bad({ path: '/api//users' }, /path/);
  bad({ path: '/api/{id' }, /path/);
  bad({ path: '/api/{1bad}' }, /path/);
  bad({ response: undefined }, /response/);
  bad({ response: { id: 'uuidv4' } }, /response\.id/);
  bad({ response: { 'bad name': 'string' } }, /response/);
  bad({ request: { a: 5 } }, /request\.a/);
  bad({ errors: { '200': ['X_Y'] } }, /errors/);
  bad({ errors: { '409': [] } }, /errors\.409/);
  bad({ errors: { '409': ['lower_case'] } }, /errors\.409/);
  bad({ errors: { '409': ['DUP', 'DUP'] } }, /errors\.409/);
  bad({ successStatus: 404 }, /successStatus/);
  bad({ extra: true }, /extra.*not a recognized/);
  assert.throws(() => parseContract('{not json'), /invalid JSON/);
  assert.throws(() => parseContract('[]'), /object/);
  assert.throws(() => parseContract(null), /object/);
});

test('hostile field names, absurd nesting and huge objects are refused', () => {
  assert.throws(() => parseContract(JSON.stringify({ ...SPEC_EXAMPLE, response: JSON.parse('{"__proto__": "string"}') })), /response/);
  assert.throws(() => parseContract({ ...SPEC_EXAMPLE, response: { constructor: 'string' } }), /response/);
  let deep: Record<string, unknown> = { leaf: 'string' };
  for (let i = 0; i < 6; i++) deep = { n: deep };
  assert.throws(() => parseContract({ ...SPEC_EXAMPLE, response: deep }), /nested too deeply/);
  const wide = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`f${i}`, 'string']));
  assert.throws(() => parseContract({ ...SPEC_EXAMPLE, response: wide }), /too many fields/);
});

test('the contract lives next to the ledger and its key must be filename-safe', () => {
  assert.equal(contractPath(dirs, 'APP-88'), '.dev-agent/tasks/APP-88.contract.json');
  for (const key of ['../../etc/x', 'a b', '', 'a..b']) assert.throws(() => contractPath(dirs, key), /invalid work item key/, key);
});

test('write then read round-trips, and a missing contract is null', () => {
  const t = tmp();
  try {
    assert.equal(readContract(t.dir, dirs, 'APP-88'), null);
    assert.deepEqual(writeContract(t.dir, dirs, 'APP-88', SPEC_EXAMPLE), SPEC_EXAMPLE);
    assert.deepEqual(readContract(t.dir, dirs, 'APP-88'), SPEC_EXAMPLE);
  } finally {
    t.cleanup();
  }
});

test('an invalid contract or a hostile key writes nothing, and a symlinked directory is refused', () => {
  const t = tmp();
  const other = mkdtempSync(join(tmpdir(), 'dak-contract-other-'));
  try {
    assert.throws(() => writeContract(t.dir, dirs, 'APP-88', { ...SPEC_EXAMPLE, method: 'nope' }), /method/);
    assert.throws(() => writeContract(t.dir, dirs, '../../x', SPEC_EXAMPLE), /invalid work item key/);
    assert.equal(existsSync(join(t.dir, '.dev-agent')), false);
    symlinkSync(other, join(t.dir, '.dev-agent'), 'dir');
    assert.throws(() => writeContract(t.dir, dirs, 'APP-88', SPEC_EXAMPLE), /symbolic link/);
    mkdirSync(join(other, 'tasks'), { recursive: true });
    assert.equal(existsSync(join(other, 'tasks', 'APP-88.contract.json')), false);
  } finally {
    t.cleanup();
    rmSync(other, { recursive: true, force: true });
  }
});

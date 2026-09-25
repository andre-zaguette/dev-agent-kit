import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpenApiText, verifyOpenApi } from '../src/contract-openapi.ts';
import { parseContract } from '../src/contract.ts';

const contract = parseContract({
  method: 'POST',
  path: '/api/users',
  request: { email: 'email', name: 'string' },
  response: { id: 'uuid', email: 'email', name: 'string', tags: 'string[]', bio: 'string?' },
  errors: { '400': ['INVALID_INPUT'], '409': ['EMAIL_ALREADY_EXISTS'] },
  successStatus: 201
});

const doc = (over: Record<string, unknown> = {}) => ({
  openapi: '3.1.0',
  paths: {
    '/api/users': {
      post: {
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/UserCreate' } } } },
        responses: {
          '201': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/UserOut' } } } },
          '400': { description: 'bad' },
          '409': { description: 'conflict' }
        }
      }
    }
  },
  components: {
    schemas: {
      UserCreate: { type: 'object', required: ['email', 'name'], properties: { email: { type: 'string', format: 'email' }, name: { type: 'string' } } },
      UserOut: {
        type: 'object',
        required: ['id', 'email', 'name', 'tags'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          bio: { anyOf: [{ type: 'string' }, { type: 'null' }] }
        }
      }
    }
  },
  ...over
});
const kinds = (r: ReturnType<typeof verifyOpenApi>) => r.violations.map((v) => `${v.severity}:${v.kind}:${v.field ?? ''}`).sort();

test('a matching description passes, including $ref, arrays and nullable optionals', () => {
  assert.deepEqual(verifyOpenApi(contract, doc()), { ok: true, violations: [] });
});

test('YAML and JSON text both parse, and garbage is a clear error', () => {
  assert.deepEqual(parseOpenApiText('{"a": 1}'), { a: 1 });
  assert.deepEqual(parseOpenApiText('a:\n  - 1\n'), { a: [1] });
  assert.throws(() => parseOpenApiText('a: [unclosed'), /not valid JSON or YAML/);
});

test('a missing route, a different method and a document that is not OpenAPI are reported', () => {
  assert.deepEqual(kinds(verifyOpenApi(contract, { openapi: '3.1.0', paths: {} })), ['error:route:']);
  assert.deepEqual(kinds(verifyOpenApi({ ...contract, method: 'PUT' }, doc())), ['error:route:']);
  assert.deepEqual(kinds(verifyOpenApi(contract, 'nope')), ['error:route:']);
  assert.deepEqual(kinds(verifyOpenApi(contract, { paths: 5 })), ['error:route:']);
});

test('path parameter names may differ between the contract and the description', () => {
  const c = parseContract({ method: 'GET', path: '/api/users/{id}', response: { id: 'uuid' }, errors: {} });
  const d = { paths: { '/api/users/{user_id}': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } } } } } } } } };
  assert.equal(verifyOpenApi(c, d).ok, true);
});

test('missing properties, wrong types, undeclared error statuses and a wrong success status are errors', () => {
  const d = doc();
  const out = (d.components.schemas.UserOut as { properties: Record<string, unknown> }).properties;
  delete out.name;
  out.tags = { type: 'string' };
  out.id = { type: 'integer' };
  const responses = (d.paths['/api/users'].post as { responses: Record<string, unknown> }).responses;
  delete responses['409'];
  const r = verifyOpenApi(contract, d);
  assert.equal(r.ok, false);
  assert.deepEqual(
    kinds(r).filter((k) => k.startsWith('error')),
    ['error:missing:name', 'error:status:', 'error:type:id', 'error:type:tags']
  );
  const wrongStatus = doc();
  const rs = (wrongStatus.paths['/api/users'].post as { responses: Record<string, unknown> }).responses;
  rs['200'] = rs['201'];
  delete rs['201'];
  assert.ok(kinds(verifyOpenApi(contract, wrongStatus)).includes('error:status:'));
});

test('softer findings are warnings: missing format, required-in-contract but optional in the description, extra properties', () => {
  const d = doc();
  const schemas = d.components.schemas as unknown as Record<string, { properties: Record<string, Record<string, unknown>>; required: string[] }>;
  delete schemas.UserOut.properties.id.format;
  schemas.UserOut.required = ['id', 'email', 'tags'];
  schemas.UserOut.properties.extra = { type: 'string' };
  const r = verifyOpenApi(contract, d);
  assert.equal(r.ok, true);
  assert.deepEqual(kinds(r), ['warning:type:id', 'warning:unexpected:extra', 'warning:missing:name'].sort());
});

test('cycles, dangling refs, allOf and a missing components section are bounded and never throw', () => {
  const cyc = doc();
  const schemas = cyc.components.schemas as Record<string, unknown>;
  schemas.UserOut = { $ref: '#/components/schemas/UserOut' };
  assert.doesNotThrow(() => verifyOpenApi(contract, cyc));
  assert.doesNotThrow(() => verifyOpenApi(contract, doc({ components: undefined })));
  const viaAllOf = doc();
  (viaAllOf.components.schemas as Record<string, unknown>).UserOut = {
    allOf: [{ $ref: '#/components/schemas/Base' }, { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } }, bio: { type: 'string' } }, required: ['tags'] }]
  };
  (viaAllOf.components.schemas as Record<string, unknown>).Base = { type: 'object', required: ['id', 'email', 'name'], properties: { id: { type: 'string', format: 'uuid' }, email: { type: 'string', format: 'email' }, name: { type: 'string' } } };
  assert.equal(verifyOpenApi(contract, viaAllOf).ok, true);
  const selfAllOf = doc();
  (selfAllOf.components.schemas as Record<string, unknown>).UserOut = { allOf: [{ $ref: '#/components/schemas/UserOut' }] };
  assert.doesNotThrow(() => verifyOpenApi(contract, selfAllOf));
});

test('a __proto__ property in the description does not pollute anything', () => {
  const d = doc();
  (d.components.schemas as unknown as Record<string, { properties: Record<string, unknown> }>).UserOut.properties = JSON.parse('{"__proto__": {"type": "string"}, "id": {"type": "string", "format": "uuid"}}');
  verifyOpenApi(contract, d);
  assert.equal(({} as Record<string, unknown>).type, undefined);
});

test('an allOf bomb is bounded: a tiny document cannot hang the verifier and is reported as unresolved', () => {
  const started = performance.now();
  const bomb = doc();
  (bomb.components.schemas as Record<string, unknown>).UserOut = { allOf: Array.from({ length: 12 }, () => ({ $ref: '#/components/schemas/UserOut' })) };
  const r = verifyOpenApi(contract, bomb);
  assert.equal(r.ok, false);
  assert.ok(performance.now() - started < 2000, `took ${Math.round(performance.now() - started)}ms`);
});

test('path keys of absurd length are skipped, not scanned', () => {
  const started = performance.now();
  const d = doc();
  // the giants come first, so a scan that does not skip them would reach them before the real route
  d.paths = { ['{'.repeat(100_000)]: {}, ['/'.repeat(100_000)]: {}, ...d.paths } as typeof d.paths;
  assert.equal(verifyOpenApi(contract, d).ok, true);
  assert.ok(performance.now() - started < 500, `took ${Math.round(performance.now() - started)}ms`);
});

test('schemas that cannot be resolved are errors when the contract declares fields', () => {
  const dangling = doc();
  (dangling.components.schemas as Record<string, unknown>).UserOut = { $ref: '#/components/schemas/Gone' };
  assert.equal(verifyOpenApi(contract, dangling).ok, false);
  const cyc = doc();
  (cyc.components.schemas as Record<string, unknown>).UserOut = { $ref: '#/components/schemas/UserOut' };
  assert.equal(verifyOpenApi(contract, cyc).ok, false);
  const bad = doc();
  ((bad.components.schemas as Record<string, { properties: Record<string, unknown> }>).UserOut.properties).name = { $ref: '#/components/schemas/Gone' };
  assert.equal(verifyOpenApi(contract, bad).ok, false);
});

test('OpenAPI 3.1 nullable type arrays are understood', () => {
  const d = doc();
  const props = (d.components.schemas as Record<string, { properties: Record<string, unknown> }>).UserOut.properties;
  props.bio = { type: ['string', 'null'] };
  props.tags = { type: ['array', 'null'], items: { type: 'string' } };
  const c = parseContract({ ...contract, response: { ...contract.response, tags: 'string[]?' } });
  assert.deepEqual(verifyOpenApi(c, d), { ok: true, violations: [] });
  props.name = { type: ['integer', 'null'] };
  assert.equal(verifyOpenApi(c, d).ok, false);
});

const listDoc = (schema: unknown) => ({
  openapi: '3.1.0',
  paths: { '/api/users': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema } } } } } } },
  components: { schemas: { UserOut: { type: 'object', required: ['id', 'email'], properties: { id: { type: 'string', format: 'uuid' }, email: { type: 'string', format: 'email' } } } } }
});

test('an array response verifies against an array schema with items', () => {
  const c = parseContract({ method: 'GET', path: '/api/users', response: [{ id: 'uuid', email: 'email' }], errors: {} });
  assert.deepEqual(verifyOpenApi(c, listDoc({ type: 'array', items: { $ref: '#/components/schemas/UserOut' } })), { ok: true, violations: [] });
  assert.equal(verifyOpenApi(c, listDoc({ $ref: '#/components/schemas/UserOut' })).ok, false);
  const missing = listDoc({ type: 'array', items: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } });
  assert.ok(kinds(verifyOpenApi(c, missing)).some((k) => k.startsWith('error:missing:')));
});

test('arrays of objects inside fields and optional nested keys map to the described properties', () => {
  const c = parseContract({ method: 'GET', path: '/api/users', response: { users: [{ id: 'uuid' }], 'profile?': { age: 'integer' } }, errors: {} });
  const d = listDoc({
    type: 'object',
    required: ['users'],
    properties: { users: { type: 'array', items: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } }, profile: { type: 'object', required: ['age'], properties: { age: { type: 'integer' } } } }
  });
  assert.deepEqual(verifyOpenApi(c, d), { ok: true, violations: [] });
  const wrong = listDoc({ type: 'object', required: ['users'], properties: { users: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' } } } }, profile: { type: 'object', required: ['age'], properties: { age: { type: 'integer' } } } } });
  assert.ok(kinds(verifyOpenApi(c, wrong)).some((k) => k.startsWith('error:type:users[]')));
});

test('an array schema without items is a warning (valid in 3.1), not an unresolved-schema error', () => {
  const c = parseContract({ method: 'GET', path: '/api/users', response: [{ id: 'uuid' }], errors: {} });
  const r = verifyOpenApi(c, listDoc({ type: 'array' }));
  assert.equal(r.ok, true);
  assert.ok(r.violations.some((v) => v.severity === 'warning' && /items/.test(v.message)));
});

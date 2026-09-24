# Dev Agent Kit v0.9 — Fullstack Orchestration and the `dev-agent` CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one work item span frontend and backend without the two drifting apart: a persisted API contract, deterministic verifiers that check real evidence against it, a `fullstack-contract` skill, three fullstack eval scenarios, and a `dev-agent` CLI that makes the v0.6–v0.8 deterministic modules callable (`inspect`, `context audit`, `sources`, `sources verify`, `task resolve|status|show`, `contract verify|usage|show`) while keeping `install`/`verify` as aliases of the existing `frontend-agent` commands.

**Architecture:** The contract is a small JSON file, `.dev-agent/tasks/<KEY>.contract.json`, validated and read/written through the existing containment-checked `safe-fs`. Verifiers live in `packages/core` and are pure functions over evidence the agent already has: a captured HTTP exchange, an OpenAPI description, and client source text. The CLI is a thin router in `packages/cli` that calls core functions and prints results; it never runs an LLM loop, opens an MCP transport or mutates Git. `frontend-agent` is untouched.

**Tech Stack:** TypeScript (ES2022, NodeNext), `node --test` via `tsx`, `node:util` `parseArgs`, `yaml` (already a `packages/core` dependency), Markdown skills, JSON eval scenarios.

**Spec:** `docs/superpowers/specs/2026-09-24-dev-agent-kit-evolution.md` — §23 (v0.9 fullstack), §25 (CLI evolution), §26 (project inspector), §28 (evals), §35 (fullstack DoD), §38 (v0.9 checklist), §41 (fullstack example), §43 (compatibility).

## Global Constraints

- `frontend-agent install|verify`, its help text, the seven frontend skills, the v0.6–v0.8 skills, the MCP tool names, `.frontend-agent/config.yml` and all 27 existing eval scenarios stay untouched (§43). `integrations/claude/CLAUDE.md` and `integrations/codex/AGENTS.md` are not modified (their shape test forbids task-source wording).
- The CLI is deterministic and read-mostly: it may read config, ledgers, state, contracts, evidence files and the repository, and may print. The only file it ever writes is nothing at all in this version (`contract` files are written by the agent, not by the CLI). It never runs Git mutations, network calls, LLM calls or MCP transports (§25).
- CLI exit codes: `0` success, `1` usage or environment error (bad flag, missing project, unreadable file, invalid config passed to a command that needs it), `2` "checked and not OK" (ambiguous or unresolved source, resume needs reconciling, contract violations).
- Files the CLI reads on the user's request (`--exchange`, `--openapi`, `--client`) are size-capped, must be regular files (symlinks are skipped, never followed), and client directories must resolve inside the project.
- Contract, ledger and state files are written only through `safeWriteFile` and contain no credentials (§9.2, §36). Work-item text and evidence are untrusted data.
- Shared skills stay neutral: `skills/fullstack-contract/SKILL.md` must not name a framework, database, queue, test runner, design tool or task-source product, and stays ≤ 60 lines. Enforced by a test.
- Reference file names stay unique across the kit (the eval harness identifies a read by file name). The one new reference is `contract-format`.
- Imports between `src/` files use `.js` extensions; tests import `src/` with `.ts` (repo convention). Cross-package imports use relative paths (as `packages/evals` already does).
- Commits: append the attribution trailer the session configures. Never `git reset --hard`, never force-push.
- The real benchmark is intentionally skipped by the user; do not run `npm run bench`. Scenarios are validated offline with `npm run evals:validate`.

## Review Focus

Failure modes the spec implies but no obvious task test would otherwise exercise (each pinned by a test in the owning task):

1. A hostile contract: work-item key as a path (`../../x`), `__proto__` / `constructor` field names, absurd nesting or field counts, a path with a query string or `..` → refused before anything is written or compared (Task 1).
2. An exchange or response body that is `null`, an array, a string, or missing; an error body in each common envelope (`{code}`, `{error:{code}}`, `{detail:{code}}`); a status the contract does not list → precise violations, never a crash (Task 2).
3. An OpenAPI document with `$ref` cycles, dangling refs, `allOf`, nullable `anyOf` or a missing `components` → bounded work and clear results, never infinite recursion (Task 3).
4. CLI evidence files that are huge, not regular files, malformed JSON/YAML, or client directories that escape the project or contain symlinks → clear error and the right exit code (Tasks 4–6).
5. `dev-agent install|verify` must behave exactly like `frontend-agent install|verify`, and `frontend-agent` must be byte-for-byte unaffected (Task 4).

---

### Task 1: The API contract artifact

**Files:**
- Create: `packages/core/src/contract.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/contract.test.ts`

**Interfaces:**
- Consumes: `assertWorkItemKey`, `TaskDirs` (v0.7 `ledger.ts`); `safeReadFile`, `safeWriteFile` (v0.7 `safe-fs.ts`).
- Produces (`contract.ts`):
  - `CONTRACT_METHODS = ['GET','POST','PUT','PATCH','DELETE']`, `type ContractMethod`
  - `type ContractType = string | { [field: string]: ContractType }` — a string is `<primitive>`, `<primitive>?` (optional), `<primitive>[]` (array) or `<primitive>[]?`, with primitive one of `string | uuid | email | integer | number | boolean | datetime | date | object | any`; an object nests fields
  - `interface ApiContract { method: ContractMethod; path: string; request?: Record<string, ContractType>; response: Record<string, ContractType>; errors: Record<string, string[]>; successStatus?: number }`
  - `parseContract(input: unknown, label?: string): ApiContract` (accepts JSON text or an already-parsed value; throws with the setting named)
  - `contractPath(dirs: TaskDirs, key: string): string` → `<taskDocsDir>/<KEY>.contract.json`
  - `writeContract(root: string, dirs: TaskDirs, key: string, contract: unknown): ApiContract` (validates, then writes pretty JSON)
  - `readContract(root: string, dirs: TaskDirs, key: string): ApiContract | null`

- [ ] **Step 1: Write the failing tests**

`packages/core/tests/contract.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test packages/core/tests/contract.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|Cannot find" | head -3`
Expected: FAIL — `../src/contract.ts` not found.

- [ ] **Step 3: Implement**

`packages/core/src/contract.ts`:

```ts
import { assertWorkItemKey, type TaskDirs } from './ledger.js';
import { safeReadFile, safeWriteFile } from './safe-fs.js';

export const CONTRACT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type ContractMethod = (typeof CONTRACT_METHODS)[number];
export type ContractType = string | { [field: string]: ContractType };

export interface ApiContract {
  method: ContractMethod;
  path: string;
  request?: Record<string, ContractType>;
  response: Record<string, ContractType>;
  errors: Record<string, string[]>;
  successStatus?: number;
}

const TYPE_RE = /^(?:string|uuid|email|integer|number|boolean|datetime|date|object|any)(?:\[\])?\??$/;
const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const PATH_RE = /^\/[A-Za-z0-9._~\-/{}:@%]*$/;
const PARAM_RE = /\{[A-Za-z_][A-Za-z0-9_]*\}/g;
const FORBIDDEN_FIELDS = new Set(['__proto__', 'constructor', 'prototype']);
const TOP_KEYS = new Set(['method', 'path', 'request', 'response', 'errors', 'successStatus']);
const MAX_DEPTH = 4;
const MAX_FIELDS = 100;
const MAX_CODES = 50;

function fail(label: string, where: string, message: string): never {
  throw new Error(`${label}: ${where} ${message}`);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function parseFields(label: string, where: string, raw: unknown, depth: number): Record<string, ContractType> {
  if (!isRecord(raw)) fail(label, where, 'must be an object of field names to types');
  if (depth > MAX_DEPTH) fail(label, where, `is nested too deeply (max ${MAX_DEPTH} levels)`);
  const entries = Object.entries(raw);
  if (entries.length > MAX_FIELDS) fail(label, where, `has too many fields (max ${MAX_FIELDS})`);
  return Object.fromEntries(
    entries.map(([name, value]): [string, ContractType] => {
      const at = `${where}.${name}`;
      if (!FIELD_RE.test(name) || FORBIDDEN_FIELDS.has(name)) fail(label, where, `has an invalid field name "${name.slice(0, 40)}"`);
      if (typeof value === 'string') {
        if (!TYPE_RE.test(value)) fail(label, at, `has an invalid type "${value.slice(0, 40)}" (use string, uuid, email, integer, number, boolean, datetime, date, object or any; add ? for optional or [] for arrays)`);
        return [name, value];
      }
      if (isRecord(value)) return [name, parseFields(label, at, value, depth + 1)];
      return fail(label, at, 'must be a type string or a nested object');
    })
  );
}

function parsePath(label: string, value: unknown): string {
  if (typeof value !== 'string' || !PATH_RE.test(value) || value.includes('..') || value.includes('//') || value.replace(PARAM_RE, '').match(/[{}]/)) {
    fail(label, 'path', 'must be an absolute path such as "/api/users/{id}" (no query string, "..", "//" or malformed {params})');
  }
  return value;
}

export function parseContract(input: unknown, label = 'contract'): ApiContract {
  let raw = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (error) {
      throw new Error(`${label}: invalid JSON (${(error as Error).message.split('\n')[0]})`);
    }
  }
  if (!isRecord(raw)) fail(label, 'the file', 'must be a JSON object');
  for (const key of Object.keys(raw)) if (!TOP_KEYS.has(key)) fail(label, key, 'is not a recognized setting');

  if (typeof raw.method !== 'string' || !(CONTRACT_METHODS as readonly string[]).includes(raw.method)) {
    fail(label, 'method', `must be one of ${CONTRACT_METHODS.join(', ')} (uppercase)`);
  }
  const contract: ApiContract = {
    method: raw.method as ContractMethod,
    path: parsePath(label, raw.path),
    response: raw.response === undefined ? fail(label, 'response', 'is required (use {} for an empty body)') : parseFields(label, 'response', raw.response, 1),
    errors: {}
  };
  if (raw.request !== undefined) contract.request = parseFields(label, 'request', raw.request, 1);

  if (!isRecord(raw.errors)) fail(label, 'errors', 'is required and must map status codes to error code lists (use {} for none)');
  contract.errors = Object.fromEntries(
    Object.entries(raw.errors).map(([status, codes]): [string, string[]] => {
      const at = `errors.${status}`;
      if (!/^[45]\d\d$/.test(status)) fail(label, 'errors', `has an invalid status "${status.slice(0, 10)}" (use 4xx or 5xx)`);
      if (!Array.isArray(codes) || codes.length === 0 || codes.length > MAX_CODES) fail(label, at, `must be a non-empty list of at most ${MAX_CODES} error codes`);
      if (codes.some((c) => typeof c !== 'string' || !CODE_RE.test(c))) fail(label, at, 'has an invalid error code (use UPPER_SNAKE_CASE)');
      if (new Set(codes).size !== codes.length) fail(label, at, 'lists the same error code twice');
      return [status, codes as string[]];
    })
  );
  if (raw.successStatus !== undefined) {
    if (!Number.isInteger(raw.successStatus) || (raw.successStatus as number) < 200 || (raw.successStatus as number) > 299) fail(label, 'successStatus', 'must be an integer from 200 to 299');
    contract.successStatus = raw.successStatus as number;
  }
  return contract;
}

export function contractPath(dirs: TaskDirs, key: string): string {
  assertWorkItemKey(key);
  return `${dirs.taskDocsDir}/${key}.contract.json`;
}

export function writeContract(root: string, dirs: TaskDirs, key: string, contract: unknown): ApiContract {
  const parsed = parseContract(contract);
  safeWriteFile(root, contractPath(dirs, key), `${JSON.stringify(parsed, null, 2)}\n`);
  return parsed;
}

export function readContract(root: string, dirs: TaskDirs, key: string): ApiContract | null {
  const text = safeReadFile(root, contractPath(dirs, key));
  return text === null ? null : parseContract(text, `${key}.contract.json`);
}
```

`packages/core/src/index.ts`: append `export * from './contract.js';`

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test --workspace=packages/core 2>&1 | grep -E "^ℹ (pass|fail)"; npm run typecheck --workspace=packages/core`
Expected: `fail 0`, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "core: the persisted API contract artifact"
```

---

### Task 2: Contract verifier — a real HTTP exchange against the contract

**Files:**
- Create: `packages/core/src/contract-verify.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/contract-verify.test.ts`

**Interfaces:**
- Consumes: `ApiContract`, `ContractType` (Task 1).
- Produces (`contract-verify.ts`):
  - `interface Exchange { method: string; path: string; requestBody?: unknown; status: number; responseBody?: unknown }`
  - `interface Violation { where: 'route' | 'request' | 'response' | 'status'; field?: string; kind: 'route' | 'missing' | 'type' | 'unexpected' | 'status' | 'error-code'; severity: 'error' | 'warning'; message: string }`
  - `interface VerifyResult { ok: boolean; violations: Violation[] }` — `ok` is true when there are no `error` violations
  - `matchesPrimitive(value: unknown, primitive: string): boolean`
  - `extractErrorCode(body: unknown): string | undefined` — reads `code`, `error.code` or `detail.code`
  - `verifyExchange(contract: ApiContract, exchange: Exchange): VerifyResult`

- [ ] **Step 1: Write the failing tests**

`packages/core/tests/contract-verify.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test packages/core/tests/contract-verify.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|Cannot find" | head -3`
Expected: FAIL — `../src/contract-verify.ts` not found.

- [ ] **Step 3: Implement**

`packages/core/src/contract-verify.ts`:

```ts
import type { ApiContract, ContractType } from './contract.js';

export interface Exchange {
  method: string;
  path: string;
  requestBody?: unknown;
  status: number;
  responseBody?: unknown;
}

export interface Violation {
  where: 'route' | 'request' | 'response' | 'status';
  field?: string;
  kind: 'route' | 'missing' | 'type' | 'unexpected' | 'status' | 'error-code';
  severity: 'error' | 'warning';
  message: string;
}

export interface VerifyResult {
  ok: boolean;
  violations: Violation[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

export function matchesPrimitive(value: unknown, primitive: string): boolean {
  switch (primitive) {
    case 'string':
      return typeof value === 'string';
    case 'uuid':
      return typeof value === 'string' && UUID_RE.test(value);
    case 'email':
      return typeof value === 'string' && EMAIL_RE.test(value);
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'datetime':
      return typeof value === 'string' && DATETIME_RE.test(value);
    case 'date':
      return typeof value === 'string' && DATE_RE.test(value);
    case 'object':
      return isRecord(value);
    case 'any':
      return true;
    default:
      return false;
  }
}

/** The error code of a response body: `code`, `error.code` or `detail.code`. */
export function extractErrorCode(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  if (typeof body.code === 'string') return body.code;
  for (const key of ['error', 'detail']) {
    const inner = body[key];
    if (isRecord(inner) && typeof inner.code === 'string') return inner.code;
  }
  return undefined;
}

type Where = 'request' | 'response';

function checkValue(type: ContractType, value: unknown, where: Where, field: string, out: Violation[]): void {
  if (typeof type !== 'string') {
    checkObject(type, value, where, field, out);
    return;
  }
  const optional = type.endsWith('?');
  const base = optional ? type.slice(0, -1) : type;
  if (value === null && optional) return;
  if (base.endsWith('[]')) {
    const item = base.slice(0, -2);
    if (!Array.isArray(value)) {
      out.push({ where, field, kind: 'type', severity: 'error', message: `${field}: expected an array of ${item}, got ${describe(value)}` });
      return;
    }
    const badIndex = value.findIndex((v) => !matchesPrimitive(v, item));
    if (badIndex >= 0) out.push({ where, field, kind: 'type', severity: 'error', message: `${field}[${badIndex}]: expected ${item}, got ${describe(value[badIndex])}` });
    return;
  }
  if (!matchesPrimitive(value, base)) out.push({ where, field, kind: 'type', severity: 'error', message: `${field}: expected ${base}, got ${describe(value)}` });
}

function checkObject(schema: Record<string, ContractType>, value: unknown, where: Where, prefix: string, out: Violation[]): void {
  if (!isRecord(value)) {
    out.push({ where, field: prefix || undefined, kind: 'type', severity: 'error', message: `${prefix || 'body'}: expected an object, got ${describe(value)}` });
    return;
  }
  for (const [name, type] of Object.entries(schema)) {
    const field = prefix ? `${prefix}.${name}` : name;
    const present = Object.hasOwn(value, name) && value[name] !== undefined;
    if (!present) {
      const optional = typeof type === 'string' && type.endsWith('?');
      if (!optional) out.push({ where, field, kind: 'missing', severity: 'error', message: `${field}: required field is missing` });
      continue;
    }
    checkValue(type, value[name], where, field, out);
  }
  for (const name of Object.keys(value)) {
    if (!Object.hasOwn(schema, name)) {
      const field = prefix ? `${prefix}.${name}` : name;
      out.push({ where, field, kind: 'unexpected', severity: 'warning', message: `${field}: not in the contract` });
    }
  }
}

function routeRegExp(template: string): RegExp {
  const source = template
    .split(/\{[^}]+\}/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]+');
  return new RegExp(`^${source}/?$`);
}

export function verifyExchange(contract: ApiContract, exchange: Exchange): VerifyResult {
  const violations: Violation[] = [];
  const finish = (): VerifyResult => ({ ok: !violations.some((v) => v.severity === 'error'), violations });

  const path = exchange.path.split(/[?#]/)[0];
  if (exchange.method.toUpperCase() !== contract.method || !routeRegExp(contract.path).test(path)) {
    violations.push({ where: 'route', kind: 'route', severity: 'error', message: `expected ${contract.method} ${contract.path}, got ${exchange.method.toUpperCase()} ${path}` });
    return finish();
  }

  if (contract.request) checkObject(contract.request, exchange.requestBody ?? {}, 'request', '', violations);
  if (exchange.requestBody !== undefined && exchange.requestBody !== null && contract.request && !isRecord(exchange.requestBody)) {
    // already reported as a type violation by checkObject
  }

  const status = exchange.status;
  if (status >= 200 && status < 300) {
    if (contract.successStatus !== undefined && status !== contract.successStatus) {
      violations.push({ where: 'status', kind: 'status', severity: 'error', message: `expected status ${contract.successStatus}, got ${status}` });
    }
    checkObject(contract.response, exchange.responseBody, 'response', '', violations);
    return finish();
  }

  const listed = Object.hasOwn(contract.errors, String(status)) ? contract.errors[String(status)] : undefined;
  if (!listed) {
    violations.push({ where: 'status', kind: 'status', severity: 'error', message: `status ${status} is not a declared success or error status` });
    return finish();
  }
  const code = extractErrorCode(exchange.responseBody);
  if (code === undefined) {
    violations.push({ where: 'response', kind: 'error-code', severity: 'error', message: `status ${status}: no error code found in the body (expected one of ${listed.join(', ')})` });
  } else if (!listed.includes(code)) {
    violations.push({ where: 'response', kind: 'error-code', severity: 'error', message: `status ${status}: error code ${code} is not declared (expected one of ${listed.join(', ')})` });
  }
  return finish();
}
```

Implementer note: delete the empty `if (...) { // already reported ... }` block; it documents behavior only and is dead code. `checkObject` already reports a non-object request body.

`packages/core/src/index.ts`: append `export * from './contract-verify.js';`

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test --workspace=packages/core 2>&1 | grep -E "^ℹ (pass|fail)"; npm run typecheck --workspace=packages/core`
Expected: `fail 0`, typecheck clean. If the `odd bodies` test shows a case that should not be `ok:false` (for example `responseBody: []` against a response with only optional fields), that is a test-data mistake: the contract in this file has required fields, so every listed body is invalid.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "core: verify a real HTTP exchange against the API contract"
```

---

### Task 3: Contract verifiers — OpenAPI description and client usage

**Files:**
- Create: `packages/core/src/contract-openapi.ts`, `packages/core/src/contract-usage.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/contract-openapi.test.ts`, `packages/core/tests/contract-usage.test.ts`

**Interfaces:**
- Consumes: `ApiContract`, `ContractType` (Task 1); `Violation`, `VerifyResult` (Task 2); `parse` from `yaml`.
- Produces (`contract-openapi.ts`): `parseOpenApiText(text: string): unknown` (JSON or YAML; throws a clear error), `verifyOpenApi(contract: ApiContract, doc: unknown): VerifyResult`.
- Produces (`contract-usage.ts`): `interface ClientFile { path: string; text: string }`, `interface UsageResult { used: boolean; methodConfirmed: boolean; files: string[]; missingErrorCodes: string[] }`, `verifyClientUsage(contract: ApiContract, files: ClientFile[]): UsageResult`.

Rules: OpenAPI work is bounded (local `$ref` only, at most 10 hops per reference, `allOf` depth ≤ 8, contract nesting ≤ 4), so cycles and dangling refs produce warnings, never hangs. Client usage is a text heuristic and says so: it reports evidence, not proof.

- [ ] **Step 1: Write the failing tests**

`packages/core/tests/contract-openapi.test.ts`:

```ts
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
    ['error:missing:name', 'error:status:409', 'error:type:id', 'error:type:tags']
  );
  const wrongStatus = doc();
  const rs = (wrongStatus.paths['/api/users'].post as { responses: Record<string, unknown> }).responses;
  rs['200'] = rs['201'];
  delete rs['201'];
  assert.ok(kinds(verifyOpenApi(contract, wrongStatus)).includes('error:status:201'));
});

test('softer findings are warnings: missing format, required-in-contract but optional in the description, extra properties', () => {
  const d = doc();
  const schemas = d.components.schemas as Record<string, { properties: Record<string, Record<string, unknown>>; required: string[] }>;
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
  (d.components.schemas as Record<string, { properties: Record<string, unknown> }>).UserOut.properties = JSON.parse('{"__proto__": {"type": "string"}, "id": {"type": "string", "format": "uuid"}}');
  verifyOpenApi(contract, d);
  assert.equal(({} as Record<string, unknown>).type, undefined);
});
```

`packages/core/tests/contract-usage.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test packages/core/tests/contract-openapi.test.ts packages/core/tests/contract-usage.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|Cannot find" | head -4`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`packages/core/src/contract-openapi.ts`:

```ts
import { parse } from 'yaml';
import type { ApiContract, ContractType } from './contract.js';
import type { VerifyResult, Violation } from './contract-verify.js';

type Json = Record<string, unknown>;

const MAX_REF_HOPS = 10;
const MAX_ALLOF_DEPTH = 8;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseOpenApiText(text: string): unknown {
  try {
    return parse(text);
  } catch (error) {
    throw new Error(`the OpenAPI description is not valid JSON or YAML (${(error as Error).message.split('\n')[0]})`);
  }
}

function resolveRef(doc: Json, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  let current: unknown = doc;
  for (const part of ref.slice(2).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isRecord(current) || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

/** Follow local $refs (bounded), returning the first non-$ref object. */
function deref(doc: Json, value: unknown): Json | undefined {
  let current = value;
  for (let hop = 0; hop < MAX_REF_HOPS; hop++) {
    if (!isRecord(current)) return undefined;
    if (typeof current.$ref !== 'string') return current;
    current = resolveRef(doc, current.$ref);
  }
  return undefined;
}

/** Deref, then merge allOf branches into one schema (bounded). */
function flatten(doc: Json, schema: unknown, depth = 0): Json | undefined {
  if (depth > MAX_ALLOF_DEPTH) return undefined;
  const base = deref(doc, schema);
  if (!base) return undefined;
  const properties: Json = Object.create(null);
  const required = new Set<string>();
  const parts = Array.isArray(base.allOf) ? base.allOf.map((s) => flatten(doc, s, depth + 1)).filter((s): s is Json => s !== undefined) : [];
  for (const part of [...parts, base]) {
    if (isRecord(part.properties)) for (const [name, value] of Object.entries(part.properties)) properties[name] = value;
    if (Array.isArray(part.required)) for (const name of part.required) if (typeof name === 'string') required.add(name);
  }
  return { ...base, properties, required: [...required] };
}

/** A nullable `anyOf`/`oneOf` (one real branch plus null) is that branch. */
function unwrap(doc: Json, schema: unknown): Json | undefined {
  const flat = flatten(doc, schema);
  if (!flat) return undefined;
  for (const key of ['anyOf', 'oneOf']) {
    const branches = flat[key];
    if (Array.isArray(branches)) {
      const real = branches.filter((b) => !(isRecord(b) && b.type === 'null'));
      if (real.length === 1) return flatten(doc, real[0]);
    }
  }
  return flat;
}

const push = (out: Violation[], where: 'request' | 'response', kind: Violation['kind'], severity: Violation['severity'], field: string | undefined, message: string) =>
  out.push({ where, kind, severity, field, message });

function typeCheck(doc: Json, type: ContractType, schema: unknown, where: 'request' | 'response', field: string, out: Violation[]): void {
  const s = unwrap(doc, schema);
  if (!s) {
    push(out, where, 'type', 'warning', field, `${field}: the schema could not be resolved`);
    return;
  }
  if (typeof type !== 'string') {
    if (s.type !== 'object' && !isRecord(s.properties)) push(out, where, 'type', 'error', field, `${field}: expected an object schema`);
    else compareFields(doc, type, s, where, field, out);
    return;
  }
  const base = type.endsWith('?') ? type.slice(0, -1) : type;
  if (base.endsWith('[]')) {
    if (s.type !== 'array') push(out, where, 'type', 'error', field, `${field}: expected an array schema`);
    else typeCheck(doc, base.slice(0, -2), s.items, where, `${field}[]`, out);
    return;
  }
  const format = typeof s.format === 'string' ? s.format : undefined;
  const expect = (ok: boolean, what: string) => {
    if (!ok) push(out, where, 'type', 'error', field, `${field}: expected ${what}, the description says ${String(s.type ?? 'nothing')}`);
  };
  const wantFormat = (want: string) => {
    if (format === undefined) push(out, where, 'type', 'warning', field, `${field}: the description has no format "${want}"`);
    else if (format !== want) push(out, where, 'type', 'error', field, `${field}: format is "${format}", expected "${want}"`);
  };
  switch (base) {
    case 'string':
      return expect(s.type === 'string', 'a string');
    case 'uuid':
      expect(s.type === 'string', 'a string');
      return s.type === 'string' ? wantFormat('uuid') : undefined;
    case 'email':
      expect(s.type === 'string', 'a string');
      return s.type === 'string' ? wantFormat('email') : undefined;
    case 'datetime':
      expect(s.type === 'string', 'a string');
      return s.type === 'string' ? wantFormat('date-time') : undefined;
    case 'date':
      expect(s.type === 'string', 'a string');
      return s.type === 'string' ? wantFormat('date') : undefined;
    case 'integer':
      return expect(s.type === 'integer', 'an integer');
    case 'number':
      return expect(s.type === 'number' || s.type === 'integer', 'a number');
    case 'boolean':
      return expect(s.type === 'boolean', 'a boolean');
    case 'object':
      return expect(s.type === 'object' || isRecord(s.properties), 'an object');
    default:
      return; // any
  }
}

function compareFields(doc: Json, fields: Record<string, ContractType>, schema: Json, where: 'request' | 'response', prefix: string, out: Violation[]): void {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  for (const [name, type] of Object.entries(fields)) {
    const field = prefix ? `${prefix}.${name}` : name;
    if (!Object.hasOwn(properties, name)) {
      push(out, where, 'missing', 'error', field, `${field}: not described in the OpenAPI schema`);
      continue;
    }
    typeCheck(doc, type, properties[name], where, field, out);
    const contractRequired = !(typeof type === 'string' && type.endsWith('?'));
    if (contractRequired && !required.has(name)) push(out, where, 'missing', 'warning', field, `${field}: required in the contract but optional in the description`);
  }
  for (const name of Object.keys(properties)) {
    if (!Object.hasOwn(fields, name)) push(out, where, 'unexpected', 'warning', prefix ? `${prefix}.${name}` : name, `${prefix ? `${prefix}.` : ''}${name}: described but not in the contract`);
  }
}

const normalize = (path: string): string => path.replace(/\{[^}]+\}/g, '{}').replace(/\/+$/, '') || '/';

function jsonSchemaOf(doc: Json, holder: unknown): unknown {
  const content = deref(doc, holder)?.content;
  if (!isRecord(content)) return undefined;
  const key = Object.keys(content).find((k) => k === 'application/json') ?? Object.keys(content).find((k) => k.includes('json'));
  return key && isRecord(content[key]) ? (content[key] as Json).schema : undefined;
}

export function verifyOpenApi(contract: ApiContract, doc: unknown): VerifyResult {
  const violations: Violation[] = [];
  const finish = (): VerifyResult => ({ ok: !violations.some((v) => v.severity === 'error'), violations });
  const routeError = (message: string): VerifyResult => {
    violations.push({ where: 'route', kind: 'route', severity: 'error', message });
    return finish();
  };
  if (!isRecord(doc) || !isRecord(doc.paths)) return routeError('not an OpenAPI document (no "paths")');

  const wanted = normalize(contract.path);
  const key = Object.keys(doc.paths).find((p) => normalize(p) === wanted);
  const item = key === undefined ? undefined : doc.paths[key];
  const op = isRecord(item) && isRecord(item[contract.method.toLowerCase()]) ? (item[contract.method.toLowerCase()] as Json) : undefined;
  if (!op) return routeError(`${contract.method} ${contract.path} is not described`);

  if (contract.request) {
    const schema = jsonSchemaOf(doc, op.requestBody);
    if (schema === undefined) push(violations, 'request', 'missing', 'error', undefined, 'the operation describes no JSON request body');
    else {
      const flat = flatten(doc, schema);
      if (flat) compareFields(doc, contract.request, flat, 'request', '', violations);
      else push(violations, 'request', 'type', 'warning', undefined, 'the request schema could not be resolved');
    }
  }

  const responses = isRecord(op.responses) ? op.responses : {};
  const successKey = contract.successStatus !== undefined ? String(contract.successStatus) : Object.keys(responses).find((k) => /^2\d\d$/.test(k));
  if (successKey === undefined || !Object.hasOwn(responses, successKey)) {
    violations.push({ where: 'status', kind: 'status', severity: 'error', message: `no ${contract.successStatus ?? '2xx'} response is described` });
  } else {
    const schema = jsonSchemaOf(doc, responses[successKey]);
    if (schema === undefined) {
      if (Object.keys(contract.response).length > 0) push(violations, 'response', 'missing', 'error', undefined, `the ${successKey} response describes no JSON body`);
    } else {
      const flat = flatten(doc, schema);
      if (flat) compareFields(doc, contract.response, flat, 'response', '', violations);
      else push(violations, 'response', 'type', 'warning', undefined, 'the response schema could not be resolved');
    }
  }

  for (const status of Object.keys(contract.errors)) {
    if (!Object.hasOwn(responses, status) && !Object.hasOwn(responses, 'default')) {
      violations.push({ where: 'status', kind: 'status', severity: 'error', message: `error status ${status} is declared in the contract but not described` });
    }
  }
  return finish();
}
```

`packages/core/src/contract-usage.ts`:

```ts
import type { ApiContract } from './contract.js';

export interface ClientFile {
  path: string;
  text: string;
}

export interface UsageResult {
  used: boolean;
  methodConfirmed: boolean;
  files: string[];
  missingErrorCodes: string[];
}

const WINDOW = 300;
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches the contract path in client source: literal, template (`${id}`), `:id` or `{id}` segments, or `'/x/' + id`. */
function pathRegExp(path: string): RegExp {
  const parts = path.split(/\{[^}]+\}/);
  const body = parts.map(escape).join('(?:\\$\\{[^}]*\\}|:[A-Za-z_]\\w*|\\{[^}]*\\}|[\'"`]\\s*\\+[^\'"`]*)');
  const tail = path.endsWith('}') ? '' : '(?![A-Za-z0-9_-])';
  return new RegExp(`${body}${tail}`, 'g');
}

function confirms(method: string, near: string): boolean {
  const explicit = near.match(/method\s*:\s*['"`]([A-Za-z]+)['"`]/);
  if (explicit) return explicit[1].toUpperCase() === method;
  const lower = method.toLowerCase();
  if (new RegExp(`\\.${lower}\\s*(?:<[^>(]*>)?\\(`).test(near)) return true;
  return method === 'GET' && /\bfetch\s*\(/.test(near);
}

/** Text evidence that a client calls the contract's route, with its method, and mentions its error codes. */
export function verifyClientUsage(contract: ApiContract, files: ClientFile[]): UsageResult {
  const pathRe = pathRegExp(contract.path);
  const usedIn: string[] = [];
  let methodConfirmed = false;
  for (const file of files) {
    let hit = false;
    for (const match of file.text.matchAll(pathRe)) {
      hit = true;
      const start = Math.max(0, (match.index ?? 0) - 80);
      if (confirms(contract.method, file.text.slice(start, (match.index ?? 0) + WINDOW))) methodConfirmed = true;
    }
    if (hit) usedIn.push(file.path);
  }
  const allText = files.map((f) => f.text).join('\n');
  const codes = Object.values(contract.errors).flat();
  return { used: usedIn.length > 0, methodConfirmed, files: usedIn, missingErrorCodes: [...new Set(codes)].filter((code) => !allText.includes(code)).sort() };
}
```

Implementer notes: (1) in the client-usage test "fully confirmed", `missingErrorCodes` is computed over **all** supplied files (the codes are handled in a different file than the call), so both files are searched, while `files` lists only those that call the path. (2) The regular expression for `/api/usersettings` must not match `/api/users`: the negative lookahead `(?![A-Za-z0-9_-])` on paths that do not end in a parameter enforces it.

`packages/core/src/index.ts`: append `export * from './contract-openapi.js';` and `export * from './contract-usage.js';`

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test --workspace=packages/core 2>&1 | grep -E "^ℹ (pass|fail)"; npm run typecheck --workspace=packages/core`
Expected: `fail 0`, typecheck clean. If a warning/error classification in the OpenAPI test disagrees with your reading of the plan's intent (for example the `required-in-contract but optional` case), the rule is: unresolved or softer-than-contract findings are `warning`; a missing property, a wrong type, a wrong format value, a missing route or an undeclared error status are `error`.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "core: verify the API contract against an OpenAPI description and against client source"
```

---

### Task 4: The `dev-agent` CLI — router, install/verify aliases, `inspect`, `context audit`

**Files:**
- Create: `packages/cli/src/dev-cli.ts`, `packages/cli/src/dev-index.ts`, `packages/cli/bin/dev-agent.mjs`
- Modify: `packages/cli/package.json` (add the `dev-agent` bin), root `package.json` (script `dev-agent`)
- Test: `packages/cli/tests/dev-cli.test.ts`

**Interfaces:**
- Consumes: `run`, `CliIo` (existing `cli.ts`); `detectProjectProfile`, `selectBackendReferences`, `auditContext` (core); `readKitVersion` (existing `util.ts`).
- Produces (`dev-cli.ts`):
  - `runDev(argv: string[], io: CliIo): Promise<number>` — the whole `dev-agent` command surface
  - `class CliError extends Error { constructor(message: string, readonly code = 1) }`
  - `projectRootOf(values: { project?: string }, io: CliIo): string` (exported for the command modules in later tasks)
  - `DEV_HELP: string`

The router dispatches by first word. `install` and `verify` delegate to the existing `run(argv, io)` unchanged, so behavior and output are identical to `frontend-agent`. Later tasks add `sources`, `task` and `contract` to the same `switch`.

- [ ] **Step 1: Write the failing tests**

`packages/cli/tests/dev-cli.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run, type CliIo } from '../src/cli.ts';
import { runDev } from '../src/dev-cli.ts';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));

export function setup(files: Record<string, string> = {}) {
  const base = mkdtempSync(join(tmpdir(), 'dev-agent-cli-'));
  const projectRoot = join(base, 'project');
  const homeDir = join(base, 'home');
  mkdirSync(projectRoot);
  mkdirSync(homeDir);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(projectRoot, rel)), { recursive: true });
    writeFileSync(join(projectRoot, rel), content);
  }
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => err.push(l), env: { PATH: '', CODEX_HOME: join(base, 'codex-home') }, cwd: projectRoot, homeDir };
  return { base, projectRoot, io, out, err, text: () => out.join('\n'), cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test('--help lists the commands and exits 0; no arguments exits 1; --version prints the kit version', async () => {
  const t = setup();
  try {
    assert.equal(await runDev(['--help'], t.io), 0);
    for (const word of ['install', 'verify', 'inspect', 'context audit', 'sources', 'task resolve', 'contract verify']) assert.match(t.text(), new RegExp(word), word);
    t.out.length = 0;
    assert.equal(await runDev([], t.io), 1);
    t.out.length = 0;
    assert.equal(await runDev(['--version'], t.io), 0);
    assert.match(t.text(), /^\d+\.\d+\.\d+$/);
  } finally {
    t.cleanup();
  }
});

test('an unknown command or subcommand is a usage error', async () => {
  const t = setup();
  try {
    assert.equal(await runDev(['nope'], t.io), 1);
    assert.match(t.err.join('\n'), /unknown command "nope"/);
    assert.equal(await runDev(['context', 'nope'], t.io), 1);
    assert.equal(await runDev(['inspect', '--project', join(t.base, 'missing')], t.io), 1);
    assert.match(t.err.join('\n'), /does not exist/);
  } finally {
    t.cleanup();
  }
});

test('install and verify are aliases: dev-agent produces exactly what frontend-agent produces', async () => {
  const a = setup();
  const b = setup();
  try {
    assert.equal(await runDev(['install', 'claude', '--project', a.projectRoot], a.io), 0);
    assert.equal(await run(['install', 'claude', '--project', b.projectRoot], b.io), 0);
    const strip = (lines: string[], root: string) => lines.map((l) => l.replaceAll(root, '<project>'));
    assert.deepEqual(strip(a.out, a.projectRoot), strip(b.out, b.projectRoot));
    assert.ok(existsSync(join(a.projectRoot, '.claude', 'skills', 'task-orchestrator', 'SKILL.md')));
    a.out.length = 0;
    assert.equal(await runDev(['verify', 'claude', '--project', a.projectRoot], a.io), 0);
    assert.match(a.text(), /ok/);
  } finally {
    a.cleanup();
    b.cleanup();
  }
});

test('inspect prints the detected profile and the backend references that apply', async () => {
  const t = setup({
    'pyproject.toml': '[project]\ndependencies = ["fastapi", "psycopg2-binary", "celery"]\n[tool.pytest]\n',
    'docker-compose.yml': 'services:\n  db:\n    image: postgres:16\n'
  });
  try {
    assert.equal(await runDev(['inspect', '--project', t.projectRoot], t.io), 0);
    assert.match(t.text(), /languages: python/);
    assert.match(t.text(), /frameworks: fastapi/);
    assert.match(t.text(), /database: postgresql/);
    assert.match(t.text(), /backend-architecture\/fastapi/);
    assert.match(t.text(), /data-modeling\/postgresql/);
    t.out.length = 0;
    assert.equal(await runDev(['inspect', '--project', t.projectRoot, '--json'], t.io), 0);
    const json = JSON.parse(t.text());
    assert.deepEqual(json.profile.frameworks, ['fastapi']);
    assert.ok(json.backendReferences.some((r: { reference: string }) => r.reference === 'fastapi'));
  } finally {
    t.cleanup();
  }
});

test('inspect on a project with no backend signal recommends nothing', async () => {
  const t = setup({ 'package.json': JSON.stringify({ dependencies: { react: '^18' } }) });
  try {
    assert.equal(await runDev(['inspect', '--project', t.projectRoot, '--json'], t.io), 0);
    assert.deepEqual(JSON.parse(t.text()).backendReferences, []);
  } finally {
    t.cleanup();
  }
});

test('context audit reports always-on size and findings, as text or JSON', async () => {
  const t = setup({ 'CLAUDE.md': '# Rules\n' + 'Always run the linter before committing code changes.\n'.repeat(400) });
  try {
    assert.equal(await runDev(['context', 'audit', '--project', t.projectRoot], t.io), 0);
    assert.match(t.text(), /always-on: ~\d+ tokens/);
    assert.match(t.text(), /large-instruction-file/);
    t.out.length = 0;
    assert.equal(await runDev(['context', 'audit', '--project', t.projectRoot, '--json'], t.io), 0);
    assert.ok(JSON.parse(t.text()).alwaysOnTokens > 1500);
  } finally {
    t.cleanup();
  }
});

test('the dev-agent binary runs through tsx from any directory', () => {
  const result = spawnSync(process.execPath, [join(packageRoot, 'bin', 'dev-agent.mjs'), '--version'], { encoding: 'utf8', cwd: tmpdir() });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test packages/cli/tests/dev-cli.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|Cannot find" | head -3`
Expected: FAIL — `../src/dev-cli.ts` not found.

- [ ] **Step 3: Implement**

`packages/cli/src/dev-cli.ts`:

```ts
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { auditContext, detectProjectProfile, selectBackendReferences } from '../../core/src/index.js';
import { run, type CliIo } from './cli.js';
import { readKitVersion } from './util.js';

export class CliError extends Error {
  constructor(
    message: string,
    readonly code = 1
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export const DEV_HELP = `dev-agent — deterministic helpers for the Dev Agent Kit

Usage:
  dev-agent install [claude|codex ...] [--all] [--project <dir>] [--force] [--no-figma]
  dev-agent verify  [claude|codex ...] [--all] [--project <dir>]
  dev-agent inspect [--project <dir>] [--json]
  dev-agent context audit [--project <dir>] [--json]
  dev-agent sources [--project <dir>] [--json]
  dev-agent sources verify [--project <dir>] [--json]
  dev-agent task resolve <identifier> [--source <id>] [--probe] [--project <dir>] [--json]
  dev-agent task status <KEY> [--project <dir>] [--json]
  dev-agent task show <KEY> [--project <dir>]
  dev-agent contract show <KEY> [--project <dir>]
  dev-agent contract verify <KEY> [--exchange <file> ...] [--openapi <file>] [--project <dir>] [--json]
  dev-agent contract usage <KEY> --client <dir> [--client <dir> ...] [--strict] [--project <dir>] [--json]
  dev-agent --help | --version

install and verify are aliases of the frontend-agent commands.
Exit codes: 0 ok, 1 usage or environment error, 2 checked and not OK.`;

export function projectRootOf(values: { project?: string }, io: CliIo): string {
  const resolved = path.resolve(io.cwd, values.project ?? '.');
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) throw new CliError(`dev-agent: project directory "${resolved}" does not exist.`);
  return realpathSync(resolved);
}

const PROJECT_JSON = { project: { type: 'string' }, json: { type: 'boolean', default: false } } as const;

function inspect(args: string[], io: CliIo): number {
  const { values } = parseArgs({ args, options: PROJECT_JSON });
  const root = projectRootOf(values, io);
  const profile = detectProjectProfile(root);
  const references = selectBackendReferences(profile);
  if (values.json) {
    io.stdout(JSON.stringify({ profile, backendReferences: references }, null, 2));
    return 0;
  }
  const list = (items: string[] | undefined): string => (items && items.length > 0 ? items.join(', ') : '-');
  io.stdout(`languages: ${list(profile.languages)}`);
  io.stdout(`frameworks: ${list(profile.frameworks)}`);
  io.stdout(`package manager: ${profile.packageManager ?? '-'}`);
  io.stdout(`test: ${list(profile.testCommands)}`);
  io.stdout(`lint: ${list(profile.lintCommands)}`);
  io.stdout(`typecheck: ${list(profile.typecheckCommands)}`);
  io.stdout(`database: ${profile.database ?? '-'}`);
  io.stdout(`migration tool: ${profile.migrationTool ?? '-'}`);
  io.stdout(`queues: ${list(profile.queues)}`);
  io.stdout(`cache: ${profile.cache ?? '-'}`);
  io.stdout(`docker: ${profile.docker ? 'yes' : 'no'}`);
  io.stdout(`base branch: ${profile.baseBranch ?? '-'}`);
  io.stdout(`backend references: ${references.length === 0 ? '-' : references.map((r) => `${r.skill}/${r.reference}`).join(', ')}`);
  return 0;
}

function contextAudit(args: string[], io: CliIo): number {
  const { values } = parseArgs({ args, options: PROJECT_JSON });
  const report = auditContext(projectRootOf(values, io));
  if (values.json) {
    io.stdout(JSON.stringify(report, null, 2));
    return 0;
  }
  io.stdout(`always-on: ~${report.alwaysOnTokens} tokens`);
  io.stdout(`removable (upper bound): ~${report.removableTokens} tokens`);
  for (const f of report.findings) io.stdout(`- [${f.kind}] ${f.path}: ${f.detail} (~${f.removableTokens} tokens)`);
  return 0;
}

export async function runDev(argv: string[], io: CliIo): Promise<number> {
  try {
    const [command, ...rest] = argv;
    if (command === '--version') {
      io.stdout(readKitVersion());
      return 0;
    }
    if (command === undefined || command === '--help' || command === '-h') {
      io.stdout(DEV_HELP);
      return command === undefined ? 1 : 0;
    }
    switch (command) {
      case 'install':
      case 'verify':
        return await run(argv, io);
      case 'inspect':
        return inspect(rest, io);
      case 'context':
        if (rest[0] === 'audit') return contextAudit(rest.slice(1), io);
        throw new CliError(`dev-agent: unknown context command "${rest[0] ?? ''}" — see --help.`);
      default:
        throw new CliError(`dev-agent: unknown command "${command}" — see --help.`);
    }
  } catch (error) {
    io.stderr((error as Error).message);
    return error instanceof CliError ? error.code : 1;
  }
}
```

`packages/cli/src/dev-index.ts`:

```ts
import { homedir } from 'node:os';
import { runDev } from './dev-cli.js';

process.exitCode = await runDev(process.argv.slice(2), {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  env: process.env,
  cwd: process.env.INIT_CWD ?? process.cwd(),
  homeDir: homedir()
});
```

`packages/cli/bin/dev-agent.mjs`:

```js
#!/usr/bin/env node
// Runs the TypeScript dev-agent CLI through tsx, resolved relative to this file (works from any cwd).
import { register } from 'tsx/esm/api';

register();
await import('../src/dev-index.ts');
```

`packages/cli/package.json`: in `bin` add `"dev-agent": "bin/dev-agent.mjs"` (keep the two existing entries). Root `package.json` scripts: add `"dev-agent": "node packages/cli/bin/dev-agent.mjs"`. Make the new bin executable (`chmod +x packages/cli/bin/dev-agent.mjs`, matching the existing one).

Note: the `--help` (`-h`) and `--version` paths are handled before `run` so `dev-agent install --help` still reaches the existing `frontend-agent` help via delegation.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test --workspace=packages/cli 2>&1 | grep -E "^ℹ (pass|fail)"; npm run typecheck --workspace=packages/cli`
Expected: `fail 0`, typecheck clean, and the existing `cli.test.ts`, `claude-adapter.test.ts` etc. still pass (nothing in `cli.ts` changed).

- [ ] **Step 5: Commit**

```bash
git add packages/cli package.json
git commit -m "cli: the dev-agent binary with install/verify aliases, inspect and context audit"
```

---

### Task 5: CLI — `sources`, `sources verify` and `task resolve|status|show`

**Files:**
- Create: `packages/cli/src/dev-task-commands.ts`
- Modify: `packages/cli/src/dev-cli.ts` (add the `sources` and `task` cases)
- Test: `packages/cli/tests/dev-task-commands.test.ts`

**Interfaces:**
- Consumes: `loadDevAgentConfig`, `parseDevAgentConfig`, `routeOf`, `resolveSource`, `createGenericMcpAdapter`, `checkResume`, `readLedger`, `readTaskState` (core); `projectRootOf`, `CliError` (Task 4).
- Produces (`dev-task-commands.ts`): `sourcesList(args, io): number`, `sourcesVerify(args, io): number`, `taskResolve(args, io): number`, `taskStatus(args, io): number`, `taskShow(args, io): number`.

Behavior:
- `sources`: table of configured sources (`id`, adapter, `default` marker, server, identifier patterns). None configured → `no task sources configured`, exit 0. A config that does not parse → stderr message, exit 1.
- `sources verify`: reads `.dev-agent/config.yml` itself so a parse failure is a **finding**, not a crash. Prints `✔`/`✘` lines and exits 0 when there are no errors, 2 otherwise. Checks: config parses; each `generic-mcp` source constructs an adapter (its capabilities are listed); an adapter other than `generic-mcp` is a **warning** (custom adapter loading is not available in this version); two sources sharing an identical identifier pattern are a **warning** (they would be ambiguous); no default source and a source with no identifiers is a **warning** (reachable only with `--source`).
- `task resolve <identifier>`: prints `resolved: <id> (via <how>)`, `ambiguous: a, b`, `unknown-source: <id> (known: …)`, `probe: a, b` or `unresolved: <reason>`. Exit 0 for resolved and probe, 2 for the others. `--source` sets the explicit source; `--probe` enables the bounded probe.
- `task status <KEY>`: `checkResume` on the current repository; prints phase, branch, base, source configured, stale knowledge; exit 0 when ok, 2 with the reasons when the repository no longer matches the state.
- `task show <KEY>`: prints the ledger Markdown verbatim; missing → stderr and exit 1. An invalid key → exit 1 (never a path).

- [ ] **Step 1: Write the failing tests**

`packages/cli/tests/dev-task-commands.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runDev } from '../src/dev-cli.ts';
import { ingestWorkItem, recordCheckpoint } from '../../core/src/index.ts';
import { setup } from './dev-cli.test.ts';

const CONFIG = String.raw`
taskSources:
  company:
    adapter: generic-mcp
    server: company-tasks
    default: true
    identifiers:
      - '^HEF-\d+$'
    tools:
      get: { name: get_issue }
      comments: { name: get_comments }
    mapping: { key: key, title: summary }
  personal:
    adapter: generic-mcp
    server: my-notes
    identifiers:
      - '^ME-\d+$'
    tools:
      get: { name: read_ticket }
    mapping: { key: reference, title: subject }
`;
const cfg = (yaml: string) => ({ '.dev-agent/config.yml': yaml });

test('sources lists each configured source, and says so when there are none', async () => {
  const t = setup(cfg(CONFIG));
  const none = setup();
  try {
    assert.equal(await runDev(['sources', '--project', t.projectRoot], t.io), 0);
    assert.match(t.text(), /company\s+generic-mcp\s+default\s+company-tasks\s+\^HEF-\\d\+\$/);
    assert.match(t.text(), /personal\s+generic-mcp\s+-\s+my-notes/);
    t.out.length = 0;
    assert.equal(await runDev(['sources', '--project', t.projectRoot, '--json'], t.io), 0);
    assert.deepEqual(JSON.parse(t.text()).map((s: { id: string }) => s.id), ['company', 'personal']);
    assert.equal(await runDev(['sources', '--project', none.projectRoot], none.io), 0);
    assert.match(none.text(), /no task sources configured/);
  } finally {
    t.cleanup();
    none.cleanup();
  }
});

test('sources exits 1 on a config that does not parse', async () => {
  const t = setup(cfg('taskSources: {A: {adapter: generic-mcp}}'));
  try {
    assert.equal(await runDev(['sources', '--project', t.projectRoot], t.io), 1);
    assert.match(t.err.join('\n'), /taskSources\.A/);
  } finally {
    t.cleanup();
  }
});

test('sources verify passes a good config and lists capabilities', async () => {
  const t = setup(cfg(CONFIG));
  try {
    assert.equal(await runDev(['sources', 'verify', '--project', t.projectRoot], t.io), 0);
    assert.match(t.text(), /✔ config parses/);
    assert.match(t.text(), /✔ company: generic-mcp adapter builds \(comments\)/);
    assert.match(t.text(), /✔ personal: generic-mcp adapter builds/);
  } finally {
    t.cleanup();
  }
});

test('sources verify reports a broken config as a finding, and warns about ambiguity risks and unsupported adapters', async () => {
  const broken = setup(cfg('git:\n  requireCleanTree: false'));
  const risky = setup(
    cfg(String.raw`
taskSources:
  a:
    adapter: generic-mcp
    server: s1
    identifiers: ['^X-\d+$']
    tools: { get: { name: g } }
    mapping: { key: k, title: t }
  b:
    adapter: generic-mcp
    server: s2
    identifiers: ['^X-\d+$']
    tools: { get: { name: g } }
    mapping: { key: k, title: t }
  c:
    adapter: custom-thing
`)
  );
  try {
    assert.equal(await runDev(['sources', 'verify', '--project', broken.projectRoot], broken.io), 2);
    assert.match(broken.text(), /✘ config: .*requireCleanTree/);
    assert.equal(await runDev(['sources', 'verify', '--project', risky.projectRoot], risky.io), 0);
    assert.match(risky.text(), /! a and b share the identifier pattern \^X-\\d\+\$/);
    assert.match(risky.text(), /! c: adapter "custom-thing" cannot be loaded in this version/);
    assert.match(risky.text(), /! no default source/);
  } finally {
    broken.cleanup();
    risky.cleanup();
  }
});

test('task resolve reports each resolution outcome with the right exit code', async () => {
  const t = setup(cfg(CONFIG));
  const two = setup(cfg(String.raw`
taskSources:
  a: { adapter: generic-mcp, server: s1, identifiers: ['^X-\d+$'], tools: { get: { name: g } }, mapping: { key: k, title: t } }
  b: { adapter: generic-mcp, server: s2, identifiers: ['^X-\d+$'], tools: { get: { name: g } }, mapping: { key: k, title: t } }
`));
  try {
    const resolve = async (project: string, io: typeof t.io, out: string[], ...args: string[]) => {
      out.length = 0;
      const code = await runDev(['task', 'resolve', ...args, '--project', project], io);
      return { code, text: out.join('\n') };
    };
    assert.deepEqual(await resolve(t.projectRoot, t.io, t.out, 'ME-3'), { code: 0, text: 'resolved: personal (via pattern)' });
    assert.deepEqual(await resolve(t.projectRoot, t.io, t.out, '12345'), { code: 0, text: 'resolved: company (via default)' });
    assert.deepEqual(await resolve(t.projectRoot, t.io, t.out, 'HEF-1', '--source', 'personal'), { code: 0, text: 'resolved: personal (via explicit)' });
    assert.deepEqual(await resolve(t.projectRoot, t.io, t.out, 'HEF-1', '--source', 'nope'), { code: 2, text: 'unknown-source: nope (known: company, personal)' });
    assert.deepEqual(await resolve(two.projectRoot, two.io, two.out, 'X-1'), { code: 2, text: 'ambiguous: a, b' });
    const none = setup();
    try {
      assert.deepEqual(await resolve(none.projectRoot, none.io, none.out, 'X-1'), { code: 2, text: 'unresolved: no task sources are configured' });
    } finally {
      none.cleanup();
    }
    t.out.length = 0;
    assert.equal(await runDev(['task', 'resolve', 'ME-3', '--json', '--project', t.projectRoot], t.io), 0);
    assert.deepEqual(JSON.parse(t.text()), { status: 'resolved', source: 'personal', via: 'pattern' });
    assert.equal(await runDev(['task', 'resolve', '--project', t.projectRoot], t.io), 1);
  } finally {
    t.cleanup();
    two.cleanup();
  }
});

const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function taskProject() {
  const t = setup(cfg(CONFIG));
  git(t.projectRoot, 'init', '-q', '-b', 'main');
  git(t.projectRoot, 'config', 'user.email', 't@example.com');
  git(t.projectRoot, 'config', 'user.name', 'T');
  git(t.projectRoot, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(t.projectRoot, 'a.txt'), 'x');
  git(t.projectRoot, 'add', '-A');
  git(t.projectRoot, 'commit', '-q', '-m', 'init');
  const base = git(t.projectRoot, 'rev-parse', '--short=12', 'HEAD');
  const dirs = { taskDocsDir: '.dev-agent/tasks', stateDir: '.dev-agent/state' };
  const item = { source: 'company', id: '1', key: 'HEF-1', title: 'Card', description: 'Show it.', acceptanceCriteria: [], comments: [], attachments: [], links: [] };
  ingestWorkItem(t.projectRoot, dirs, item, { now: '2026-09-24T14:00:00Z' });
  git(t.projectRoot, 'switch', '-q', '-c', 'feat/hef-1-card');
  recordCheckpoint(t.projectRoot, dirs, 'HEF-1', { phase: 'implementation', state: { baseBranch: 'main', baseSha: base, workingBranch: 'feat/hef-1-card' } }, '2026-09-24T15:00:00Z');
  return t;
}

test('task status is 0 for a consistent task and 2 with reasons after the branch changed', async () => {
  const t = taskProject();
  try {
    assert.equal(await runDev(['task', 'status', 'HEF-1', '--project', t.projectRoot], t.io), 0);
    assert.match(t.text(), /phase: implementation/);
    assert.match(t.text(), /branch: feat\/hef-1-card/);
    assert.match(t.text(), /source configured: yes/);
    git(t.projectRoot, 'switch', '-q', 'main');
    t.out.length = 0;
    assert.equal(await runDev(['task', 'status', 'HEF-1', '--project', t.projectRoot], t.io), 2);
    assert.match(t.text(), /reconcile/i);
    assert.match(t.text(), /on branch "main"/);
    t.out.length = 0;
    assert.equal(await runDev(['task', 'status', 'NOPE-1', '--project', t.projectRoot, '--json'], t.io), 2);
    assert.equal(JSON.parse(t.text()).ok, false);
    assert.equal(await runDev(['task', 'status', '../../x', '--project', t.projectRoot], t.io), 1);
  } finally {
    t.cleanup();
  }
});

test('task show prints the ledger, and a missing or invalid key is an error', async () => {
  const t = taskProject();
  try {
    assert.equal(await runDev(['task', 'show', 'HEF-1', '--project', t.projectRoot], t.io), 0);
    assert.match(t.text(), /^# HEF-1 - Card/);
    assert.match(t.text(), /## Final status\nimplementing/);
    assert.equal(await runDev(['task', 'show', 'NOPE-1', '--project', t.projectRoot], t.io), 1);
    assert.match(t.err.join('\n'), /no ledger for NOPE-1/);
    assert.equal(await runDev(['task', 'show', '../../etc/passwd', '--project', t.projectRoot], t.io), 1);
  } finally {
    t.cleanup();
  }
});
```

(`setup` is exported from `dev-cli.test.ts`; importing a test file runs its tests once more under `node --test`, so if that double run is a problem move `setup` into `packages/cli/tests/dev-helpers.ts` and import it from both files.)

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test packages/cli/tests/dev-task-commands.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|Cannot find" | head -3`
Expected: FAIL — `sources`/`task` are unknown commands.

- [ ] **Step 3: Implement**

`packages/cli/src/dev-task-commands.ts`:

```ts
import { parseArgs } from 'node:util';
import {
  CONFIG_FILE,
  checkResume,
  createGenericMcpAdapter,
  loadDevAgentConfig,
  parseDevAgentConfig,
  readLedger,
  resolveSource,
  routeOf,
  safeReadFile,
  type TaskSourceConfig
} from '../../core/src/index.js';
import type { CliIo } from './cli.js';
import { CliError, projectRootOf } from './dev-cli.js';

const PROJECT_JSON = { project: { type: 'string' }, json: { type: 'boolean', default: false } } as const;

function loadConfig(root: string) {
  try {
    return loadDevAgentConfig(root);
  } catch (error) {
    throw new CliError((error as Error).message, 1);
  }
}

const patterns = (s: TaskSourceConfig): string => (s.identifiers.length > 0 ? s.identifiers.map((r) => r.source).join(' ') : '-');

export function sourcesList(args: string[], io: CliIo): number {
  const { values } = parseArgs({ args, options: PROJECT_JSON });
  const config = loadConfig(projectRootOf(values, io));
  if (values.json) {
    io.stdout(JSON.stringify(config.taskSources.map((s) => ({ id: s.id, adapter: s.adapter, default: s.default, server: s.server ?? null, identifiers: s.identifiers.map((r) => r.source) })), null, 2));
    return 0;
  }
  if (config.taskSources.length === 0) {
    io.stdout('no task sources configured');
    return 0;
  }
  for (const s of config.taskSources) io.stdout(`${s.id.padEnd(14)}${s.adapter.padEnd(13)}${(s.default ? 'default' : '-').padEnd(9)}${(s.server ?? '-').padEnd(16)}${patterns(s)}`);
  return 0;
}

export function sourcesVerify(args: string[], io: CliIo): number {
  const { values } = parseArgs({ args, options: PROJECT_JSON });
  const root = projectRootOf(values, io);
  const findings: Array<{ level: 'ok' | 'warn' | 'error'; message: string }> = [];
  const add = (level: 'ok' | 'warn' | 'error', message: string) => findings.push({ level, message });

  let config;
  try {
    const text = safeReadFile(root, CONFIG_FILE);
    config = text === null ? loadDevAgentConfig(root) : parseDevAgentConfig(text);
    add('ok', 'config parses');
  } catch (error) {
    add('error', `config: ${(error as Error).message}`);
  }
  if (config) {
    const seen = new Map<string, string>();
    for (const s of config.taskSources) {
      if (s.adapter === 'generic-mcp') {
        try {
          const caps = createGenericMcpAdapter(s, async () => undefined).capabilities();
          const on = (['search', 'comments', 'attachments', 'links'] as const).filter((k) => caps[k]);
          add('ok', `${s.id}: generic-mcp adapter builds${on.length > 0 ? ` (${on.join(', ')})` : ''}`);
        } catch (error) {
          add('error', `${s.id}: ${(error as Error).message}`);
        }
      } else {
        add('warn', `${s.id}: adapter "${s.adapter}" cannot be loaded in this version`);
      }
      for (const re of s.identifiers) {
        const other = seen.get(re.source);
        if (other) add('warn', `${other} and ${s.id} share the identifier pattern ${re.source}: identifiers matching it would be ambiguous`);
        else seen.set(re.source, s.id);
      }
    }
    if (config.taskSources.length > 0 && !config.taskSources.some((s) => s.default)) {
      add('warn', 'no default source: an identifier that matches no pattern is unresolved');
      for (const s of config.taskSources) if (s.identifiers.length === 0) add('warn', `${s.id}: no identifiers and not the default, so it is reachable only with an explicit source`);
    }
  }
  const failed = findings.some((f) => f.level === 'error');
  if (values.json) io.stdout(JSON.stringify({ ok: !failed, findings }, null, 2));
  else for (const f of findings) io.stdout(`${f.level === 'ok' ? '✔' : f.level === 'warn' ? '!' : '✘'} ${f.message}`);
  return failed ? 2 : 0;
}

export function taskResolve(args: string[], io: CliIo): number {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { ...PROJECT_JSON, source: { type: 'string' }, probe: { type: 'boolean', default: false } } });
  const identifier = positionals[0];
  if (!identifier) throw new CliError('dev-agent: task resolve needs an identifier — see --help.');
  const config = loadConfig(projectRootOf(values, io));
  const result = resolveSource(identifier, config.taskSources.map(routeOf), { explicit: values.source, probe: values.probe });
  if (values.json) {
    io.stdout(JSON.stringify(result, null, 2));
  } else {
    switch (result.status) {
      case 'resolved':
        io.stdout(`resolved: ${result.source} (via ${result.via})`);
        break;
      case 'ambiguous':
        io.stdout(`ambiguous: ${result.candidates.join(', ')}`);
        break;
      case 'probe':
        io.stdout(`probe: ${result.candidates.join(', ')}`);
        break;
      case 'unknown-source':
        io.stdout(`unknown-source: ${result.source} (known: ${result.known.join(', ')})`);
        break;
      case 'unresolved':
        io.stdout(`unresolved: ${result.reason}`);
        break;
    }
  }
  return result.status === 'resolved' || result.status === 'probe' ? 0 : 2;
}

function keyOf(positionals: string[], what: string): string {
  const key = positionals[0];
  if (!key) throw new CliError(`dev-agent: task ${what} needs a work item key — see --help.`);
  return key;
}

export function taskStatus(args: string[], io: CliIo): number {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: PROJECT_JSON });
  const key = keyOf(positionals, 'status');
  const root = projectRootOf(values, io);
  const result = checkResume(root, loadConfig(root), key);
  if (values.json) io.stdout(JSON.stringify(result, null, 2));
  else if (result.ok) {
    io.stdout(`phase: ${result.phase}`);
    io.stdout(`branch: ${result.state.workingBranch ?? '-'}`);
    io.stdout(`base: ${result.state.baseBranch ?? '-'} ${result.state.baseSha ?? ''}`.trimEnd());
    io.stdout(`source: ${result.state.source}`);
    io.stdout(`source configured: ${result.sourceConfigured ? 'yes' : 'no'}`);
    io.stdout(`stale knowledge: ${result.staleKnowledge.length > 0 ? result.staleKnowledge.join(', ') : '-'}`);
  } else {
    io.stdout(`the task needs reconciling before it continues:`);
    for (const reason of result.reasons) io.stdout(`- ${reason}`);
  }
  return result.ok ? 0 : 2;
}

export function taskShow(args: string[], io: CliIo): number {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { project: { type: 'string' } } });
  const key = keyOf(positionals, 'show');
  const root = projectRootOf(values, io);
  let ledger: string | null;
  try {
    ledger = readLedger(root, loadConfig(root), key);
  } catch (error) {
    throw new CliError((error as Error).message, 1);
  }
  if (ledger === null) throw new CliError(`dev-agent: no ledger for ${key}.`, 1);
  io.stdout(ledger.trimEnd());
  return 0;
}
```

`packages/cli/src/dev-cli.ts`: import `{ sourcesList, sourcesVerify, taskResolve, taskShow, taskStatus }` from `./dev-task-commands.js` and add to the `switch`:

```ts
      case 'sources':
        return rest[0] === 'verify' ? sourcesVerify(rest.slice(1), io) : sourcesList(rest, io);
      case 'task':
        switch (rest[0]) {
          case 'resolve':
            return taskResolve(rest.slice(1), io);
          case 'status':
            return taskStatus(rest.slice(1), io);
          case 'show':
            return taskShow(rest.slice(1), io);
          default:
            throw new CliError(`dev-agent: unknown task command "${rest[0] ?? ''}" — see --help.`);
        }
```

(There is a circular import between `dev-cli.ts` and `dev-task-commands.ts` — `CliError` and `projectRootOf` flow one way, the command functions the other. ES modules handle it because both are only used inside function bodies; if `tsx` complains, move `CliError`, `projectRootOf` and `PROJECT_JSON` into a small `dev-common.ts` and import them from both.)

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test --workspace=packages/cli 2>&1 | grep -E "^ℹ (pass|fail)"; npm run typecheck --workspace=packages/cli`
Expected: `fail 0`, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "cli: sources, sources verify and task resolve|status|show"
```

---

### Task 6: CLI — `contract show|verify|usage`

**Files:**
- Create: `packages/cli/src/dev-contract-commands.ts`
- Modify: `packages/cli/src/dev-cli.ts` (add the `contract` case)
- Test: `packages/cli/tests/dev-contract-commands.test.ts`

**Interfaces:**
- Consumes: `readContract`, `verifyExchange`, `verifyOpenApi`, `parseOpenApiText`, `verifyClientUsage`, `loadDevAgentConfig`, `resolveInside` (core); `projectRootOf`, `CliError` (Task 4).
- Produces (`dev-contract-commands.ts`): `contractShow(args, io): number`, `contractVerify(args, io): number`, `contractUsage(args, io): number`.

Behavior:
- `contract show <KEY>`: prints the contract as pretty JSON; missing → exit 1.
- `contract verify <KEY> [--exchange <file> ...] [--openapi <file>]`: at least one of the two is required (exit 1 otherwise). Each `--exchange` file holds one exchange object or an array of them. Prints one section per input (`exchange <file>` / `openapi <file>`) with `✔` for a clean input and `✘`/`!` lines for errors/warnings; exit 0 when every input has no error, 2 otherwise. `--json` prints `{ ok, results: [...] }`.
- `contract usage <KEY> --client <dir> ...`: scans the given directories (relative to the project; each must resolve inside it) for `.ts .tsx .js .jsx .mjs .vue .svelte .html` files, skipping `node_modules`, `.git`, `dist`, `build`, `coverage` and symlinks; caps: 2000 files, 500 KB per file. Prints `used: yes|no`, `method confirmed: yes|no`, the files, and `unhandled error codes`. Exit 0 when the route is used; with `--strict` it also requires the method to be confirmed and every error code to be mentioned. Not used → exit 2.
- User-supplied evidence files (`--exchange`, `--openapi`) may live anywhere the user points, but must be regular files (not symlinks, not directories) of at most 5 MB; otherwise exit 1 with a clear message.

- [ ] **Step 1: Write the failing tests**

`packages/cli/tests/dev-contract-commands.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runDev } from '../src/dev-cli.ts';
import { writeContract } from '../../core/src/index.ts';
import { setup } from './dev-cli.test.ts';

const dirs = { taskDocsDir: '.dev-agent/tasks', stateDir: '.dev-agent/state' };
const CONTRACT = {
  method: 'POST',
  path: '/api/users',
  request: { email: 'email', name: 'string' },
  response: { id: 'uuid', email: 'email', name: 'string' },
  errors: { '400': ['INVALID_INPUT'], '409': ['EMAIL_ALREADY_EXISTS'] },
  successStatus: 201
};
const ID = '3f2b8a4e-9d1c-4b6a-8e2f-0a1b2c3d4e5f';
const good = { method: 'POST', path: '/api/users', requestBody: { email: 'a@example.test', name: 'Ana' }, status: 201, responseBody: { id: ID, email: 'a@example.test', name: 'Ana' } };
const conflict = { method: 'POST', path: '/api/users', requestBody: { email: 'a@example.test', name: 'Ana' }, status: 409, responseBody: { detail: { code: 'EMAIL_ALREADY_EXISTS' } } };
const OPENAPI = JSON.stringify({
  openapi: '3.1.0',
  paths: { '/api/users': { post: { requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['email', 'name'], properties: { email: { type: 'string', format: 'email' }, name: { type: 'string' } } } } } }, responses: { '201': { description: 'ok', content: { 'application/json': { schema: { type: 'object', required: ['id', 'email', 'name'], properties: { id: { type: 'string', format: 'uuid' }, email: { type: 'string', format: 'email' }, name: { type: 'string' } } } } } }, '400': { description: 'bad' }, '409': { description: 'conflict' } } } } }
});

function project(files: Record<string, string> = {}) {
  const t = setup(files);
  writeContract(t.projectRoot, dirs, 'APP-88', CONTRACT);
  return t;
}

test('contract show prints the contract; a missing or invalid key is an error', async () => {
  const t = project();
  try {
    assert.equal(await runDev(['contract', 'show', 'APP-88', '--project', t.projectRoot], t.io), 0);
    assert.equal(JSON.parse(t.text()).path, '/api/users');
    assert.equal(await runDev(['contract', 'show', 'APP-99', '--project', t.projectRoot], t.io), 1);
    assert.match(t.err.join('\n'), /no contract for APP-99/);
    assert.equal(await runDev(['contract', 'show', '../../x', '--project', t.projectRoot], t.io), 1);
  } finally {
    t.cleanup();
  }
});

test('contract verify passes conforming exchanges (one file, several exchanges) and an OpenAPI description', async () => {
  const t = project({ 'evidence/ok.json': JSON.stringify([good, conflict]), 'evidence/openapi.json': OPENAPI });
  try {
    assert.equal(await runDev(['contract', 'verify', 'APP-88', '--exchange', join(t.projectRoot, 'evidence/ok.json'), '--openapi', join(t.projectRoot, 'evidence/openapi.json'), '--project', t.projectRoot], t.io), 0);
    assert.match(t.text(), /✔ exchange .*ok\.json \(2 exchanges\)/);
    assert.match(t.text(), /✔ openapi .*openapi\.json/);
  } finally {
    t.cleanup();
  }
});

test('contract verify exits 2 and names the violations for a drifting exchange', async () => {
  const drift = { ...good, responseBody: { id: 'nope', email: 'a@example.test' } };
  const t = project({ 'evidence/drift.json': JSON.stringify(drift) });
  try {
    assert.equal(await runDev(['contract', 'verify', 'APP-88', '--exchange', join(t.projectRoot, 'evidence/drift.json'), '--project', t.projectRoot], t.io), 2);
    assert.match(t.text(), /✘ exchange .*drift\.json/);
    assert.match(t.text(), /id: expected uuid/);
    assert.match(t.text(), /name: required field is missing/);
    t.out.length = 0;
    assert.equal(await runDev(['contract', 'verify', 'APP-88', '--exchange', join(t.projectRoot, 'evidence/drift.json'), '--project', t.projectRoot, '--json'], t.io), 2);
    assert.equal(JSON.parse(t.text()).ok, false);
  } finally {
    t.cleanup();
  }
});

test('contract verify needs evidence, and rejects unreadable, oversized, symlinked or malformed files with exit 1', async () => {
  const t = project({ 'evidence/bad.json': '{not json', 'evidence/big.json': ' '.repeat(5 * 1024 * 1024 + 10), 'evidence/ok.json': JSON.stringify(good) });
  try {
    const verify = (...args: string[]) => runDev(['contract', 'verify', 'APP-88', ...args, '--project', t.projectRoot], t.io);
    assert.equal(await verify(), 1);
    assert.match(t.err.join('\n'), /--exchange or --openapi/);
    assert.equal(await verify('--exchange', join(t.projectRoot, 'evidence/missing.json')), 1);
    assert.equal(await verify('--exchange', join(t.projectRoot, 'evidence/bad.json')), 1);
    assert.match(t.err.join('\n'), /not valid JSON/);
    assert.equal(await verify('--exchange', join(t.projectRoot, 'evidence/big.json')), 1);
    assert.match(t.err.join('\n'), /larger than/);
    assert.equal(await verify('--exchange', join(t.projectRoot, 'evidence')), 1);
    symlinkSync(join(t.projectRoot, 'evidence/ok.json'), join(t.projectRoot, 'evidence/link.json'));
    assert.equal(await verify('--exchange', join(t.projectRoot, 'evidence/link.json')), 1);
    assert.match(t.err.join('\n'), /symbolic link|regular file/);
  } finally {
    t.cleanup();
  }
});

test('contract usage finds the call, the method and the handled error codes in client directories', async () => {
  const t = project({
    'frontend/src/api.ts': "export const createUser = (b) => request('/api/users', { method: 'POST', body: JSON.stringify(b) });",
    'frontend/src/Form.tsx': "if (e.code === 'EMAIL_ALREADY_EXISTS') {} if (e.code === 'INVALID_INPUT') {}",
    'frontend/node_modules/x/index.js': "fetch('/api/users')"
  });
  try {
    assert.equal(await runDev(['contract', 'usage', 'APP-88', '--client', 'frontend', '--project', t.projectRoot], t.io), 0);
    assert.match(t.text(), /used: yes/);
    assert.match(t.text(), /method confirmed: yes/);
    assert.match(t.text(), /frontend\/src\/api\.ts/);
    assert.doesNotMatch(t.text(), /node_modules/);
    assert.match(t.text(), /unhandled error codes: -/);
  } finally {
    t.cleanup();
  }
});

test('contract usage exits 2 when the route is not called, and --strict also demands method and error codes', async () => {
  const t = project({ 'frontend/a.ts': "axios.get('/api/users')", 'frontend/b.ts': "fetch('/api/people')" });
  const other = project({ 'client/none.ts': "fetch('/api/people')" });
  try {
    assert.equal(await runDev(['contract', 'usage', 'APP-88', '--client', 'client', '--project', other.projectRoot], other.io), 2);
    assert.match(other.text(), /used: no/);
    assert.equal(await runDev(['contract', 'usage', 'APP-88', '--client', 'frontend', '--project', t.projectRoot], t.io), 0);
    t.out.length = 0;
    assert.equal(await runDev(['contract', 'usage', 'APP-88', '--client', 'frontend', '--strict', '--project', t.projectRoot], t.io), 2);
    assert.match(t.text(), /method confirmed: no/);
    assert.match(t.text(), /unhandled error codes: EMAIL_ALREADY_EXISTS, INVALID_INPUT/);
  } finally {
    t.cleanup();
    other.cleanup();
  }
});

test('contract usage refuses client directories outside the project and skips symlinks', async () => {
  const t = project({ 'frontend/a.ts': "fetch('/api/users')" });
  try {
    assert.equal(await runDev(['contract', 'usage', 'APP-88', '--client', '../elsewhere', '--project', t.projectRoot], t.io), 1);
    assert.match(t.err.join('\n'), /escapes the project root/);
    assert.equal(await runDev(['contract', 'usage', 'APP-88', '--project', t.projectRoot], t.io), 1);
    assert.match(t.err.join('\n'), /--client/);
    mkdirSync(join(t.base, 'outside'));
    writeFileSync(join(t.base, 'outside', 'leak.ts'), "fetch('/api/users')");
    symlinkSync(join(t.base, 'outside'), join(t.projectRoot, 'frontend', 'linked'), 'dir');
    t.out.length = 0;
    assert.equal(await runDev(['contract', 'usage', 'APP-88', '--client', 'frontend', '--project', t.projectRoot], t.io), 0);
    assert.doesNotMatch(t.text(), /leak\.ts/);
  } finally {
    t.cleanup();
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test packages/cli/tests/dev-contract-commands.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|Cannot find|unknown command" | head -3`
Expected: FAIL — `contract` is an unknown command.

- [ ] **Step 3: Implement**

`packages/cli/src/dev-contract-commands.ts`:

```ts
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  loadDevAgentConfig,
  parseOpenApiText,
  readContract,
  resolveInside,
  verifyClientUsage,
  verifyExchange,
  verifyOpenApi,
  type ApiContract,
  type ClientFile,
  type Exchange,
  type VerifyResult
} from '../../core/src/index.js';
import type { CliIo } from './cli.js';
import { CliError, projectRootOf } from './dev-cli.js';

const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
const MAX_CLIENT_FILES = 2000;
const MAX_CLIENT_FILE_BYTES = 500 * 1024;
const CLIENT_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue', '.svelte', '.html']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

function load(root: string, key: string): ApiContract {
  try {
    const contract = readContract(root, loadDevAgentConfig(root), key);
    if (contract === null) throw new CliError(`dev-agent: no contract for ${key}.`, 1);
    return contract;
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError((error as Error).message, 1);
  }
}

function keyOf(positionals: string[], what: string): string {
  const key = positionals[0];
  if (!key) throw new CliError(`dev-agent: contract ${what} needs a work item key — see --help.`);
  return key;
}

function readEvidence(io: CliIo, file: string): string {
  const full = path.resolve(io.cwd, file);
  let stat;
  try {
    stat = lstatSync(full);
  } catch {
    throw new CliError(`dev-agent: cannot read "${file}".`, 1);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new CliError(`dev-agent: "${file}" must be a regular file (not a symbolic link or a directory).`, 1);
  if (stat.size > MAX_EVIDENCE_BYTES) throw new CliError(`dev-agent: "${file}" is larger than ${MAX_EVIDENCE_BYTES / 1024 / 1024} MB.`, 1);
  return readFileSync(full, 'utf8');
}

export function contractShow(args: string[], io: CliIo): number {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { project: { type: 'string' } } });
  io.stdout(JSON.stringify(load(projectRootOf(values, io), keyOf(positionals, 'show')), null, 2));
  return 0;
}

interface Section {
  label: string;
  result: VerifyResult;
}

function printSection(io: CliIo, section: Section): void {
  const errors = section.result.violations.filter((v) => v.severity === 'error');
  io.stdout(`${errors.length === 0 ? '✔' : '✘'} ${section.label}`);
  for (const v of section.result.violations) io.stdout(`  ${v.severity === 'error' ? '✘' : '!'} ${v.message}`);
}

export function contractVerify(args: string[], io: CliIo): number {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { project: { type: 'string' }, json: { type: 'boolean', default: false }, exchange: { type: 'string', multiple: true }, openapi: { type: 'string' } }
  });
  const contract = load(projectRootOf(values, io), keyOf(positionals, 'verify'));
  const exchangeFiles = values.exchange ?? [];
  if (exchangeFiles.length === 0 && !values.openapi) throw new CliError('dev-agent: contract verify needs --exchange or --openapi evidence — see --help.');

  const sections: Section[] = [];
  for (const file of exchangeFiles) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readEvidence(io, file));
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError(`dev-agent: "${file}" is not valid JSON.`, 1);
    }
    const exchanges = (Array.isArray(parsed) ? parsed : [parsed]) as Exchange[];
    if (exchanges.some((e) => typeof e !== 'object' || e === null || typeof e.method !== 'string' || typeof e.path !== 'string' || typeof e.status !== 'number')) {
      throw new CliError(`dev-agent: "${file}" must hold exchanges shaped { method, path, status, requestBody?, responseBody? }.`, 1);
    }
    const results = exchanges.map((e) => verifyExchange(contract, e));
    sections.push({
      label: `exchange ${file} (${exchanges.length} exchange${exchanges.length === 1 ? '' : 's'})`,
      result: { ok: results.every((r) => r.ok), violations: results.flatMap((r) => r.violations) }
    });
  }
  if (values.openapi) {
    let doc: unknown;
    try {
      doc = parseOpenApiText(readEvidence(io, values.openapi));
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError(`dev-agent: ${(error as Error).message}.`, 1);
    }
    sections.push({ label: `openapi ${values.openapi}`, result: verifyOpenApi(contract, doc) });
  }

  const ok = sections.every((s) => s.result.ok);
  if (values.json) io.stdout(JSON.stringify({ ok, results: sections.map((s) => ({ input: s.label, ...s.result })) }, null, 2));
  else for (const s of sections) printSection(io, s);
  return ok ? 0 : 2;
}

function collectClientFiles(root: string, dir: string, out: ClientFile[]): void {
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (out.length >= MAX_CLIENT_FILES) return;
    if (entry.isSymbolicLink()) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectClientFiles(root, rel, out);
    } else if (entry.isFile() && CLIENT_EXT.has(path.extname(entry.name))) {
      const full = path.join(root, rel);
      if (lstatSync(full).size <= MAX_CLIENT_FILE_BYTES) out.push({ path: rel, text: readFileSync(full, 'utf8') });
    }
  }
}

export function contractUsage(args: string[], io: CliIo): number {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { project: { type: 'string' }, json: { type: 'boolean', default: false }, client: { type: 'string', multiple: true }, strict: { type: 'boolean', default: false } }
  });
  const root = projectRootOf(values, io);
  const contract = load(root, keyOf(positionals, 'usage'));
  const clients = values.client ?? [];
  if (clients.length === 0) throw new CliError('dev-agent: contract usage needs at least one --client <dir> — see --help.');

  const files: ClientFile[] = [];
  for (const client of clients) {
    let abs: string;
    try {
      abs = resolveInside(root, client);
    } catch (error) {
      throw new CliError(`dev-agent: --client "${client}": ${(error as Error).message}.`, 1);
    }
    collectClientFiles(root, path.relative(root, abs).split(path.sep).join('/'), files);
  }
  const usage = verifyClientUsage(contract, files);
  if (values.json) io.stdout(JSON.stringify({ ...usage, scannedFiles: files.length }, null, 2));
  else {
    io.stdout(`used: ${usage.used ? 'yes' : 'no'}`);
    io.stdout(`method confirmed: ${usage.methodConfirmed ? 'yes' : 'no'}`);
    io.stdout(`files: ${usage.files.length > 0 ? usage.files.join(', ') : '-'}`);
    io.stdout(`unhandled error codes: ${usage.missingErrorCodes.length > 0 ? usage.missingErrorCodes.join(', ') : '-'}`);
    io.stdout('(text evidence from client source, not a proof of runtime behavior)');
  }
  const ok = usage.used && (!values.strict || (usage.methodConfirmed && usage.missingErrorCodes.length === 0));
  return ok ? 0 : 2;
}
```

`packages/cli/src/dev-cli.ts`: import `{ contractShow, contractUsage, contractVerify }` from `./dev-contract-commands.js` and add to the `switch`:

```ts
      case 'contract':
        switch (rest[0]) {
          case 'show':
            return contractShow(rest.slice(1), io);
          case 'verify':
            return contractVerify(rest.slice(1), io);
          case 'usage':
            return contractUsage(rest.slice(1), io);
          default:
            throw new CliError(`dev-agent: unknown contract command "${rest[0] ?? ''}" — see --help.`);
        }
```

Implementer note: `resolveInside(root, 'frontend')` returns the absolute path and throws for `../elsewhere` with a message containing `escapes the project root`; it also throws when a component is a symlink, which is the behavior wanted for a symlinked client directory given directly. Symlinks found *inside* a scanned directory are skipped silently by `collectClientFiles`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test --workspace=packages/cli 2>&1 | grep -E "^ℹ (pass|fail)"; npm run typecheck --workspace=packages/cli`
Expected: `fail 0`, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "cli: contract show, verify and usage"
```

---

### Task 7: The `fullstack-contract` skill, orchestrator routing and install counts

**Files:**
- Create: `skills/fullstack-contract/SKILL.md`, `skills/fullstack-contract/references/contract-format.md`
- Modify: `skills/task-orchestrator/references/task-ledger.md` (the fullstack bullet)
- Modify: `packages/cli/tests/shared-skills-install.test.ts` (26 skills)
- Create: `packages/core/tests/fullstack-skill.test.ts`
- Modify: `packages/core/tests/shared-skills.test.ts` (the classification test names `fullstack-contract`)

**Interfaces:**
- Consumes: the CLI commands from Tasks 5–6 (named in the skill), `docs` conventions of the neutral skills.
- Produces: an installed skill `fullstack-contract` (loaded when a work item spans UI and API) and the reference `contract-format` (a `type: contract` reference, so the baseline-section validator does not apply).

- [ ] **Step 1: Write the failing tests**

`packages/core/tests/fullstack-skill.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const kitRoot = fileURLToPath(new URL('../../../', import.meta.url));
const skill = readFileSync(join(kitRoot, 'skills', 'fullstack-contract', 'SKILL.md'), 'utf8');
// Neutral: no framework, ORM, queue, database, test runner, design tool or task-source product (spec §16, §27).
const FORBIDDEN =
  /\b(react|vue|nuxt|next\.js|angular|django|drf|fastapi|nestjs|express|flask|laravel|tailwind|figma|jira|linear|trello|asana|clickup|azure devops|claude code|codex|celery|rabbitmq|redis|postgres|postgresql|mysql|sqlalchemy|alembic|prisma|typeorm|pytest|jest|vitest)\b/i;

test('the skill has exact frontmatter, is neutral and compact', () => {
  const front = skill.match(/^---\nname: fullstack-contract\ndescription: (.+)\n---\n/);
  assert.ok(front, 'frontmatter must be exactly name + one-line description');
  assert.match(front![1], /^.{40,400}$/);
  assert.doesNotMatch(skill, FORBIDDEN);
  assert.ok(skill.split('\n').length <= 60, `${skill.split('\n').length} lines`);
});

test('the skill persists the contract before implementation and names the verifiers', () => {
  for (const term of ['\\.dev-agent/tasks/<KEY>\\.contract\\.json', 'before', 'dev-agent contract verify', 'dev-agent contract usage', 'same contract', 'references/contract-format\\.md']) {
    assert.match(skill, new RegExp(term), term);
  }
});

test('the skill carries the fullstack Definition of Done (spec §35)', () => {
  for (const item of ['explicit API contract persisted', 'frontend and backend use the same contract', 'backend tests pass', 'frontend tests pass', 'integration path verified', 'visual validation passes when applicable', 'task ledger documents both domains']) {
    assert.match(skill, new RegExp(item, 'i'), item);
  }
});

test('the contract-format reference documents the grammar the parser accepts', () => {
  const ref = readFileSync(join(kitRoot, 'skills', 'fullstack-contract', 'references', 'contract-format.md'), 'utf8');
  assert.match(ref, /^---\nname: contract-format\ndescription: .{20,300}\ntype: contract\n---\n/);
  for (const term of ['method', 'path', 'request', 'response', 'errors', 'successStatus', 'uuid', 'email', 'datetime', '\\[\\]', 'UPPER_SNAKE_CASE']) assert.match(ref, new RegExp(term), term);
});
```

In `packages/core/tests/shared-skills.test.ts`, extend the classification test so the fullstack expectation names the skill: add `assert.match(section, /fullstack-contract/);` inside `the orchestrator tells the agent which skills each classification loads`.

In `packages/cli/tests/shared-skills-install.test.ts` add `'fullstack-contract'` to a new `FULLSTACK` constant included in the expected list, change the directory count from 25 to 26, adjust the title ("… 10 backend and 1 fullstack skills"), and assert `.claude/skills/fullstack-contract/references/contract-format.md` exists after install.

- [ ] **Step 2: Run to verify failure**

Run: `npm test --workspace=packages/core --workspace=packages/cli 2>&1 | grep -E "^ℹ (pass|fail)|ENOENT" | head -5`
Expected: FAIL — the skill does not exist yet.

- [ ] **Step 3: Write the skill, the reference and the routing text**

`skills/fullstack-contract/SKILL.md`:

```markdown
---
name: fullstack-contract
description: Run a work item that spans a user interface and an API by persisting one explicit API contract first, then implementing both sides against it and proving they agree. Use when a task changes both the client and the service, or adds an endpoint plus the screen that calls it.
---

# Fullstack Contract

One contract, two implementations, one proof that they agree.

## Workflow

1. Investigate both areas (`repository-investigation`): the neighboring endpoint and the neighboring screen or client call.
2. Persist the contract before either side is written, at `.dev-agent/tasks/<KEY>.contract.json`. Format: `references/contract-format.md`. Declare the method, path, request and response fields, every error status with its error codes, and the success status.
3. Implement the service side with `backend-architecture` and `api-design`, exactly as the contract says.
4. Implement the client side with the client skills the classification loads, using the same paths, field names and error codes.
5. Run each side's own tests, static checks and, when a design source exists, its visual validation.
6. Prove the two agree with real evidence, not with prose:
   - capture a real request and response (success and each declared error) and run `dev-agent contract verify <KEY> --exchange <file>`;
   - if the project keeps an API description, add `--openapi <file>`;
   - run `dev-agent contract usage <KEY> --client <dir> --strict` on the client code.
7. Record both domains, the contract path, the commands run and any known difference in the task ledger.

## Rules

- The contract changes only by an explicit decision. If one side needs a different shape, change the contract first, then both sides, and say so in the ledger.
- Error codes are part of the contract: the service returns them, the client handles them.
- `contract usage` is text evidence from client source; back it with a real client test or run when practical.
- Never put credentials, tokens or personal data in the contract, in captured exchanges or in the ledger.

## Definition of Done

- [ ] explicit API contract persisted
- [ ] frontend and backend use the same contract
- [ ] backend tests pass
- [ ] frontend tests pass
- [ ] integration path verified
- [ ] visual validation passes when applicable
- [ ] task ledger documents both domains
```

`skills/fullstack-contract/references/contract-format.md`:

```markdown
---
name: contract-format
description: The JSON format of the persisted API contract and the field type grammar the verifiers understand.
type: contract
---

# Contract format

File: `.dev-agent/tasks/<KEY>.contract.json` (next to the task ledger). One file describes one endpoint.

    {
      "method": "POST",
      "path": "/api/users",
      "request":  { "email": "email", "name": "string", "nickname": "string?" },
      "response": { "id": "uuid", "email": "email", "name": "string", "tags": "string[]",
                    "profile": { "age": "integer", "bio": "string?" } },
      "errors":   { "400": ["INVALID_INPUT"], "409": ["EMAIL_ALREADY_EXISTS"] },
      "successStatus": 201
    }

## Fields

- `method`: `GET`, `POST`, `PUT`, `PATCH` or `DELETE`, uppercase.
- `path`: absolute, no query string, no `..` or `//`; path parameters as `{id}`.
- `request`: body fields (omit for no body). `response`: body fields (`{}` for an empty body). Required.
- `errors`: each 4xx/5xx status maps to a non-empty list of error codes in UPPER_SNAKE_CASE. Required (`{}` for none).
- `successStatus`: optional integer 200 to 299. When absent any 2xx passes.

## Types

`string`, `uuid`, `email`, `integer`, `number`, `boolean`, `datetime` (ISO 8601), `date` (`YYYY-MM-DD`), `object`, `any`.

- Suffix `?` makes a field optional (and lets it be `null`): `string?`.
- Suffix `[]` makes an array of that type: `string[]`, `string[]?`.
- An object value nests fields, up to four levels and 100 fields per object.
- Field names: letters, digits and `_`, starting with a letter or `_`.

## Error bodies

The verifiers read the error code from `code`, `error.code` or `detail.code` of the response body.
```

In `skills/task-orchestrator/references/task-ledger.md`, replace the fullstack bullet (the line starting `- fullstack:`) with:

```markdown
- fullstack: `fullstack-contract` first (it persists `.dev-agent/tasks/<KEY>.contract.json` before either side is written), then both the frontend and the backend skill sets, each implementing against that same contract.
```

- [ ] **Step 4: Run tests and validators**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"; npm run validate:skills 2>&1 | tail -1`
Expected: all `fail 0`; `validate-skill: all skills valid.` If the neutrality test trips on an ordinary English word, reword the sentence.

- [ ] **Step 5: Commit**

```bash
git add skills packages
git commit -m "skills: fullstack-contract with the contract-format reference; orchestrator routes fullstack to it; install covers 26 skills"
```

---

### Task 8: Fullstack eval fixture and scenarios

**Files:**
- Modify: `packages/evals/src/schema.ts` (add the `fullstack` category), `packages/evals/src/cli.ts` (help text)
- Create fixture: `evals/fixtures/fullstack-app/**`
- Create scenarios: `evals/scenarios/fullstack-{api-contract,form-plus-api,validation-error-contract}.json`
- Modify: `packages/evals/tests/schema.test.ts`, `packages/evals/tests/catalog.test.ts`

**Interfaces:**
- Consumes: optional `figma` (v0.8); the `fullstack-contract` skill and the backend/frontend skills (Tasks 7, v0.8).
- Produces: `CATEGORIES = ['base','stack','profile','backend','fullstack']`; three fullstack scenarios answerable from source alone (no installs, no running services, no Figma).

- [ ] **Step 1: Write the failing tests**

In `packages/evals/tests/schema.test.ts` extend the v0.8 test so it also accepts `category: 'fullstack'`:

```ts
test('the fullstack category is valid', () => {
  const s = { id: 'fullstack-x', category: 'fullstack', title: 'Fullstack', fixture: 'fullstack-app', prompt: 'Do the thing.', expected: [{ type: 'file_exists', path: 'a.py' }] };
  assert.equal(ScenarioSchema.safeParse(s).success, true);
});
```

In `packages/evals/tests/catalog.test.ts`:
- change the first test to expect `[7, 8, 3, 9, 3]` for `[base, stack, profile, backend, fullstack]` (add `count('fullstack')`);
- extend the "every backend scenario fails on the untouched fixture" loop to iterate `x.category === 'backend' || x.category === 'fullstack'`;
- add:

```ts
test('fullstack scenarios need no Figma, demand the contract skill, and persist a contract file', () => {
  const fullstack = loadScenarios(layout).filter((s) => s.category === 'fullstack');
  assert.deepEqual(fullstack.map((s) => s.id).sort(), ['fullstack-api-contract', 'fullstack-form-plus-api', 'fullstack-validation-error-contract']);
  for (const s of fullstack) {
    assert.equal(s.figma, undefined, s.id);
    assert.ok(s.expected.some((a) => a.type === 'tool_called' && a.tool === 'skill/fullstack-contract'), `${s.id} must expect the contract skill`);
    assert.ok(s.expected.some((a) => a.type === 'file_matches' && a.glob.startsWith('.dev-agent/tasks/') && a.glob.endsWith('.contract.json')), `${s.id} must expect the contract file`);
    assert.match(s.prompt, /instalar depend[eê]ncias|nem instalar/i, s.id);
    assert.doesNotMatch(s.prompt, /\{\{baseUrl\}\}/, s.id);
  }
});

test('fullstack: a solution that writes the contract and both sides passes, one that skips the contract or the client fails', () => {
  const contract = JSON.stringify({ method: 'POST', path: '/api/users', request: { email: 'email', name: 'string' }, response: { id: 'uuid', email: 'email', name: 'string' }, errors: { '400': ['INVALID_INPUT'], '409': ['EMAIL_ALREADY_EXISTS'] }, successStatus: 201 }, null, 2);
  const backend = 'from fastapi import APIRouter, HTTPException\\nrouter = APIRouter(prefix="/api/users")\\n@router.post("", status_code=201)\\ndef create_user(body):\\n    if exists(body.email):\\n        raise HTTPException(409, detail={"code": "EMAIL_ALREADY_EXISTS"})\\n    return {"id": "x"}\\n';
  const client = "import { request } from './client';\\nexport const createUser = (b: unknown) => request('/api/users', { method: 'POST', body: JSON.stringify(b) });\\n";
  const files = { '.dev-agent/tasks/APP-88.contract.json': contract, 'backend/app/routers/users.py': backend, 'frontend/src/api/users.ts': client };
  const text = 'ok';
  assert.equal(gradeWith('fullstack-api-contract', files, text).verdict, 'pass');
  const { '.dev-agent/tasks/APP-88.contract.json': _c, ...noContract } = files;
  assert.equal(gradeWith('fullstack-api-contract', noContract, text).verdict, 'fail');
  const { 'frontend/src/api/users.ts': _f, ...noClient } = files;
  assert.equal(gradeWith('fullstack-api-contract', noClient, text).verdict, 'fail');
});
```

The `{{baseUrl}}` rule test already applies only to `base` and `profile`; the fixture-copy test (`every fixture copies cleanly`) iterates fixtures used by scenarios, so `fullstack-app` is covered automatically.

- [ ] **Step 2: Run to verify failure**

Run: `npm test --workspace=packages/evals 2>&1 | grep -E "^ℹ (pass|fail)|^✖" | head`
Expected: FAIL — no `fullstack` category, fixture or scenarios.

- [ ] **Step 3: Implement**

`packages/evals/src/schema.ts`: `export const CATEGORIES = ['base', 'stack', 'profile', 'backend', 'fullstack'] as const;`. `packages/evals/src/cli.ts`: change the help text to `--category base|stack|profile|backend|fullstack ...`.

Fixture `evals/fixtures/fullstack-app/` (tiny, no installed dependencies, no symlinks):

`backend/pyproject.toml`:
```toml
[project]
name = "directory"
version = "0.1.0"
dependencies = ["fastapi>=0.110", "pydantic>=2"]

[project.optional-dependencies]
dev = ["pytest>=8"]
```
`backend/app/__init__.py` (empty), `backend/app/routers/__init__.py` (empty), `backend/tests/__init__.py` (empty).
`backend/app/main.py`:
```python
from fastapi import FastAPI

from app.routers import users

app = FastAPI(title="directory")
app.include_router(users.router)
```
`backend/app/schemas.py`:
```python
from pydantic import BaseModel


class UserOut(BaseModel):
    id: str
    email: str
    name: str
```
`backend/app/routers/users.py`:
```python
from fastapi import APIRouter

from app.schemas import UserOut

router = APIRouter(prefix="/api/users", tags=["users"])

USERS: list[dict] = [{"id": "1", "email": "ana@example.test", "name": "Ana"}]


@router.get("", response_model=list[UserOut])
def list_users():
    return USERS
```
`backend/tests/test_users.py`:
```python
from app.routers.users import list_users


def test_list_users_returns_the_seed_user():
    assert list_users()[0]["email"] == "ana@example.test"
```
`frontend/package.json`:
```json
{
  "name": "directory-ui",
  "version": "0.1.0",
  "private": true,
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "react": "^18.3.0", "react-dom": "^18.3.0" },
  "devDependencies": { "@types/react": "^18.3.0", "typescript": "^5.4.0", "vitest": "^1.6.0" }
}
```
`frontend/tsconfig.json`:
```json
{ "compilerOptions": { "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler", "jsx": "react-jsx", "strict": true }, "include": ["src"] }
```
`frontend/src/api/client.ts`:
```ts
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code);
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, body?.code ?? body?.detail?.code ?? 'UNKNOWN');
  return body as T;
}
```
`frontend/src/components/UserList.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { request } from '../api/client';

interface User {
  id: string;
  email: string;
  name: string;
}

export function UserList() {
  const [users, setUsers] = useState<User[]>([]);
  useEffect(() => {
    request<User[]>('/api/users').then(setUsers);
  }, []);
  return (
    <ul>
      {users.map((u) => (
        <li key={u.id}>
          {u.name} ({u.email})
        </li>
      ))}
    </ul>
  );
}
```

Scenarios (`evals/scenarios/*.json`; write with a script that dumps JSON to avoid escaping mistakes). Common fields: `category: 'fullstack'`, `fixture: 'fullstack-app'`, `timeoutSec: 900`, Portuguese prompts that say nothing has to be installed or run.

`fullstack-api-contract.json`:
- title `Contrato de API para criar usuário, back e front`
- prompt: `Execute a tarefa APP-88: permitir criar usuários com POST /api/users (email e name; responde 201 com id, email e name; 400 INVALID_INPUT e 409 EMAIL_ALREADY_EXISTS). Antes de implementar, persista o contrato da API em .dev-agent/tasks/APP-88.contract.json, depois implemente o backend e o frontend contra o mesmo contrato. Use as skills do kit. Não é preciso rodar o app nem instalar dependências. Termine com um resumo curto.`
- expected: `tool_called skill/fullstack-contract`; `file_matches` glob `.dev-agent/tasks/APP-88.contract.json` patterns `"method"\s*:\s*"POST"`, `"path"\s*:\s*"/api/users"`, `EMAIL_ALREADY_EXISTS`; `file_matches` glob `backend/app/routers/users.py` pattern `@router\.post`; `file_matches` glob `backend/app/**/*.py` pattern `EMAIL_ALREADY_EXISTS`; `file_matches` glob `frontend/src/**/*.ts*` pattern `['"]POST['"]`.
- forbidden: `file_matches` glob `frontend/src/**/*.ts*` pattern `/api/(create-user|users/create)` (description: `o cliente chama um caminho diferente do contrato`).

`fullstack-form-plus-api.json`:
- title `Formulário acessível de novo usuário mais o endpoint`
- prompt: `Execute a tarefa APP-91: adicione um formulário "Novo usuário" (e-mail e nome) que chama POST /api/users e mostra uma mensagem específica quando o e-mail já existe (409 EMAIL_ALREADY_EXISTS). Persista primeiro o contrato em .dev-agent/tasks/APP-91.contract.json, depois implemente o endpoint e o formulário, com rótulos associados aos campos. Use as skills do kit. Não é preciso rodar o app nem instalar dependências. Termine com um resumo curto.`
- expected: `skill/fullstack-contract`; `skill/accessibility`; contract file glob `.dev-agent/tasks/APP-91.contract.json` pattern `EMAIL_ALREADY_EXISTS`; `frontend/src/components/CreateUserForm.tsx` patterns `<form` and `<label` and `EMAIL_ALREADY_EXISTS`; `backend/app/**/*.py` pattern `EMAIL_ALREADY_EXISTS`.
- forbidden: `file_matches` glob `frontend/src/**/*.tsx` pattern `dangerouslySetInnerHTML`.

`fullstack-validation-error-contract.json`:
- title `Contrato de erro de validação respeitado nos dois lados`
- prompt: `Execute a tarefa APP-95: a criação de usuário (POST /api/users) deve rejeitar entrada inválida com 400 e o código INVALID_INPUT, e o frontend deve mostrar "Dados inválidos" quando receber esse código. Persista o contrato em .dev-agent/tasks/APP-95.contract.json antes de implementar. Use as skills do kit. Não é preciso rodar o app nem instalar dependências. Termine com um resumo curto.`
- expected: `skill/fullstack-contract`; contract file glob `.dev-agent/tasks/APP-95.contract.json` patterns `INVALID_INPUT` and `"400"`; `backend/app/**/*.py` pattern `INVALID_INPUT`; `frontend/src/**/*.ts*` pattern `INVALID_INPUT`.
- forbidden: `file_matches` glob `frontend/src/**/*.ts*` pattern `catch\s*\(\w*\)\s*\{\s*\}` (description `engole o erro em silêncio`).

- [ ] **Step 4: Run tests and the offline validator**

Run: `npm test --workspace=packages/evals 2>&1 | grep -E "^ℹ (pass|fail)"; npm run evals:validate 2>&1 | tail -1`
Expected: `fail 0`; `ok: 30 scenarios`. If the "fails on the untouched fixture" test reports a scenario that passes untouched, tighten that scenario until an untouched fixture fails it.

- [ ] **Step 5: Commit**

```bash
git add evals packages/evals
git commit -m "evals: a fullstack category with one fixture and three contract scenarios"
```

---

### Task 9: Docs and v0.9.0 release

**Files:**
- Create: `docs/fullstack.md`, `docs/cli.md`
- Modify: `README.md`, `evals/README.md`
- Modify (version 0.8.0 → 0.9.0): `packages/{cli,core,evals}/package.json`, `package-lock.json`, `packages/cli/tests/cli.test.ts`, `packages/cli/tests/util.test.ts` (mirror the v0.8 release: `git show 30d1802 --stat`)

- [ ] **Step 1: Write the docs**

`docs/fullstack.md`: the fullstack flow (contract first, two implementations, one proof); the contract file and where it lives; the three verifiers and what each proves (exchange = real behavior of the service, OpenAPI = the published description, client usage = text evidence of the client); the Definition of Done; what is deliberately not automated (running the application, generating clients, contract tests against a live service).

`docs/cli.md`: every `dev-agent` command with its exit codes (0 ok, 1 usage/environment, 2 checked-and-not-OK), an example of `sources`, `sources verify`, `task resolve`, `task status`, `contract verify` and `contract usage` output, the fact that `install`/`verify` are aliases of `frontend-agent`, and that the CLI never mutates Git, calls the network or runs a model (a natural-language task still runs in Claude Code or Codex).

`README.md`: update the skill-count line to "…and v0.9 the `fullstack-contract` skill, for 26 in total"; add a `## v0.9 — fullstack orchestration and the dev-agent CLI` section after v0.8 (contract artifact, three verifiers, the skill, `dev-agent` commands, three fullstack scenarios, unchanged `frontend-agent`). `evals/README.md`: one bullet that `category` may also be `fullstack`.

- [ ] **Step 2: Bump the version**

Run: `sed -i 's/"version": "0.8.0"/"version": "0.9.0"/' packages/cli/package.json packages/core/package.json packages/evals/package.json`, update the two version assertions in `packages/cli/tests/cli.test.ts` and `packages/cli/tests/util.test.ts`, then `npm install --package-lock-only`.

- [ ] **Step 3: Run everything**

```bash
npm test 2>&1 | grep -E "^ℹ (pass|fail)"
npm run typecheck --workspaces --if-present
npm run validate:skills
npm run evals:validate
node packages/cli/bin/dev-agent.mjs --version
```

Expected: every `fail` is 0; typecheck clean; `validate-skill: all skills valid.`; `ok: 30 scenarios`; the version prints `0.9.0`.

- [ ] **Step 4: Commit**

```bash
git add docs README.md evals packages package-lock.json
git commit -m "chore: release v0.9.0 — fullstack orchestration and the dev-agent CLI"
```

---

## Self-review

**Spec coverage (§38 v0.9 checklist and §23/§25):**

| Item | Where |
|---|---|
| fullstack classification | Task 7 (skill + orchestrator routing text; classification already existed in v0.7/v0.8) |
| API contract artifact (`<KEY>.contract.json`) | Task 1 |
| frontend/backend contract handoff | Task 7 (`fullstack-contract` workflow, `contract-format` reference) |
| integration verifier | Tasks 2, 3 (exchange, OpenAPI, client usage), Task 6 (CLI) |
| fullstack eval scenarios (`fullstack-api-contract`, `fullstack-form-plus-api`, `fullstack-validation-error-contract`) | Task 8 |
| `dev-agent` CLI alias | Task 4 (`install`/`verify` delegate to `run`) |
| `dev-agent sources` / `sources verify` | Task 5 |
| §25 `task resolve|status|show` | Task 5 |
| §25 `inspect`, `context audit` | Task 4 |
| §35 fullstack Definition of Done | Task 7 (skill checklist, tested) |
| §41 fullstack example flow | Task 7 (workflow steps 1–7) |
| §43 compatibility | Global Constraints; Task 4 test proves `dev-agent install` output equals `frontend-agent install` |

**Deferred with a stated reason:** `dev-agent repo index` and `dev-agent diff review` (§25) — they would need an LLM or a content generator for repo knowledge and diff review; `packages/core` only has the freshness and audit machinery, so they wait for a version that defines what they produce. A real-host benchmark of the fullstack scenarios (the user skipped benchmarks). Running the application or generating client code from the contract.

**Decisions recorded in the plan (confirm or overrule):**
1. The contract describes **one endpoint per file**, as in the spec example; a task touching several endpoints uses several keys or extends the workflow later.
2. The contract adds an optional `successStatus` (the spec example has none) so a `201` vs `200` drift is detectable; without it any 2xx passes.
3. Type grammar (`string`, `uuid`, `email`, `integer`, `number`, `boolean`, `datetime`, `date`, `object`, `any`, with `?` and `[]`, nested objects) is this plan's design; the spec only shows `"string"` and `"uuid"`.
4. Verification is **evidence-based**: a captured exchange, an OpenAPI file and client source text. The CLI never starts the application or a browser.
5. Exit code `2` means "checked and not OK" (ambiguous source, reconcile needed, contract violations); `1` is for usage and environment errors.
6. The `frontend-agent` package name, binaries and help text are unchanged; `dev-agent` is an additional bin in the same package, as §25 option A (keep `frontend-agent` as a compatibility alias) suggests for v1.0.

**Placeholder scan:** no TBD/TODO; every code and content step carries content (the one dead-code note in Task 2 tells the implementer to delete an empty block). **Type consistency:** `ApiContract`/`ContractType` (Task 1) are what Tasks 2, 3 and 6 consume; `Violation`/`VerifyResult` (Task 2) are reused by Task 3 and printed by Task 6; `CliError`/`projectRootOf` (Task 4) are imported by Tasks 5 and 6; the skill and reference names in Task 7 match the eval expectations in Task 8 (`skill/fullstack-contract`).

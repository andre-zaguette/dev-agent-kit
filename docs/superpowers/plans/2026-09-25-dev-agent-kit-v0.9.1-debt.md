# Dev Agent Kit v0.9.1 — Debt That Affects Real Use Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (inline, native). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the deferred review findings that change what a real user gets: a contract grammar that can describe real APIs, a `contract usage` that checks the method, clearer CLI errors, safer Git preparation and resume, and correct backend-reference detection. No new feature areas.

**Architecture:** Additive changes to `packages/core` (contract grammar, verifiers, usage, profile, git-prep, resume) and `packages/cli` (client scanning, messages). The contract grammar grows in a backward-compatible way: every existing contract still parses and verifies identically.

**Tech Stack:** TypeScript (ES2022, NodeNext), `node --test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-24-dev-agent-kit-evolution.md` — §12 (Git), §23 (contract), §25 (CLI), §26 (inspector), §43 (compatibility). Deferred findings: the v0.7.1, v0.8 and v0.9 review ledgers (recorded in the commit messages `a306179`, `5e10bc6`, `0803478` and in this plan's tasks).

## Global Constraints

- Backward compatibility (§43): every contract file that parsed before still parses and verifies to the same result; `frontend-agent`, the 27 older eval scenarios and the three fullstack scenarios stay untouched (their assertions still pass).
- Every fix carries a test that failed before the fix (RED then GREEN). Unbounded work stays bounded: no new regular expression is applied to untrusted input without a length cap.
- The CLI still never mutates Git, calls the network or runs a model.
- Commits: append the attribution trailer the session configures. Never `git reset --hard`, never force-push. The real benchmark is run by the user, not by this plan.

## Review Focus

1. Old contracts unchanged: the v0.9 contract fixtures and the `contract-format` example parse to deeply equal objects (Task 1).
2. Array and optional grammar edge cases: empty arrays, arrays of arrays, arrays with two elements, `a` and `a?` both present, optional keys on string types (Task 1).
3. `contract usage`: a POST contract with only GET callers is not "used"; `method:` from a previous call never confirms the next one (Task 2).
4. Git preparation with a remote not named `origin`, and with a merge/rebase/bisect/cherry-pick in progress (Task 4).
5. Detection false positives: `django-redis` alone, a Python `pika` import without Compose (Task 3).

---

### Task 1: Contract grammar — array bodies, arrays of objects, optional nested fields

**Files:**
- Modify: `packages/core/src/contract.ts`, `packages/core/src/contract-verify.ts`, `packages/core/src/contract-openapi.ts`
- Modify: `skills/fullstack-contract/references/contract-format.md`
- Test: append to `packages/core/tests/contract.test.ts`, `contract-verify.test.ts`, `contract-openapi.test.ts`

**Design (backward compatible):**
- `ContractType = string | ContractType[] | { [field: string]: ContractType }`. A **one-element array** means "array of that type": `["uuid"]`, `[{ "id": "uuid" }]`, `[["string"]]`.
- `request` and `response` may be a fields object (as before) **or** a one-element array (`"response": [{ "id": "uuid", "email": "email" }]` = the body is an array of those objects).
- A field key may end in `?` to mark it optional regardless of its value type: `"profile?": { "age": "integer" }`, `"items?": [{ "id": "uuid" }]`. A string type may still carry its own `?` (`"nickname": "string?"`); both forms mean optional. The parsed contract keeps the key exactly as written; consumers strip the `?` (export `fieldName(key)` and `isOptionalField(key, type)`).
- `a` and `a?` in the same object, an empty array `[]`, or an array with more than one element are errors.
- Depth counts arrays as a level (max 4 still applies), so no recursion beyond it.

**Interfaces:**
- `contract.ts` adds: `ContractBody = Record<string, ContractType> | [ContractType]`, `fieldName(key: string): string`, `isOptionalField(key: string, type: ContractType): boolean`; `ApiContract.request?: ContractBody`, `ApiContract.response: ContractBody`.
- Existing consumers that read `Object.keys(contract.response)` / `contract.request` must handle the array form (see steps).

- [ ] **Step 1: Write the failing tests** (concrete cases; write them as full tests following the file's existing helpers)

`contract.test.ts`:
- `parseContract` accepts `response: [{ id: 'uuid', email: 'email' }]`, `response: ['uuid']`, a field `tags: ['string']`, `users: [{ id: 'uuid', roles: ['string'] }]`, `'profile?': { age: 'integer' }`, `'items?': [{ id: 'uuid' }]`, `matrix: [['integer']]`; the parsed value deep-equals the input.
- Rejects: `response: []`, `response: [{a:'string'},{b:'string'}]`, `tags: []`, `{ a: 'string', 'a?': 'string' }`, `'bad name?': 'string'`, `'?': 'string'`, arrays nested 5 levels deep (`nested too deeply`), an array containing a number or `null`.
- Every contract object used by the v0.9 tests still `deepEqual`s after parsing (spot-check the spec example and the nested-object example).
- `fieldName('profile?') === 'profile'`, `fieldName('id') === 'id'`; `isOptionalField('profile?', {…}) === true`, `isOptionalField('nick', 'string?') === true`, `isOptionalField('id', 'uuid') === false`.

`contract-verify.test.ts`:
- A `GET /api/users` contract with `response: [{ id: 'uuid', email: 'email' }]`: an exchange with a valid array body passes; an empty array `[]` passes; `{}` body → error `type` "expected an array"; an element with a missing `email` → error `missing` with field `[1].email`; a non-uuid id → error `type` `[0].id`.
- Field `users: [{ id: 'uuid' }]`: valid, an element with wrong type → field `users[0].id`, a non-array → `type`.
- Field `tags: ['string']` accepts `['a']`, rejects `['a', 3]` at `tags[1]`.
- Optional nested key `'profile?': { age: 'integer' }`: absent → ok; `null` → ok; present and wrong → error at `profile.age`; present and valid → ok; not reported as `unexpected` when present.
- An array **request** body contract (`request: [{ id: 'uuid' }]`) is checked the same way; an empty `requestBody` array passes.
- `204` empty-body rule still works for `response: {}` and is not applied to array responses.

`contract-openapi.test.ts`:
- Array response: schema `{ type: 'array', items: { $ref: UserOut } }` verifies against `response: [{ id: 'uuid', … }]`; a schema that is an object (not array) → error `expected an array schema`; items missing a described property → `missing`.
- Field of array-of-objects: `users: [{ id: 'uuid' }]` against `{ type: 'array', items: { properties: { id: uuid } } }` passes; items with wrong type → error at `users[].id`.
- Optional nested key `'profile?'` maps to the OpenAPI property `profile` (name stripped), and its being absent from `required` produces no warning.

- [ ] **Step 2: Run to verify failure** — `node --import tsx --test packages/core/tests/contract*.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"`. Expected: the new cases fail; the old ones pass.

- [ ] **Step 3: Implement**

`contract.ts`:
- Types: `export type ContractType = string | ContractType[] | { [field: string]: ContractType }; export type ContractBody = Record<string, ContractType> | [ContractType];`
- Replace `parseFields` with `parseType(label, at, value, depth): ContractType` (string → `TYPE_RE`; array → exactly one element, recurse with `depth + 1`, error `must hold exactly one element type`; object → `parseFields`; anything else → error) and keep `parseFields(label, where, raw, depth): Record<string, ContractType>` using `parseType` for values. Key rule: strip one trailing `?` to get the base name, validate the base with `FIELD_RE` and the forbidden set; reject when the same base name appears twice (`a` and `a?`) with message `lists "<name>" twice (with and without ?)`.
- `parseBody(label, where, raw): ContractBody`: `Array.isArray(raw)` → a one-element array whose element passes `parseType(..., depth 1)`; otherwise `parseFields(..., 1)`. Use it for `request` and `response`.
- Depth: `parseType` on arrays checks `depth > MAX_DEPTH` before recursing.
- Export `fieldName` and `isOptionalField`.

`contract-verify.ts`:
- `checkValue(type, value, where, field, out)`: handle `Array.isArray(type)` first: `value` must be an array (else `type` error `${field || 'body'}: expected an array, got …`), then `checkValue(type[0], element, where, `${field}[${i}]`, out)` for each element. Keep string handling (`?` and `[]` suffix) and object handling as is.
- `checkObject`: iterate `Object.entries(schema)`: `name = fieldName(key)`; `optional = isOptionalField(key, type)`; presence test by `name`; unexpected-field detection compares against the set of stripped names.
- Where the body is verified: `contract.request` / `contract.response` may be an array → call `checkValue(body, value, …)` instead of `checkObject` when `Array.isArray(body)`. The 204 shortcut applies only when the response is a fields object with zero keys.

`contract-openapi.ts`:
- `typeCheck(doc, type, schema, where, field, out)`: add the array-type branch (schema kind must be `array`, then recurse on `s.items` with type `type[0]` and field `${field}[]`).
- `compareFields`: same key handling (`fieldName`, `isOptionalField`) — property lookup by stripped name; "required in the contract but optional in the description" warning only when not optional.
- `verifyOpenApi`: if `contract.request`/`contract.response` is an array, call `typeCheck` on the whole schema (with an empty `field`; messages then read `body[]…`), otherwise `compareFields` as before.

Reference `contract-format.md`: document array bodies, arrays of objects/primitives, optional keys, and the limits.

- [ ] **Step 4: Run** — `npm test --workspace=packages/core 2>&1 | grep -E "^ℹ (pass|fail)"; npm run typecheck --workspace=packages/core`. Expected: `fail 0`, clean. `grep -rn "Object.keys(contract\.\(request\|response\))" packages` must show no remaining unguarded use on a possibly-array body.
- [ ] **Step 5: Commit** — `git commit -m "core: contract grammar for array bodies, arrays of objects and optional nested fields"`.

---

### Task 2: `contract usage` checks the method per file; clearer client errors; safer scan

**Files:**
- Modify: `packages/core/src/contract-usage.ts`, `packages/core/src/contract-verify.ts` (`describe`), `packages/cli/src/dev-contract-commands.ts`, `packages/cli/src/dev-cli.ts` (help text)
- Test: `packages/core/tests/contract-usage.test.ts`, `packages/cli/tests/dev-contract-commands.test.ts`, `packages/core/tests/contract-verify.test.ts`

**Behavior:**
- `verifyClientUsage` reports per file. `files` lists only files where the route appears **and** the method is confirmed **in that file, for that occurrence**. A new field `pathOnlyFiles: string[]` lists files that mention the route without confirming the method. `used` = `files.length > 0`; `methodConfirmed` is kept as an alias of `used` for compatibility (same value).
- `confirms(method, before, after)`: the explicit `method: '…'` is read only from `after` (the text following the path, up to the closing of the call: stop at the first `)` that is not inside a string, capped at 300 chars); a `.post(`/`.get(` style call is read from `before` (the 40 characters preceding the path) or `after`'s start; a plain `fetch(` with no `method:` counts as GET only.
- Error codes: scan each file's text separately (no joining); report a code as unhandled if no scanned file contains it.
- CLI: a `--client` path that does not exist or is not a directory → exit 1 with `dev-agent: --client "<x>": not a directory inside the project`; `--client .` (or `./`) means the project root and is allowed; total scanned bytes are capped at 50 MB (exit 1 with a clear message when exceeded, `dev-agent: the client files are larger than 50 MB in total`).
- `describe(undefined)` → `undefined` (not `a undefined`). The dev-agent help notes that `install`/`verify` keep `frontend-agent`'s exit codes (1 when not OK).
- `contract usage` output: `files:` (confirmed), `path only:` (mentioned without the method), `unhandled error codes:`.

- [ ] **Step 1: Tests (RED)** — core: a POST contract and a client with only `axios.get('/api/users')` → `used: false`, `pathOnlyFiles: ['a.ts']`; two calls in one file (`fetch('/a', { method: 'POST' }); fetch('/api/users')`) → the `POST` belongs to `/a`, so `/api/users` (GET) does not confirm a POST contract; `axios.post('/api/users', b)` and `fetch('/api/users', { method: 'POST' })` confirm; a GET contract with `fetch('/api/users')` confirms; codes handled in a different file still count. CLI: `--client missing` and `--client file.ts` → exit 1 with the message; `--client .` works; default exit is now 2 when only a GET caller exists for a POST contract (previously 0); output has `path only:`. `describe`: an exchange with `responseBody: undefined` on an object contract reports `expected an object, got undefined`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** as described. In `dev-contract-commands.ts` build `ClientFile[]` while tracking total bytes; special-case `client === '.' || client === './'` to the project root; before scanning, `lstatSync(abs)` must be a directory.
- [ ] **Step 4: Run** the full cli and core suites, typecheck.
- [ ] **Step 5: Commit** — `git commit -m "cli: contract usage confirms the method per file; clearer --client errors and a scan cap"`.

---

### Task 3: Backend reference detection and reference content

**Files:**
- Modify: `packages/core/src/project-profile.ts`, `packages/core/src/backend-references.ts`
- Modify: `skills/data-modeling/references/postgresql.md`, `skills/backend-architecture/references/django.md`, `skills/auth-security/references/security.md`, `skills/backend-architecture/references/docker.md`
- Modify: `packages/evals/tests/catalog.test.ts` (fixture check)
- Test: `packages/core/tests/project-profile.test.ts`, `backend-references.test.ts`, `backend-references-coverage.test.ts`

**Changes:**
- Profile: RabbitMQ is also detected from a Python requirement `pika` or `aio-pika` and a Node dependency `amqplib` or `amqp-connection-manager`; Redis is also detected from the Python requirement `django-redis`. `queues` order stays `rabbitmq`, `celery`, `bullmq`.
- `selectBackendReferences`: the `openapi` hint reason becomes `"The framework can generate an OpenAPI description"`; DRF alone no longer implies `openapi` (DRF's schema support needs a separate tool) — `openapi` is added for `fastapi` and `nestjs`, and for `drf` only when `django` plus a project file mentioning `drf-spectacular` is not available to the selector, so the rule is: `fastapi` or `nestjs` only. (`drf` still gets `drf`, `django`, `security`.)
- `postgresql.md`: add that a failed `CREATE INDEX CONCURRENTLY` leaves an INVALID index that must be dropped before retrying, and to check `pg_index.indisvalid`.
- `django.md`: name `AddIndexConcurrently` (from `django.contrib.postgres.operations`) and `atomic = False` for concurrent index migrations.
- `security.md`: SSRF guidance made concrete: allowlist hosts or resolve the host and reject private, loopback and link-local ranges, re-check after every redirect, and set a timeout and a response size cap.
- `docker.md`: the published database port binds to `127.0.0.1` (`"127.0.0.1:5432:5432"`).
- Catalog test: also assert backend/fullstack fixtures contain no `.venv`, `venv`, `site-packages`, `__pycache__` or `vendor` directories.

- [ ] **Step 1: Tests (RED)** — profile: `pika` only in `requirements.txt` → `queues: ['rabbitmq']`; `django-redis` → `cache: 'redis'`; `amqplib` dependency → rabbitmq; none of them → undefined; selector: DRF-only profile has no `openapi`, FastAPI/Nest still do; reference content: `postgresql.md` mentions `indisvalid`, `django.md` mentions `AddIndexConcurrently` and `atomic = False`, `security.md` mentions `link-local` and `redirect`, `docker.md` contains `127.0.0.1:5432:5432`. The v0.8 coverage test's "every reference reachable" expectation still holds (`openapi` is reachable through `fastapi`).
- [ ] **Step 2–4:** implement, run the core and evals suites, `npm run validate:skills`.
- [ ] **Step 5: Commit** — `git commit -m "core: detect message and cache clients more accurately; sharper backend references"`.

---

### Task 4: Git preparation and resume — other remotes, in-progress operations, contained reads

**Files:**
- Modify: `packages/core/src/git.ts`, `packages/core/src/git-prep.ts`, `packages/core/src/resume.ts`, `packages/core/src/repo-memory.ts`
- Test: `packages/core/tests/git-prep.test.ts`, `packages/core/tests/resume.test.ts`, `packages/core/tests/repo-memory.test.ts`

**Changes:**
- `git.ts`: `detectBaseBranch(root, configured?, remote = 'origin')` reads `refs/remotes/<remote>/HEAD`. New `defaultRemote(root): string | undefined` → `origin` when it exists, else the only remote when exactly one exists, else undefined. New `operationInProgress(root): string | null` → one of `merge`, `rebase`, `cherry-pick`, `revert`, `bisect` (detected through `git rev-parse --git-path` for `MERGE_HEAD`, `rebase-merge`, `rebase-apply`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG`), else `null`.
- `git-prep.ts`: `remote = opts.remote ?? defaultRemote(root)`; when undefined behave as "no remote" (existing note). `detectBaseBranch` receives the remote. New failure reason `operation-in-progress` (checked right after the dirty-tree check, before anything is touched); the `notes` mention the remote actually used.
- `repo-memory.ts`: add `readKnowledgeIn(root: string, knowledgeDir: string, name: KnowledgeName): KnowledgeDoc | null` reading through `safeReadFile` (containment and symlink checks). `resume.ts` uses it instead of joining paths by hand; a symlinked knowledge directory is reported as a reason instead of being read.

- [ ] **Step 1: Tests (RED)** — a clone whose remote is named `upstream` is fetched and fast-forwarded (result `fetched: true`, note mentions `upstream`); two remotes, none named `origin` → treated as no remote with a note; each in-progress operation (create a merge conflict, a `git bisect start`, a stopped `cherry-pick`, a stopped rebase) makes `prepareTaskBranch` fail with `operation-in-progress` and leaves HEAD/branch/index as found; `checkResume` with `.dev-agent/knowledge` symlinked to another directory returns `ok: false` with a reason naming the symlink; `readKnowledgeIn` returns null for a missing file and throws on a symlinked parent.
- [ ] **Step 2–4:** implement, run the core suite and typecheck.
- [ ] **Step 5: Commit** — `git commit -m "core: git preparation supports other remotes and refuses in-progress operations; resume reads knowledge through containment"`.

---

### Task 5: Docs and v0.9.1 release

**Files:** `docs/fullstack.md` (array/optional grammar, per-file method check), `docs/cli.md` (`contract usage` output and exit codes, the `--client .` form), `README.md` (one sentence), version `0.9.0` → `0.9.1` (`packages/{cli,core,evals}/package.json`, lockfile, the two version assertions in `packages/cli/tests/`).

- [ ] **Step 1:** update the docs. **Step 2:** bump the version and `npm install --package-lock-only`.
- [ ] **Step 3: Run everything** — `npm test`, `npm run typecheck --workspaces --if-present`, `npm run validate:skills`, `npm run evals:validate` (30 scenarios). Expected: all green.
- [ ] **Step 4: Commit** — `git commit -m "chore: release v0.9.1 — debt that affects real use"`.

---

## Self-review

**Coverage of the deferred findings:** v0.9 minors 9 (per-file method), 10 (`--client` errors, `--client .`), 12 (grammar), 13 (`describe`, exit-code note, total-size cap) → Tasks 1–2; v0.8 minors 5 (`openapi` reason), 6 (detection), 7 (postgres/django notes), 8 (SSRF), 9 (docker port), 11 (`.venv` check) → Task 3; v0.7.1 minors 7 (other remote), 9 (in-progress operations), 10 (contained knowledge reads) → Task 4. **Deliberately left:** v0.7.1 minor 8 (`fetch --prune` runs before later refusals) — fetching is required to compare with the remote, and a refusal after it leaves only remote-tracking refs updated.

**Placeholder scan:** tests in this patch plan are specified as concrete inputs and expected results rather than pasted code; the executor writes them in the files' existing helper style and must watch each fail first.

**Type consistency:** `ContractBody`, `fieldName`, `isOptionalField` (Task 1) are the only new exports other tasks rely on; `UsageResult` gains `pathOnlyFiles` (Task 2) and keeps `methodConfirmed`; `operationInProgress`, `defaultRemote` (Task 4) are used only by `git-prep.ts`.

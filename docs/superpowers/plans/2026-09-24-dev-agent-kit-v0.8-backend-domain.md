# Dev Agent Kit v0.8 — Backend Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the backend domain on top of the shared core and the v0.7 orchestrator: ten framework-neutral backend skills, thirteen lazy-loaded stack/domain references, a deterministic reference selector driven by the project profile, and a backend eval suite (9 scenarios, 4 fixtures) — without changing any frontend behavior.

**Architecture:** Skills stay neutral and short (`SKILL.md` ≤ 60 lines, no framework names); all stack knowledge lives in `references/*.md` files that the agent loads only after detecting the repository's stack. `packages/core` gains `selectBackendReferences(profile)` so "which reference applies" is deterministic and never forces a technology the repository does not use. `packages/evals` learns two things: scenarios may omit a Figma fixture, and there is a `backend` category. No new installer, host adapter or benchmark harness.

**Tech Stack:** TypeScript (ES2022, NodeNext), `node --test` via `tsx`, Markdown skills/references, JSON eval scenarios, tiny non-installed fixture apps (Python and TypeScript source files only).

**Spec:** `docs/superpowers/specs/2026-09-24-dev-agent-kit-evolution.md` — §16 (v0.8), §17–22 (backend workflows), §28 (evals), §34 (backend DoD), §38 (v0.8 checklist), §43 (compatibility).

## Global Constraints

- Do not create a second installer, benchmark framework, skill synchronizer or host adapter (§2, §28). Backend evals reuse `packages/evals`.
- All new skills are top-level directories under `skills/` (§4). Framework details are lazy-loaded `references/`, never always-on instructions (§16).
- Backend `SKILL.md` files must not name any framework, ORM, queue, database, test runner or task-source product, and stay ≤ 60 lines. Enforced by a test (Task 3, extended in Task 4).
- Detect the repository first; never force Django, FastAPI, Nest, Celery, RabbitMQ, Redis, PostgreSQL or Docker into a project that does not use them (§16). Enforced by `selectBackendReferences` returning `[]` for a project with no backend signal.
- Reference file names are unique across the whole kit: the eval harness identifies a read reference by its file name only (`reference/<name>`). The thirteen new names must not collide with the eight frontend references (`angular`, `html-css-js`, `nextjs`, `nuxt`, `php`, `react`, `tailwind`, `vuejs`).
- Every reference follows the existing baseline format: frontmatter `name`, `description`, `status: baseline`, then the five sections `## Princípio`, `## Quando aplicar`, `## Quando não aplicar`, `## Exemplo`, `## Fonte` (validated by `npm run validate:skills`). Headings are Portuguese, content is English, like the frontend references.
- Production is read-only unless explicitly authorized; credentials, tokens and private keys never go into task ledgers or logs (§19, §22, §36). Skills state this; no code path writes production.
- Compatibility (§43): `frontend-agent install|verify`, the seven frontend skills, the v0.6/v0.7 skills, the MCP tool names, `.frontend-agent/config.yml` and the 18 existing eval scenarios stay untouched. `integrations/claude/CLAUDE.md` and `integrations/codex/AGENTS.md` are not modified.
- Imports between `src/` files use `.js` extensions; tests import `src/` with `.ts` (repo convention). Cross-package imports use relative paths.
- Commits: append the attribution trailer the session configures. Never `git reset --hard`, never force-push.
- The real benchmark is intentionally skipped by the user; do not run `npm run bench`. Scenarios are validated offline with `npm run evals:validate`.

## Review Focus

Failure modes the spec implies but no obvious task test would otherwise exercise (each pinned by a test in the owning task):

1. A repository with no backend signal (a React app, an empty folder, a Python script with no framework) → `selectBackendReferences` returns `[]`; nothing is recommended "just in case" (Task 1).
2. A reference name reused across skills, or colliding with a frontend reference → the harness would credit the wrong read (Task 6 uniqueness test).
3. A backend skill that quietly names a framework or grows past its budget, turning always-on text into stack bloat (Task 3, 4 neutrality and size tests).
4. A scenario without a Figma fixture → the loader must not demand one, the bench must not start the Figma mock for it, and the 18 existing scenarios must still load unchanged (Task 2).
5. Fixtures that need dependencies, a running service or a network to be understood, or that contain symlinks → scenarios are meant to be answerable from the files alone (Task 8).

---

### Task 1: Extend the project profile and add the backend reference selector

**Files:**
- Modify: `packages/core/src/project-profile.ts` (add `cache`, `queues`)
- Create: `packages/core/src/backend-references.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/project-profile.test.ts` (append), `packages/core/tests/backend-references.test.ts`

**Interfaces:**
- Changes `ProjectProfile` (additive): `cache?: string` (`'redis'`), `queues?: string[]` (every detected queue technology, in the order `rabbitmq`, `celery`, `bullmq`). `queue` keeps its current meaning (first detected).
- Produces (`backend-references.ts`): `interface ReferenceHint { skill: string; reference: string; reason: string }`; `selectBackendReferences(profile: ProjectProfile): ReferenceHint[]` — deterministic order, no duplicates, `[]` when the profile has no backend signal.

Backend signal = a framework in `django | drf | fastapi | nestjs | express`, or any detected queue.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/tests/project-profile.test.ts` (reuse that file's existing temp-dir helper; if it is named differently, use the same helper the neighboring tests use to build a project directory):

```ts
test('redis and every queue technology are detected, not just the first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dak-prof-'));
  try {
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\ndependencies = ["celery", "redis"]\n');
    writeFileSync(join(dir, 'docker-compose.yml'), 'services:\n  mq:\n    image: rabbitmq:3\n');
    const profile = detectProjectProfile(dir);
    assert.equal(profile.cache, 'redis');
    assert.deepEqual(profile.queues, ['rabbitmq', 'celery']);
    assert.equal(profile.queue, 'rabbitmq');
    const bare = mkdtempSync(join(tmpdir(), 'dak-prof-'));
    assert.equal(detectProjectProfile(bare).cache, undefined);
    assert.equal(detectProjectProfile(bare).queues, undefined);
    rmSync(bare, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

`packages/core/tests/backend-references.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectBackendReferences } from '../src/backend-references.ts';
import type { ProjectProfile } from '../src/project-profile.ts';

const profile = (over: Partial<ProjectProfile>): ProjectProfile => ({
  languages: [],
  frameworks: [],
  testCommands: [],
  lintCommands: [],
  typecheckCommands: [],
  docker: false,
  ...over
});
const refs = (p: ProjectProfile) => selectBackendReferences(p).map((h) => h.reference);

test('a project with no backend signal gets nothing, however much else it has', () => {
  assert.deepEqual(refs(profile({})), []);
  assert.deepEqual(refs(profile({ languages: ['typescript'], frameworks: ['react', 'tailwind'], docker: true })), []);
  assert.deepEqual(refs(profile({ languages: ['python'], database: 'postgresql', docker: true })), []);
});

test('a Django + DRF + PostgreSQL + Celery/RabbitMQ + Docker project gets its own references in a stable order', () => {
  const p = profile({
    languages: ['python'],
    frameworks: ['django', 'drf'],
    database: 'postgresql',
    queue: 'rabbitmq',
    queues: ['rabbitmq', 'celery'],
    cache: 'redis',
    docker: true
  });
  assert.deepEqual(refs(p), ['python', 'django', 'drf', 'openapi', 'postgresql', 'rabbitmq', 'celery', 'redis', 'docker', 'security']);
  const first = selectBackendReferences(p)[0];
  assert.deepEqual(first, { skill: 'backend-architecture', reference: 'python', reason: 'Python project' });
});

test('FastAPI and Nest projects get only what they use', () => {
  assert.deepEqual(refs(profile({ languages: ['python'], frameworks: ['fastapi'] })), ['python', 'fastapi', 'openapi', 'security']);
  assert.deepEqual(refs(profile({ languages: ['typescript'], frameworks: ['nestjs'], database: 'postgresql' })), ['node-typescript', 'nestjs', 'openapi', 'postgresql', 'security']);
  assert.deepEqual(refs(profile({ languages: ['javascript'], frameworks: ['express'] })), ['node-typescript', 'security']);
});

test('a queue alone is a backend signal, and a single legacy `queue` value still works', () => {
  assert.deepEqual(refs(profile({ languages: ['typescript'], queue: 'bullmq' })), ['security']);
  assert.deepEqual(refs(profile({ languages: ['python'], queue: 'celery' })), ['python', 'celery', 'security']);
});

test('every hint names a skill and a reason, and no reference repeats', () => {
  const hints = selectBackendReferences(profile({ languages: ['python'], frameworks: ['django', 'drf', 'fastapi'], queues: ['celery', 'rabbitmq'], queue: 'celery', docker: true }));
  for (const h of hints) assert.ok(h.skill && h.reason, JSON.stringify(h));
  assert.equal(new Set(hints.map((h) => h.reference)).size, hints.length);
});
```

Append `import`s as needed to the profile test (`detectProjectProfile`, `mkdtempSync`, `writeFileSync`, `rmSync`, `tmpdir`, `join` are probably already imported there).

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test packages/core/tests/backend-references.test.ts packages/core/tests/project-profile.test.ts 2>&1 | tail -15`
Expected: FAIL — `backend-references.ts` missing; profile has no `cache`/`queues`.

- [ ] **Step 3: Implement**

`packages/core/src/project-profile.ts`: add the two fields to `ProjectProfile`:

```ts
  cache?: string;
  queues?: string[];
```

and replace the existing `queue` detection block (the `const queue = ...` line and its `if (queue) profile.queue = queue;`) with:

```ts
  const queues = [
    /image:\s*["']?rabbitmq/.test(compose) ? 'rabbitmq' : undefined,
    mentions(pyText, 'celery') ? 'celery' : undefined,
    'bullmq' in deps ? 'bullmq' : undefined
  ].filter((q): q is string => q !== undefined);
  if (queues.length > 0) {
    profile.queue = queues[0];
    profile.queues = queues;
  }

  const cache = /image:\s*["']?redis/.test(compose) || 'redis' in deps || 'ioredis' in deps || 'bullmq' in deps || mentions(pyText, 'redis') ? 'redis' : undefined;
  if (cache) profile.cache = cache;
```

`packages/core/src/backend-references.ts`:

```ts
import type { ProjectProfile } from './project-profile.js';

export interface ReferenceHint {
  skill: string;
  reference: string;
  reason: string;
}

const BACKEND_FRAMEWORKS = ['django', 'drf', 'fastapi', 'nestjs', 'express'];

/**
 * Which backend references apply to this repository (spec §16: detect first, never force a
 * technology). Deterministic order, no duplicates, and an empty list when there is no backend signal.
 */
export function selectBackendReferences(profile: ProjectProfile): ReferenceHint[] {
  const has = (framework: string): boolean => profile.frameworks.includes(framework);
  const queues = profile.queues ?? (profile.queue ? [profile.queue] : []);
  if (!BACKEND_FRAMEWORKS.some(has) && queues.length === 0) return [];

  const out: ReferenceHint[] = [];
  const add = (skill: string, reference: string, reason: string): void => {
    if (!out.some((hint) => hint.reference === reference)) out.push({ skill, reference, reason });
  };
  const node = profile.languages.includes('typescript') || profile.languages.includes('javascript');

  if (profile.languages.includes('python')) add('backend-architecture', 'python', 'Python project');
  if (has('django')) add('backend-architecture', 'django', 'Django detected');
  if (has('drf')) add('api-design', 'drf', 'Django REST Framework detected');
  if (has('fastapi')) add('backend-architecture', 'fastapi', 'FastAPI detected');
  if (node && (has('nestjs') || has('express'))) add('backend-architecture', 'node-typescript', 'Node backend detected');
  if (has('nestjs')) add('backend-architecture', 'nestjs', 'NestJS detected');
  if (has('drf') || has('fastapi') || has('nestjs')) add('api-design', 'openapi', 'The framework publishes an OpenAPI description');
  if (profile.database === 'postgresql') add('data-modeling', 'postgresql', 'PostgreSQL detected');
  if (queues.includes('rabbitmq')) add('async-jobs', 'rabbitmq', 'RabbitMQ detected');
  if (queues.includes('celery')) add('async-jobs', 'celery', 'Celery detected');
  if (profile.cache === 'redis') add('async-jobs', 'redis', 'Redis detected');
  if (profile.docker) add('backend-architecture', 'docker', 'Docker/Compose files present');
  add('auth-security', 'security', 'Backend project: check authorization, input handling and secrets');
  return out;
}
```

`packages/core/src/index.ts`: append `export * from './backend-references.js';`

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test --workspace=packages/core 2>&1 | grep -E "^ℹ (pass|fail)"; npm run typecheck --workspace=packages/core`
Expected: `fail 0`, typecheck clean (existing project-profile tests still pass: `queue` keeps its meaning).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "core: detect every queue technology and redis; add the backend reference selector"
```

---

### Task 2: Evals — optional Figma fixture and the `backend` category

**Files:**
- Modify: `packages/evals/src/schema.ts`, `packages/evals/src/load.ts`, `packages/evals/src/bench.ts`, `packages/evals/src/cli.ts`
- Modify: `packages/evals/tests/schema.test.ts`, `packages/evals/tests/catalog.test.ts`, `packages/evals/tests/bench.test.ts`
- Test: same files

**Interfaces:**
- `CATEGORIES` becomes `['base', 'stack', 'profile', 'backend']`; `Category` follows.
- `ScenarioSchema.figma` becomes optional. A scenario with `figma` behaves exactly as before; one without it never touches `evals/figma/` and the bench starts only the `frontend-agent` MCP server for it.

- [ ] **Step 1: Write the failing tests**

In `packages/evals/tests/schema.test.ts` add (use the file's existing minimal-valid-scenario helper if there is one; otherwise inline the object):

```ts
test('a scenario may omit the Figma fixture, and the backend category is valid', () => {
  const base = {
    id: 'backend-x',
    category: 'backend',
    title: 'Backend scenario',
    fixture: 'django-app',
    prompt: 'Do the thing.',
    expected: [{ type: 'file_exists', path: 'a.py' }]
  };
  assert.equal(ScenarioSchema.safeParse(base).success, true);
  assert.equal(ScenarioSchema.safeParse({ ...base, figma: 'pricing' }).success, true);
  assert.equal(ScenarioSchema.safeParse({ ...base, figma: 'Not A Name' }).success, false);
  assert.equal(ScenarioSchema.safeParse({ ...base, category: 'nope' }).success, false);
});
```

In `packages/evals/tests/catalog.test.ts` change the first test to expect the backend count too. Until Task 8 adds the scenarios the backend count is 0, so write it as:

```ts
test('the catalog loads: 7 base, 8 stack, 3 profile, and any number of backend scenarios', () => {
  const scenarios = loadScenarios(layout);
  const count = (c: string) => scenarios.filter((s) => s.category === c).length;
  assert.deepEqual([count('base'), count('stack'), count('profile')], [7, 8, 3]);
});
```

In `packages/evals/tests/bench.test.ts`, read the existing test that runs a scenario through `runBench` with fake host binaries and records the MCP servers it was given. Add a sibling test that runs a scenario **without** `figma` (write a temporary evals directory the way that file already does for its other cases, with a scenario `figma` omitted and category `backend`) and asserts that the MCP configuration passed to the host lists exactly one server, `frontend-agent`, and that a scenario **with** `figma` still lists `frontend-agent` and `figma`.

- [ ] **Step 2: Run to verify failure**

Run: `npm test --workspace=packages/evals 2>&1 | grep -E "^ℹ (pass|fail)|not ok" | head`
Expected: FAIL — `figma` is required, `backend` is not a category.

- [ ] **Step 3: Implement**

`packages/evals/src/schema.ts`:

```ts
export const CATEGORIES = ['base', 'stack', 'profile', 'backend'] as const;
```
and
```ts
    figma: z.string().regex(NAME).optional(),
```

`packages/evals/src/load.ts` — wrap the whole Figma check (the `const figmaFile = …` through the closing brace of the `if/else if` chain) in `if (scenario.figma !== undefined) { … }` and use `scenario.figma` (now a definite string inside the block).

`packages/evals/src/bench.ts` — replace the `servers` array literal with:

```ts
    const servers: McpServerSpec[] = [{ name: 'frontend-agent', command: kit.command, args: kit.args, env: kit.env }];
    if (scenario.figma) {
      servers.push({
        name: 'figma',
        command: tsx,
        args: [path.join(opts.kitRoot, 'packages', 'evals', 'src', 'figma-mock', 'main.ts')],
        env: { FIGMA_MOCK_FIXTURE: path.join(layout.figmaDir, `${scenario.figma}.json`), FIGMA_MOCK_OUTPUT_ROOT: ws }
      });
    }
```

`packages/evals/src/cli.ts`: change the help text `--category base|stack|profile ...` to `--category base|stack|profile|backend ...`.

- [ ] **Step 4: Run tests, typecheck and the offline validator**

Run: `npm test --workspace=packages/evals 2>&1 | grep -E "^ℹ (pass|fail)"; npm run typecheck --workspace=packages/evals; npm run evals:validate 2>&1 | tail -1`
Expected: `fail 0`, typecheck clean, `ok: 18 scenarios` (the 18 existing scenarios are unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/evals
git commit -m "evals: optional Figma fixture and a backend scenario category"
```

---

### Task 3: Skills — backend-architecture, api-design, data-modeling, database-migrations

**Files:**
- Create: `skills/backend-architecture/SKILL.md`, `skills/api-design/SKILL.md`, `skills/data-modeling/SKILL.md`, `skills/database-migrations/SKILL.md`
- Create: `packages/core/tests/backend-skills.test.ts`

**Interfaces:**
- Produces: four installed skills. `backend-architecture` owns the §17 workflow and the §34 Definition of Done; `api-design` owns the §18 workflow; both point at `references/` for stack detail without naming any stack.

- [ ] **Step 1: Write the failing test**

`packages/core/tests/backend-skills.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const kitRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const BACKEND_SKILLS = ['backend-architecture', 'api-design', 'data-modeling', 'database-migrations'];
// Backend skills must not name a framework, ORM, queue, database, test runner, design tool or task-source product (spec §16, §27).
const FORBIDDEN =
  /\b(react|vue|nuxt|next\.js|angular|django|drf|fastapi|nestjs|express|flask|laravel|tailwind|figma|jira|linear|trello|asana|clickup|azure devops|claude code|codex|celery|rabbitmq|redis|postgres|postgresql|mysql|sqlalchemy|alembic|prisma|typeorm|pytest|jest|vitest)\b/i;
const MAX_LINES = 60;

for (const name of BACKEND_SKILLS) {
  test(`backend skill ${name}: valid frontmatter, neutral, compact`, () => {
    const text = readFileSync(join(kitRoot, 'skills', name, 'SKILL.md'), 'utf8');
    const front = text.match(/^---\nname: (.+)\ndescription: (.+)\n---\n/);
    assert.ok(front, 'frontmatter must be exactly name + one-line description');
    assert.equal(front![1], name);
    assert.match(front![2], /^.{40,400}$/);
    assert.doesNotMatch(text, FORBIDDEN);
    assert.ok(text.split('\n').length <= MAX_LINES, `${name} has more than ${MAX_LINES} lines; move detail into references/`);
  });
}

test('backend-architecture carries the backend Definition of Done and the pre-code checklist', () => {
  const text = readFileSync(join(kitRoot, 'skills', 'backend-architecture', 'SKILL.md'), 'utf8');
  for (const item of ['existing architecture followed', 'domain invariants protected', 'authorization checked', 'idempotency considered', 'migrations reviewed', 'sensitive data is not logged', 'final diff is task-scoped']) {
    assert.match(text, new RegExp(item, 'i'), item);
  }
  for (const concern of ['transaction boundary', 'concurrent writers', 'idempotency', 'unique constraints']) assert.match(text, new RegExp(concern, 'i'), concern);
});

test('api-design carries the API workflow and its Definition of Done', () => {
  const text = readFileSync(join(kitRoot, 'skills', 'api-design', 'SKILL.md'), 'utf8');
  for (const item of ['neighboring endpoints', 'error contract', 'request validated', 'status codes correct', 'runtime request verified']) assert.match(text, new RegExp(item, 'i'), item);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test packages/core/tests/backend-skills.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|ENOENT" | head -3`
Expected: FAIL — skill files do not exist.

- [ ] **Step 3: Write the skills**

`skills/backend-architecture/SKILL.md`:

```markdown
---
name: backend-architecture
description: Plan backend changes from the existing service architecture, domain invariants, transactions and concurrency before writing code, then verify against a Definition of Done. Use for any backend work item that adds or changes endpoints, jobs, persistence or integrations.
---

# Backend Architecture

Detect the repository's stack first (`repository-investigation`, `repo-memory`). Then load only the matching file from `references/`; never assume a stack the repository does not use.

## Workflow

1. Read the closest existing feature: entry point, domain logic, persistence, tests.
2. Model the data and the domain rules the change must protect.
3. Define the contract at the boundary: API, job message or integration.
4. Analyse transactions, concurrency and security before coding.
5. Implement, then static checks, tests, a runtime smoke test, and a `surgical-diff` review.

## Before coding, when applicable

- transaction boundary; concurrent writers; idempotency (can this run twice?)
- authorization; unique constraints; indexes
- retry policy; duplicate message processing; external API timeout
- rollback or forward-fix migration strategy

## Rules

- Follow the architecture that exists. A new layer, dependency or convention needs a reason the current ones cannot cover.
- Protect invariants at the boundary that owns the data, not in every caller.
- Production is read-only unless explicitly authorized. Never put credentials, tokens or keys in code, logs or the task ledger.

## Definition of Done

- [ ] existing architecture followed
- [ ] domain invariants protected
- [ ] request/message boundaries validated
- [ ] authorization checked
- [ ] concurrency considered
- [ ] idempotency considered
- [ ] migrations reviewed when applicable
- [ ] tests added/updated
- [ ] static checks pass
- [ ] runtime smoke test performed when practical
- [ ] external failure paths considered
- [ ] sensitive data is not logged
- [ ] final diff is task-scoped
```

`skills/api-design/SKILL.md`:

```markdown
---
name: api-design
description: Design and implement HTTP API changes that match the existing conventions, with explicit request, response and error contracts, authorization, idempotency and a real request as proof. Use when adding or changing an endpoint.
---

# API Design

Match the API that exists. Load the stack's file from `references/` after detecting the stack.

## Workflow

1. Inspect neighboring endpoints: naming, versioning, pagination, filtering.
2. Identify request/response conventions and the authentication and authorization pattern.
3. Define the request schema, the response schema and the error contract (status, code, shape).
4. Decide transaction, idempotency and concurrency needs.
5. Implement the domain behavior, then expose it at the API boundary.
6. Update the API description (OpenAPI or equivalent) when the project keeps one.
7. Add tests, start the application, make a real request when practical, and check the database side effects.

## Rules

- Validate at the boundary; never trust client-supplied identifiers, ownership fields or roles.
- One error shape for the whole API. Use the status codes the neighbors use for the same situations.
- Writes that clients may retry need an idempotency answer (key, natural unique constraint, or safe repeat).
- Never expose internal identifiers, stack traces or raw vendor errors.
- Prefer additive changes; a breaking change needs a version or a migration plan.

## Definition of Done

- [ ] request validated
- [ ] response contract verified
- [ ] status codes correct
- [ ] authentication checked
- [ ] resource authorization checked
- [ ] transaction/concurrency considered
- [ ] error path tested
- [ ] runtime request verified
```

`skills/data-modeling/SKILL.md`:

```markdown
---
name: data-modeling
description: Model tables, relations and constraints so the database enforces the domain rules, with indexes only for real query patterns. Use when adding or changing entities, columns, relations or queries against stored data.
---

# Data Modeling

Let the database enforce what it can. Load the database's file from `references/` when the repository uses one.

## Checklist

- primary and foreign keys; what happens to children on delete
- unique constraints for every natural key and every "only one of" rule
- nullability: null only when absence is a real state
- types and precision (money, time zones, identifiers)
- expected data volume and growth
- how the data is queried and written, and by whom

## Rules

- Model from the existing schema's conventions: naming, key types, timestamps, soft delete.
- Every new index maps to an observed or required query pattern. Do not add indexes blindly; each one costs writes and space.
- Constraints belong in the database and in validation; one without the other drifts.
- Store secrets and tokens hashed or encrypted, never in plain columns or logs.
- A model change that alters existing data needs `database-migrations`.
```

`skills/database-migrations/SKILL.md`:

```markdown
---
name: database-migrations
description: Write schema and data migrations that are safe to deploy: reviewed for locks, backfills, volume and rollback or forward-fix, using the repository's migration tool. Use whenever a change alters the database schema or existing rows.
---

# Database Migrations

Use the repository's migration tool and conventions. Never edit a migration that has already been applied elsewhere.

## Review before writing

- primary/foreign keys, unique constraints, nullability, indexes
- data volume: how many rows will this touch?
- backfill: does existing data need a value?
- lock risk: which operations block reads or writes, and for how long?
- transaction duration
- rollback, or a forward-fix plan when rollback is unsafe

## Safe patterns

- Expand, then contract: add the new column nullable or with a safe default, backfill in batches, switch the code, tighten the constraint later.
- Create indexes in the way the database supports without blocking writes when the table is large.
- Keep schema changes and large data backfills in separate migrations.
- Make the migration re-runnable or clearly one-way, and say which.

## Rules

- Do not add indexes blindly; tie each to a query pattern, and look at the query plan when the database offers one.
- Production stays read-only unless explicitly authorized. Run migrations against a disposable database and report what you ran.
- Verify: apply the migration to a real database, exercise the affected queries, and confirm the tool reports no pending changes.
```

- [ ] **Step 4: Run tests and validators**

Run: `node --import tsx --test packages/core/tests/backend-skills.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"; npm run validate:skills 2>&1 | tail -1`
Expected: `fail 0`; `validate-skill: all skills valid.`

- [ ] **Step 5: Commit**

```bash
git add skills packages/core/tests/backend-skills.test.ts
git commit -m "skills: backend-architecture, api-design, data-modeling and database-migrations"
```

---

### Task 4: Skills — backend-testing, auth-security, external-integrations, async-jobs, observability, backend-performance

**Files:**
- Create: `skills/{backend-testing,auth-security,external-integrations,async-jobs,observability,backend-performance}/SKILL.md`
- Modify: `packages/core/tests/backend-skills.test.ts` (extend the list and add content assertions)

- [ ] **Step 1: Extend the failing test**

In `packages/core/tests/backend-skills.test.ts` change the list to all ten and add:

```ts
export const BACKEND_SKILLS = [
  'backend-architecture',
  'api-design',
  'data-modeling',
  'database-migrations',
  'backend-testing',
  'auth-security',
  'external-integrations',
  'async-jobs',
  'observability',
  'backend-performance'
];
```

```ts
const has = (skill: string, terms: string[]) => {
  const text = readFileSync(join(kitRoot, 'skills', skill, 'SKILL.md'), 'utf8');
  for (const term of terms) assert.match(text, new RegExp(term, 'i'), `${skill}: ${term}`);
};

test('auth-security covers the spec §22 checklist and the no-credentials rule', () => {
  has('auth-security', ['BOLA|IDOR', 'mass assignment', 'SQL injection', 'command injection', 'unsafe deserialization', 'SSRF', 'secret', 'unsafe upload', 'rate limit', 'CORS', 'CSRF', 'sensitive logging', 'ledger']);
});

test('async-jobs covers the spec §20 checklist and assumes at-least-once delivery', () => {
  has('async-jobs', ['message schema', 'ack', 'retry', 'dead-letter', 'idempotency', 'ordering', 'poison', 'at-least-once']);
});

test('external-integrations covers the spec §21 checklist and boundary normalization', () => {
  has('external-integrations', ['timeout', 'retryable', '429', '5xx', 'auth refresh', 'schema drift', 'idempotency', 'partial failure', 'normalize']);
});

test('backend-testing, observability and backend-performance state their core rules', () => {
  has('backend-testing', ['error path', 'real database', 'concurren', 'runtime']);
  has('observability', ['structured', 'correlation', 'sensitive']);
  has('backend-performance', ['measure', 'N\\+1', 'pagination', 'timeout']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test packages/core/tests/backend-skills.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|ENOENT" | head -3`
Expected: FAIL — six skills missing.

- [ ] **Step 3: Write the skills**

`skills/backend-testing/SKILL.md`:

```markdown
---
name: backend-testing
description: Test backend behavior at its boundaries, including error paths, authorization, concurrency and idempotency, against real infrastructure when practical. Use when adding or changing backend behavior, or when a backend test is missing, flaky or too mocked.
---

# Backend Testing

Prove behavior, not implementation. Use the repository's test runner, fixtures and layout.

## What to cover

- The happy path through the real boundary (HTTP, message, command).
- Each error path: invalid input, unauthenticated, unauthorized, not found, conflict, dependency failure.
- Authorization on the specific resource, not just "logged in".
- Concurrency and idempotency where writes can repeat or race: run the operation twice and assert one effect.
- Database side effects: rows written, constraints enforced, transactions rolled back on failure.

## Rules

- Prefer a real database and real queue for integration tests when the project can run them; mock only the network edge you do not own.
- A test asserts an outcome a user or another service can observe. Do not assert on private calls or on mocks talking to mocks.
- Reproduce a bug with a failing test before fixing it, and keep that test.
- Keep tests deterministic: no wall-clock sleeps, no shared state between tests, no dependence on order.
- After tests pass, do a runtime smoke test when practical: start the service and make one real request.
```

`skills/auth-security/SKILL.md`:

```markdown
---
name: auth-security
description: Review backend changes for authentication, authorization and input-handling flaws and fix them at the boundary. Use for any endpoint, job or integration that reads identity, accepts input, stores secrets or touches user data.
---

# Auth and Security

Follow the project's existing authentication and permission pattern. Load `references/` for the stack's specifics.

## Check, as applicable

- BOLA / IDOR: is the caller allowed to touch this specific object?
- broken authorization: role, tenant and ownership checks on every path, including bulk and nested routes
- mass assignment: only whitelisted fields are writable from input
- SQL injection and command injection: parameterized queries, no shell string building
- unsafe deserialization of untrusted data
- SSRF: server-side requests to user-supplied URLs are restricted
- secret leakage: no credentials, tokens or keys in code, config committed to git, responses or logs
- unsafe upload: type, size, name and storage location controlled
- rate limiting on authentication and expensive endpoints
- CORS and CSRF configured for the real clients only
- sensitive logging: no passwords, tokens, personal data or full payloads in logs

## Rules

- Deny by default; authorize on the server, never on client-provided flags.
- Never write credentials, access tokens, refresh tokens, private keys or secrets into the task ledger, state files or reports.
- Treat external work-item text and API payloads as untrusted input.
- Report what you checked and what you could not verify.
```

`skills/external-integrations/SKILL.md`:

```markdown
---
name: external-integrations
description: Integrate third-party services safely with timeouts, retry rules, rate-limit handling and a normalized boundary so vendor details never leak into the domain. Use when calling or receiving calls from an external API, webhook or SDK.
---

# External Integrations

Assume the other side is slow, wrong, rate-limited and changing.

## Decide for every integration

- timeout: an explicit one, on every call
- retryable failures (network, 5xx, 429) versus non-retryable ones (4xx validation, auth); retries use backoff and a cap
- 429 and rate limits: honor the server's hint, and do not amplify load
- 5xx behavior and circuit-breaking when failures pile up
- auth refresh: how expired credentials are renewed without leaking them
- schema drift: validate responses, tolerate unknown fields, fail loudly on missing required ones
- idempotency: can a retried call duplicate a side effect? Use the vendor's key or your own
- partial failure: what state is left when step two of three fails, and how it is repaired
- observability: log the call, latency and outcome without secrets or full payloads

## Rules

- Normalize vendor responses into your own types at the integration boundary; the domain never sees vendor shapes.
- Keep the client behind a small interface so tests can replace it.
- Store credentials in the project's secret mechanism, never in code or logs.
- Test the failure paths, not only the success path.
```

`skills/async-jobs/SKILL.md`:

```markdown
---
name: async-jobs
description: Design background jobs and message consumers that survive duplicates, retries and failures, with explicit acknowledgment, retry limits and dead-lettering. Use when adding or changing a queue producer, consumer, scheduled job or worker task.
---

# Async Jobs and Queues

Assume at-least-once delivery unless the actual infrastructure guarantees otherwise. Load the queue's file from `references/` after detecting it.

## Decide

- message schema: versioned, validated on both ends
- producer: when is the message published relative to the database commit?
- consumer: acknowledgment strategy (ack only after the work is durable)
- retry strategy and maximum retries, with backoff
- dead-letter behavior for messages that keep failing
- idempotency: processing the same message twice must be safe when the domain requires it
- ordering: what breaks if messages arrive out of order?
- poison messages: how a bad message is isolated instead of blocking the queue
- observability: message id, attempt count, duration, outcome

## Rules

- Never do work and acknowledge in the wrong order: acknowledging first loses messages, acknowledging never duplicates them.
- Make handlers idempotent with a natural key or a processed-message record, not with hope.
- Keep payloads small: identifiers and versions, not whole objects that may go stale.
- Test the retry and duplicate paths, not only the first delivery.
```

`skills/observability/SKILL.md`:

```markdown
---
name: observability
description: Add logs, metrics and traces that explain what a backend did and why it failed, without leaking sensitive data. Use when adding new backend flows, failure handling, jobs or integrations, or when a failure cannot be diagnosed from what is logged.
---

# Observability

Make the next failure diagnosable from the outside.

## Do

- Use the project's logger and its structured format; one event per fact, with named fields.
- Carry a correlation or request identifier through calls, jobs and outgoing requests when the project has one.
- Log the decision points and failures: what was attempted, the identifiers involved, the outcome, the error class and message.
- Count and time what matters: requests, errors, latency, queue depth, retries, dead-lettered messages, when the project exposes metrics.
- Keep log levels meaningful: errors for actionable failures, not for expected validation rejections.

## Never log

- passwords, tokens, keys, session identifiers, authorization headers
- personal or payment data, full request or response bodies
- anything you would not paste into a public ticket

## Rules

- Do not add a logging or metrics library the project does not use.
- Log once at the boundary that handles the error; do not log and rethrow at every layer.
```

`skills/backend-performance/SKILL.md`:

```markdown
---
name: backend-performance
description: Find and fix backend slowness by measuring first, then addressing queries, round trips, payload size and missing timeouts. Use when a backend path is slow, a query plan looks wrong, or before adding caching or indexes.
---

# Backend Performance

Measure, change one thing, measure again.

## Look for

- N+1 queries and per-item round trips; load related data in bulk
- unbounded result sets: pagination and limits on every list
- missing or unused indexes, checked against the actual query plan when the database offers one
- work done inside a transaction that does not need to be, holding locks longer than necessary
- large payloads and serialization cost
- missing timeouts on calls to other services and the database
- repeated work that could be computed once

## Rules

- No optimization without a measurement that shows the problem; record before and after.
- Do not add indexes blindly. Each index maps to an observed query pattern and costs write time.
- A cache needs an owner, an expiry and an invalidation rule; say what happens when it is stale.
- Preserve behavior: performance work keeps the same tests green and adds one for the case that was slow.
- Production stays read-only. Reproduce on disposable data.
```

- [ ] **Step 4: Run tests and validators**

Run: `node --import tsx --test packages/core/tests/backend-skills.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"; npm run validate:skills 2>&1 | tail -1; npm test --workspace=packages/core 2>&1 | grep -E "^ℹ fail"`
Expected: all pass. If a skill trips the neutrality regex on an ordinary English word (for example "linear" or "express" used as a verb), reword the sentence rather than loosening the test. The context audit's per-skill token budget (2500 tokens) is far above these sizes.

- [ ] **Step 5: Commit**

```bash
git add skills packages/core/tests/backend-skills.test.ts
git commit -m "skills: backend-testing, auth-security, external-integrations, async-jobs, observability, backend-performance"
```

---

### Task 5: References — stack references under backend-architecture

**Files:**
- Create: `skills/backend-architecture/references/{python,django,fastapi,node-typescript,nestjs,docker}.md`

Baseline format: frontmatter with `name`, `description`, `status: baseline`, then the five Portuguese-headed sections. `npm run validate:skills` is the test for this task (it rejects a missing section or status).

- [ ] **Step 1: Run the validator to see the gap**

Run: `npm run validate:skills 2>&1 | tail -2`
Expected: passes now (no files yet). After Step 2 it must still pass; to prove the validator would catch a defect, temporarily delete the `## Fonte` section of one new file, run it (expected: `missing section "## Fonte"`), and restore it.

- [ ] **Step 2: Write the references**

`skills/backend-architecture/references/python.md`:

```markdown
---
name: python
description: Baseline conventions for Python backend work: layout, typing, tooling, configuration and testing.
status: baseline
---

## Princípio

Keep Python services boring and explicit: typed function signatures, a clear split between I/O boundaries and pure domain logic, configuration from the environment, and the project's own tools for tests, linting and types.

## Quando aplicar

Any repository with `pyproject.toml`, `requirements*.txt` or `manage.py` that carries backend code.

## Quando não aplicar

Frontend-only repositories, or projects in another language. Do not introduce `mypy`, `ruff` or a formatter the repository does not already use.

## Exemplo

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class Reservation:
    item_id: int
    quantity: int

    def __post_init__(self) -> None:
        if self.quantity <= 0:
            raise ValueError("quantity must be positive")
```

Run what the project defines: the test command from its config (`pytest`, `make test`), then its linter and type checker if configured. Read settings from environment variables, never from committed secrets. Prefer the standard library and dependencies already in the lockfile.

## Fonte

Python documentation and PEP 8/PEP 484 general conventions; refined per project by its own tooling configuration.
```

`skills/backend-architecture/references/django.md`:

```markdown
---
name: django
description: Baseline conventions for Django backend work: apps, models, querysets, transactions, settings and migrations.
status: baseline
---

## Princípio

Follow Django's layering: models own data rules and constraints, querysets and managers own queries, views stay thin, and every schema change is a migration.

## Quando aplicar

Projects with `manage.py` or `django` in their requirements.

## Quando não aplicar

Non-Django Python services. For REST endpoints on Django also load `drf.md`.

## Exemplo

```python
from django.db import models, transaction


class Note(models.Model):
    owner = models.ForeignKey("auth.User", on_delete=models.CASCADE, related_name="notes")
    title = models.CharField(max_length=200)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["owner", "title"], name="uniq_note_title_per_owner")]


def archive(note: Note) -> None:
    with transaction.atomic():
        locked = Note.objects.select_for_update().get(pk=note.pk)
        locked.archived_at = locked.archived_at or timezone.now()
        locked.save(update_fields=["archived_at"])
```

Use `select_related`/`prefetch_related` to avoid N+1 queries, `transaction.atomic()` around multi-step writes, `select_for_update()` for contended rows, and constraints in `Meta` instead of only in forms. Create migrations with `makemigrations`, review the generated file, and never edit one that shipped.

## Fonte

Django documentation (models, transactions, migrations); refined per project conventions.
```

`skills/backend-architecture/references/fastapi.md`:

```markdown
---
name: fastapi
description: Baseline conventions for FastAPI services: routers, Pydantic schemas, dependencies, sessions and error handling.
status: baseline
---

## Princípio

Keep routers thin: validate with Pydantic schemas, get collaborators through dependencies, put domain logic in services, and turn domain errors into one consistent HTTP error shape.

## Quando aplicar

Projects that list `fastapi` as a dependency.

## Quando não aplicar

Other Python web frameworks. Do not add SQLAlchemy, Alembic or Pydantic settings if the project does not already use them.

## Exemplo

```python
from fastapi import APIRouter, Depends, HTTPException, status

router = APIRouter(prefix="/items", tags=["items"])


@router.post("/{item_id}/reserve", response_model=ReservationOut, status_code=status.HTTP_201_CREATED)
def reserve(item_id: int, body: ReserveIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return reservations.reserve(db, user=user, item_id=item_id, quantity=body.quantity)
    except reservations.OutOfStock:
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "OUT_OF_STOCK"})
```

Use `response_model` so responses are filtered and documented, dependencies for authentication and database sessions, and explicit status codes. Commit or roll back the session in one place. FastAPI generates the OpenAPI description; keep schemas accurate instead of maintaining a second document.

## Fonte

FastAPI documentation (dependencies, response models, error handling); refined per project conventions.
```

`skills/backend-architecture/references/node-typescript.md`:

```markdown
---
name: node-typescript
description: Baseline conventions for Node.js backend work in TypeScript: strictness, async code, validation, configuration and tooling.
status: baseline
---

## Princípio

Type the boundaries, validate untrusted input at runtime, keep async code explicit, and use the toolchain the project already has for tests, lint and type checking.

## Quando aplicar

Node backends (NestJS, Express or plain) with `package.json` and, usually, `tsconfig.json`.

## Quando não aplicar

Frontend projects or other runtimes. Do not add a validation, ORM or test library the project does not use.

## Exemplo

```ts
export async function reserve(repo: ItemRepo, input: unknown): Promise<Reservation> {
  const { itemId, quantity } = parseReserveInput(input); // throws a typed validation error
  return repo.transaction(async (tx) => {
    const item = await tx.lock(itemId);
    if (item.stock < quantity) throw new OutOfStockError(itemId);
    return tx.save({ itemId, quantity });
  });
}
```

Never trust `req.body` types: validate at runtime. Handle promise rejections (no floating promises), set timeouts on outbound calls, keep configuration in environment variables, and run the project's `test`, `lint` and `typecheck` scripts (`tsc --noEmit`).

## Fonte

Node.js and TypeScript documentation; refined per project `tsconfig` and scripts.
```

`skills/backend-architecture/references/nestjs.md`:

```markdown
---
name: nestjs
description: Baseline conventions for NestJS services: modules, controllers, providers, DTO validation, guards and testing.
status: baseline
---

## Princípio

Follow Nest's structure: a module per feature, thin controllers, providers for logic and data access, DTOs validated by pipes, and guards for authentication and authorization.

## Quando aplicar

Projects depending on `@nestjs/core`.

## Quando não aplicar

Plain Express or other Node frameworks. Load `node-typescript.md` as well for general Node conventions.

## Exemplo

```ts
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post(':id/deactivate')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('admin')
  deactivate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeactivateUserDto) {
    return this.users.deactivate(id, dto);
  }
}

export class DeactivateUserDto {
  @IsString() @MaxLength(200) reason!: string;
}
```

Register providers in the feature module, validate DTOs with a global `ValidationPipe` (`whitelist: true`), map domain errors to exceptions in a filter, and test controllers with `Test.createTestingModule` plus the project's runner. Nest publishes an OpenAPI description through its Swagger module when the project uses it.

## Fonte

NestJS documentation (modules, pipes, guards, testing); refined per project conventions.
```

`skills/backend-architecture/references/docker.md`:

```markdown
---
name: docker
description: Baseline conventions for Docker and Compose in backend projects: images, local services, configuration and safe use during development.
status: baseline
---

## Princípio

Use containers to reproduce the runtime and its dependencies locally, keep images small and configuration external, and never bake secrets into an image or a committed Compose file.

## Quando aplicar

Repositories with a `Dockerfile` or a Compose file, or when you need a disposable database or broker to test against.

## Quando não aplicar

Projects that do not use containers: do not add a Dockerfile or Compose file as part of an unrelated task.

## Exemplo

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      retries: 10
```

Take passwords from the environment or an ignored `.env` file. Use health checks so dependent services wait for readiness. Use the project's existing Compose service names when running smoke tests, and treat any database reached this way as disposable: production stays read-only.

## Fonte

Docker and Compose documentation; refined per project files.
```

- [ ] **Step 3: Run the validator and the core suite**

Run: `npm run validate:skills 2>&1 | tail -1; npm test --workspace=packages/core 2>&1 | grep -E "^ℹ fail"`
Expected: `validate-skill: all skills valid.`; core `fail 0`.

- [ ] **Step 4: Commit**

```bash
git add skills
git commit -m "skills: backend-architecture references for python, django, fastapi, node-typescript, nestjs and docker"
```

---

### Task 6: References — api-design, data-modeling, async-jobs, auth-security; coverage tests

**Files:**
- Create: `skills/api-design/references/{drf,openapi}.md`, `skills/data-modeling/references/postgresql.md`, `skills/async-jobs/references/{rabbitmq,celery,redis}.md`, `skills/auth-security/references/security.md`
- Test: `packages/core/tests/backend-references-coverage.test.ts`

**Interfaces:**
- Consumes: `selectBackendReferences`, `ReferenceHint` (Task 1); the six references from Task 5.

- [ ] **Step 1: Write the failing test**

`packages/core/tests/backend-references-coverage.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { selectBackendReferences } from '../src/backend-references.ts';
import type { ProjectProfile } from '../src/project-profile.ts';

const kitRoot = fileURLToPath(new URL('../../../', import.meta.url));
const skillsDir = join(kitRoot, 'skills');
const BACKEND = ['backend-architecture', 'api-design', 'data-modeling', 'database-migrations', 'backend-testing', 'auth-security', 'external-integrations', 'async-jobs', 'observability', 'backend-performance'];
const EXPECTED = ['python', 'django', 'drf', 'fastapi', 'node-typescript', 'nestjs', 'postgresql', 'redis', 'rabbitmq', 'celery', 'docker', 'openapi', 'security'];

const referencesOf = (skill: string): string[] => {
  const dir = join(skillsDir, skill, 'references');
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')) : [];
};

test('the thirteen backend references exist under the skills that own them', () => {
  const found = BACKEND.flatMap((skill) => referencesOf(skill).map((name) => `${skill}/${name}`));
  assert.deepEqual(
    found.map((f) => f.split('/')[1]).sort(),
    [...EXPECTED].sort()
  );
});

test('reference names are unique across the whole kit, so a read identifies exactly one file', () => {
  const all = readdirSync(skillsDir).flatMap((skill) => referencesOf(skill));
  assert.equal(new Set(all).size, all.length, `duplicate reference names: ${all.filter((n, i) => all.indexOf(n) !== i).join(', ')}`);
});

test('every reference frontmatter name matches its file name and is marked baseline', () => {
  for (const skill of BACKEND) {
    for (const name of referencesOf(skill)) {
      const text = readFileSync(join(skillsDir, skill, 'references', `${name}.md`), 'utf8');
      assert.match(text, new RegExp(`^---\\nname: ${name}\\ndescription: .{20,300}\\nstatus: baseline\\n---\\n`), `${skill}/${name}`);
    }
  }
});

const everything: ProjectProfile = {
  languages: ['python', 'typescript'],
  frameworks: ['django', 'drf', 'fastapi', 'nestjs', 'express'],
  database: 'postgresql',
  queue: 'rabbitmq',
  queues: ['rabbitmq', 'celery', 'bullmq'],
  cache: 'redis',
  docker: true,
  testCommands: [],
  lintCommands: [],
  typecheckCommands: []
};

test('every hint the selector can produce points at a real file, and every reference is reachable', () => {
  const hints = selectBackendReferences(everything);
  for (const hint of hints) assert.ok(existsSync(join(skillsDir, hint.skill, 'references', `${hint.reference}.md`)), `${hint.skill}/${hint.reference}`);
  assert.deepEqual(hints.map((h) => h.reference).sort(), [...EXPECTED].sort());
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test packages/core/tests/backend-references-coverage.test.ts 2>&1 | grep -E "^ℹ (pass|fail)" | head -3`
Expected: FAIL — seven references are still missing.

- [ ] **Step 3: Write the references**

`skills/api-design/references/drf.md`:

```markdown
---
name: drf
description: Baseline conventions for Django REST Framework: serializers, viewsets, permissions, querysets and pagination.
status: baseline
---

## Princípio

Let serializers validate and shape data, viewsets hold the request flow, permission classes enforce authorization, and `get_queryset` scope every query to what the caller may see.

## Quando aplicar

Projects with `djangorestframework` in their requirements.

## Quando não aplicar

Plain Django views or other REST stacks. Load `django.md` too for model and migration conventions.

## Exemplo

```python
class IsOwner(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        return obj.owner_id == request.user.id


class NoteViewSet(viewsets.ModelViewSet):
    serializer_class = NoteSerializer
    permission_classes = [permissions.IsAuthenticated, IsOwner]

    def get_queryset(self):
        return Note.objects.filter(owner=self.request.user)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)
```

Scope the queryset by owner so a wrong id is a 404, not a leak; set `owner` from `request.user`, never from the payload (`read_only_fields`); list `fields` explicitly instead of `__all__` to avoid mass assignment. Add custom actions with `@action`, and test permissions with an authenticated non-owner.

## Fonte

Django REST Framework documentation (serializers, permissions, viewsets); refined per project conventions.
```

`skills/api-design/references/openapi.md`:

```markdown
---
name: openapi
description: Baseline conventions for keeping an OpenAPI description accurate: schemas, error responses, versioning and generated documents.
status: baseline
---

## Princípio

The OpenAPI description is a contract: keep it generated from code where the framework can, otherwise edit it with the change, and make it show every success and error response.

## Quando aplicar

Projects that publish or consume an OpenAPI/Swagger description, or frameworks that generate one.

## Quando não aplicar

Projects with no API description: do not introduce a tool or a spec file as a side effect of an endpoint change.

## Exemplo

```yaml
paths:
  /items/{id}/reserve:
    post:
      requestBody:
        content:
          application/json:
            schema: { $ref: '#/components/schemas/ReserveIn' }
      responses:
        '201': { description: Reserved, content: { application/json: { schema: { $ref: '#/components/schemas/ReservationOut' } } } }
        '404': { $ref: '#/components/responses/NotFound' }
        '409': { $ref: '#/components/responses/Conflict' }
```

Reuse shared error schemas, describe authentication once in `securitySchemes`, avoid leaking internal fields, and regenerate or diff the document after the change. Treat a removed field or a changed type as a breaking change.

## Fonte

OpenAPI Specification 3.x; refined per project tooling.
```

`skills/data-modeling/references/postgresql.md`:

```markdown
---
name: postgresql
description: Baseline conventions for PostgreSQL: types, constraints, indexes, query plans and safe schema changes.
status: baseline
---

## Princípio

Use the database's strengths: precise types, constraints that enforce the domain, indexes chosen from query plans, and schema changes that avoid long locks.

## Quando aplicar

Projects using PostgreSQL directly or through an ORM.

## Quando não aplicar

Other databases, or SQL that must stay portable. Do not add extensions the project does not already use.

## Exemplo

```sql
ALTER TABLE notes ADD COLUMN archived_at timestamptz;

CREATE INDEX CONCURRENTLY notes_owner_active_idx
    ON notes (owner_id)
    WHERE archived_at IS NULL;

EXPLAIN ANALYZE
SELECT id, title FROM notes WHERE owner_id = 42 AND archived_at IS NULL ORDER BY id LIMIT 50;
```

Use `timestamptz` for instants, `numeric` for money, `uuid` or `bigint` keys as the project does. `CREATE INDEX CONCURRENTLY` avoids blocking writes (it cannot run inside a transaction block, so the migration tool needs an option for it). Adding a nullable column is cheap; adding a column with a volatile default or a `NOT NULL` without a default rewrites or fails. Check the plan with `EXPLAIN` (and `EXPLAIN ANALYZE` on disposable data) before and after adding an index.

## Fonte

PostgreSQL documentation (data types, indexes, ALTER TABLE, EXPLAIN); refined per project conventions.
```

`skills/async-jobs/references/rabbitmq.md`:

```markdown
---
name: rabbitmq
description: Baseline conventions for RabbitMQ consumers and producers: acknowledgments, dead-lettering, retries and idempotency.
status: baseline
---

## Princípio

Acknowledge a message only after its work is durable, route failures to a dead-letter exchange after a bounded number of attempts, and make handlers safe against redelivery.

## Quando aplicar

Projects that use RabbitMQ directly (a client library) or through a framework.

## Quando não aplicar

Other brokers, or a task framework that already manages acknowledgments for you: read its reference instead of duplicating its behavior.

## Exemplo

```python
def on_message(channel, method, properties, body):
    message = OrderMessage.model_validate_json(body)
    try:
        with db.transaction():
            if processed.exists(message.id):
                return channel.basic_ack(method.delivery_tag)
            handle(message)
            processed.add(message.id)
        channel.basic_ack(method.delivery_tag)
    except RetryableError:
        channel.basic_nack(method.delivery_tag, requeue=False)  # dead-letter or delayed retry queue
    except Exception:
        channel.basic_reject(method.delivery_tag, requeue=False)  # poison message

channel.queue_declare("orders", durable=True, arguments={"x-dead-letter-exchange": "orders.dlx"})
channel.basic_qos(prefetch_count=10)
```

Declare queues durable, publish persistent messages, keep a prefetch limit, use manual acknowledgments, and record the message id you processed. Never requeue a failing message in a tight loop; use a dead-letter exchange with a delay or a retry cap.

## Fonte

RabbitMQ documentation (reliability, acknowledgments, dead-letter exchanges); refined per project conventions.
```

`skills/async-jobs/references/celery.md`:

```markdown
---
name: celery
description: Baseline conventions for Celery tasks: retries, acknowledgment timing, idempotency, serialization and time limits.
status: baseline
---

## Princípio

Tasks must be idempotent and small: pass identifiers, retry only failures that can succeed later, bound run time, and let late acknowledgment cover a crashed worker.

## Quando aplicar

Projects with `celery` in their requirements.

## Quando não aplicar

Direct broker consumers written without Celery: use the broker's reference. Do not change a project's broker or result backend as part of a task.

## Exemplo

```python
@shared_task(
    bind=True,
    acks_late=True,
    autoretry_for=(TemporaryError,),
    retry_backoff=True,
    retry_backoff_max=300,
    max_retries=5,
    soft_time_limit=60,
)
def send_invoice(self, invoice_id: int) -> None:
    invoice = Invoice.objects.get(pk=invoice_id)
    if invoice.sent_at:
        return  # idempotent: a duplicate delivery is a no-op
    deliver(invoice)
    Invoice.objects.filter(pk=invoice_id, sent_at__isnull=True).update(sent_at=timezone.now())
```

Enqueue after the transaction commits (`transaction.on_commit`), pass ids not objects, use JSON serialization, and test with eager mode plus a test that runs the task twice.

## Fonte

Celery documentation (tasks, retrying, reliability); refined per project conventions.
```

`skills/async-jobs/references/redis.md`:

```markdown
---
name: redis
description: Baseline conventions for Redis as cache, lock or queue backend: keys, expiry, atomic operations and failure behavior.
status: baseline
---

## Princípio

Treat Redis as fast, volatile shared state: every key has an owner and an expiry, multi-step changes use atomic operations, and the application keeps working, degraded, when Redis is down.

## Quando aplicar

Projects using Redis as a cache, lock, rate limiter or queue backend.

## Quando não aplicar

Durable data: Redis is not the system of record unless the project says so and configures persistence for it.

## Exemplo

```python
def get_profile(user_id: int) -> dict:
    key = f"profile:v1:{user_id}"
    cached = redis.get(key)
    if cached:
        return json.loads(cached)
    profile = load_profile(user_id)
    redis.set(key, json.dumps(profile), ex=300)
    return profile

# atomic, expiring lock instead of check-then-set
acquired = redis.set(f"lock:invoice:{invoice_id}", token, nx=True, ex=30)
```

Namespace and version keys, set an expiry on every cache key, invalidate on the write path that changes the data, use `SET NX EX` (or a proven library) for locks and release only with your own token, and never store secrets or unbounded lists.

## Fonte

Redis documentation (data types, expiry, SET options); refined per project conventions.
```

`skills/auth-security/references/security.md`:

```markdown
---
name: security
description: Baseline secure-coding checks for backend services: authorization patterns, input handling, secrets and common vulnerabilities.
status: baseline
---

## Princípio

Enforce security on the server at the boundary that owns the data: authenticate, authorize the specific object, validate input, and keep secrets out of code, logs and responses.

## Quando aplicar

Any backend change that reads identity, accepts input, stores data or calls another system.

## Quando não aplicar

Never skip it; scale the review to the change. Do not add a security library the project does not use.

## Exemplo

```python
# ownership check on the object, not just "logged in"
note = get_object_or_404(Note, pk=note_id, owner=request.user)

# parameterized query, never string building
cursor.execute("SELECT id FROM notes WHERE owner_id = %s AND title = %s", [user.id, title])

# whitelist writable fields
allowed = {"title", "body"}
payload = {k: v for k, v in body.items() if k in allowed}
```

Checklist: object-level authorization on every route including bulk and nested ones; no mass assignment; parameterized queries; no shell strings from input; no unsafe deserialization of untrusted data; restrict server-side requests to user URLs (SSRF); bounded uploads with checked type and storage path; rate limits on authentication; CORS and CSRF set for the real clients; no secrets or personal data in logs. Report what you verified and what you could not.

## Fonte

OWASP API Security Top 10 and Cheat Sheet Series; refined per project conventions.
```

- [ ] **Step 4: Run tests and validators**

Run: `node --import tsx --test packages/core/tests/backend-references-coverage.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"; npm run validate:skills 2>&1 | tail -1; npm test --workspace=packages/core 2>&1 | grep -E "^ℹ fail"`
Expected: all pass, including uniqueness against the eight frontend references.

- [ ] **Step 5: Commit**

```bash
git add skills packages/core/tests/backend-references-coverage.test.ts
git commit -m "skills: api-design, data-modeling, async-jobs and auth-security references, with selector coverage tests"
```

---

### Task 7: Orchestrator classification and install counts

**Files:**
- Modify: `skills/task-orchestrator/references/task-ledger.md` (Classification section)
- Modify: `packages/core/tests/shared-skills.test.ts` (append one test)
- Modify: `packages/cli/tests/shared-skills-install.test.ts` (25 skills; backend skills installed)

**Interfaces:**
- Consumes: the ten backend skill names (Tasks 3–4), the `task-orchestrator` skill (v0.7).

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/tests/shared-skills.test.ts`:

```ts
test('the orchestrator tells the agent which skills each classification loads', () => {
  const text = readFileSync(join(kitRoot, 'skills', 'task-orchestrator', 'references', 'task-ledger.md'), 'utf8');
  const section = text.slice(text.indexOf('## Classification'), text.indexOf('## Resume'));
  for (const skill of ['backend-architecture', 'api-design', 'data-modeling', 'database-migrations', 'backend-testing', 'auth-security', 'external-integrations', 'async-jobs', 'observability', 'backend-performance']) {
    assert.match(section, new RegExp(skill), skill);
  }
  for (const skill of ['figma-to-code', 'visual-validation', 'root-cause-analysis', 'repository-investigation']) assert.match(section, new RegExp(skill), skill);
});
```

In `packages/cli/tests/shared-skills-install.test.ts`: add the ten backend names to the expected list (a new `BACKEND` constant), change the total directory count from 15 to 25, adjust the test title to "7 frontend, 8 shared and 10 backend skills", and add an assertion that `.claude/skills/backend-architecture/references/django.md` exists after install.

- [ ] **Step 2: Run to verify failure**

Run: `npm test --workspace=packages/core --workspace=packages/cli 2>&1 | grep -E "^ℹ (pass|fail)|not ok"`
Expected: FAIL — the classification section does not list skills; install counts differ.

- [ ] **Step 3: Implement**

In `skills/task-orchestrator/references/task-ledger.md`, replace the `## Classification` section (up to the next `##`) with:

```markdown
## Classification

frontend, backend, fullstack, investigation-only, infrastructure. Decide after reading the work item and the repository. Classification selects which skills to load; do not load every domain.

- frontend: `figma-to-code`, `component-selection`, `responsive-design`, `accessibility`, `visual-validation` (plus `frontend-design`, `motion-design` when relevant).
- backend: `backend-architecture` first, then only what the change needs: `api-design`, `data-modeling`, `database-migrations`, `backend-testing`, `auth-security`, `external-integrations`, `async-jobs`, `observability`, `backend-performance`. Detect the stack, then read only its references.
- fullstack: both sets, after one API contract is written down (see the fullstack workflow in a later version).
- investigation-only: `repository-investigation` and `root-cause-analysis`; change no code.
- infrastructure: `repository-investigation`, `verification`, `surgical-diff`; production stays read-only.
```

- [ ] **Step 4: Run tests and validators**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"; npm run validate:skills 2>&1 | tail -1`
Expected: all `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add skills packages
git commit -m "skills: task-orchestrator names the skills each classification loads; install covers 25 skills"
```

---

### Task 8: Backend eval fixtures and scenarios

**Files:**
- Create fixtures: `evals/fixtures/django-app/**`, `evals/fixtures/fastapi-app/**`, `evals/fixtures/nest-app/**`, `evals/fixtures/celery-app/**`
- Create scenarios: `evals/scenarios/backend-{django-api,drf-permission,postgres-migration,fastapi-api,root-cause-bugfix,external-integration,nest-api,celery-task,rabbitmq-consumer}.json`
- Modify: `packages/evals/tests/catalog.test.ts`

**Interfaces:**
- Consumes: optional `figma` and the `backend` category (Task 2); the backend skill and reference names (Tasks 3–6).

Fixtures are tiny, dependency-free source trees: nothing is installed and no service runs. Every prompt says so.

- [ ] **Step 1: Write the failing catalog tests**

In `packages/evals/tests/catalog.test.ts` update the first test and add three:

```ts
test('the catalog loads: 7 base, 8 stack, 3 profile, 9 backend', () => {
  const scenarios = loadScenarios(layout);
  const count = (c: string) => scenarios.filter((s) => s.category === c).length;
  assert.deepEqual([count('base'), count('stack'), count('profile'), count('backend')], [7, 8, 3, 9]);
});

test('backend scenarios need no Figma, name their skills and references, and match the spec list', () => {
  const backend = loadScenarios(layout).filter((s) => s.category === 'backend');
  assert.deepEqual(
    backend.map((s) => s.id).sort(),
    ['backend-celery-task', 'backend-django-api', 'backend-drf-permission', 'backend-external-integration', 'backend-fastapi-api', 'backend-nest-api', 'backend-postgres-migration', 'backend-rabbitmq-consumer', 'backend-root-cause-bugfix']
  );
  const skills = readdirSync(join(kitRoot, 'skills'));
  const refs = skills.flatMap((s) => (existsSync(join(kitRoot, 'skills', s, 'references')) ? readdirSync(join(kitRoot, 'skills', s, 'references')).map((f) => f.replace(/\.md$/, '')) : []));
  for (const s of backend) {
    assert.equal(s.figma, undefined, s.id);
    const tools = s.expected.filter((a) => a.type === 'tool_called').map((a) => (a as { tool: string }).tool);
    assert.ok(tools.some((t) => t.startsWith('skill/') && skills.includes(t.slice('skill/'.length))), `${s.id} must expect a skill read`);
    for (const t of tools.filter((t) => t.startsWith('reference/'))) assert.ok(refs.includes(t.slice('reference/'.length)), `${s.id}: ${t}`);
    assert.match(s.prompt, /instalar depend[eê]ncias|nem instalar/i, `${s.id} must say nothing has to be installed or run`);
    assert.doesNotMatch(s.prompt, /\{\{baseUrl\}\}/, s.id);
  }
});

test('backend fixtures contain no symlinks and no installed dependencies', () => {
  for (const fixture of ['django-app', 'fastapi-app', 'nest-app', 'celery-app']) {
    const ws = createWorkspace(join(layout.fixturesDir, fixture));
    try {
      assert.equal(existsSync(join(ws, 'node_modules')), false, fixture);
    } finally {
      removeWorkspace(ws);
    }
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test --workspace=packages/evals 2>&1 | grep -E "^ℹ (pass|fail)|not ok" | head`
Expected: FAIL — no backend scenarios or fixtures.

- [ ] **Step 3: Write the fixtures**

**`evals/fixtures/django-app/`**

`requirements.txt`:
```
django>=5.0
djangorestframework>=3.15
psycopg2-binary>=2.9
pytest-django>=4.8
```
`manage.py`:
```python
#!/usr/bin/env python
import os
import sys

if __name__ == "__main__":
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)
```
`config/__init__.py` (empty), `config/settings.py`:
```python
import os

SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]
DEBUG = False
ALLOWED_HOSTS: list[str] = []
INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "rest_framework",
    "notes",
]
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("DB_NAME", "app"),
        "USER": os.environ.get("DB_USER", "app"),
        "PASSWORD": os.environ["DB_PASSWORD"],
        "HOST": os.environ.get("DB_HOST", "localhost"),
    }
}
ROOT_URLCONF = "config.urls"
REST_FRAMEWORK = {"DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"]}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
```
`config/urls.py`:
```python
from django.urls import include, path

urlpatterns = [path("api/", include("notes.urls"))]
```
`notes/__init__.py` (empty), `notes/models.py`:
```python
from django.conf import settings
from django.db import models


class Note(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notes")
    title = models.CharField(max_length=200)
    body = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
```
`notes/serializers.py`:
```python
from rest_framework import serializers

from .models import Note


class NoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Note
        fields = ["id", "title", "body", "created_at"]
        read_only_fields = ["id", "created_at"]
```
`notes/permissions.py`:
```python
from rest_framework import permissions


class IsOwner(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        return obj.owner_id == request.user.id
```
`notes/views.py`:
```python
from rest_framework import permissions, viewsets

from .models import Note
from .permissions import IsOwner
from .serializers import NoteSerializer


class NoteViewSet(viewsets.ModelViewSet):
    serializer_class = NoteSerializer
    permission_classes = [permissions.IsAuthenticated, IsOwner]

    def get_queryset(self):
        return Note.objects.filter(owner=self.request.user)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)
```
`notes/urls.py`:
```python
from rest_framework.routers import DefaultRouter

from .views import NoteViewSet

router = DefaultRouter()
router.register("notes", NoteViewSet, basename="note")
urlpatterns = router.urls
```
`notes/migrations/__init__.py` (empty), `notes/migrations/0001_initial.py`:
```python
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = [migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(
            name="Note",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(max_length=200)),
                ("body", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="notes", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-created_at"]},
        ),
    ]
```
`notes/tests/__init__.py` (empty), `notes/tests/test_notes.py`:
```python
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


def test_owner_sees_only_own_notes():
    User = get_user_model()
    alice = User.objects.create_user("alice", password="x")
    bob = User.objects.create_user("bob", password="x")
    alice.notes.create(title="mine")
    bob.notes.create(title="theirs")
    client = APIClient()
    client.force_authenticate(alice)
    titles = [n["title"] for n in client.get("/api/notes/").json()]
    assert titles == ["mine"]
```

**`evals/fixtures/fastapi-app/`**

`pyproject.toml`:
```toml
[project]
name = "inventory"
version = "0.1.0"
dependencies = ["fastapi>=0.110", "pydantic>=2", "sqlalchemy>=2", "alembic>=1.13", "httpx>=0.27"]

[project.optional-dependencies]
dev = ["pytest>=8", "ruff>=0.5", "mypy>=1.10"]
```
`app/__init__.py` (empty), `app/main.py`:
```python
from fastapi import FastAPI

from app.routers import items

app = FastAPI(title="inventory")
app.include_router(items.router)
```
`app/db.py`:
```python
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

engine = create_engine("sqlite:///./inventory.db")
SessionLocal = sessionmaker(bind=engine)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```
`app/models.py`:
```python
from sqlalchemy import Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Item(Base):
    __tablename__ = "items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    stock: Mapped[int] = mapped_column(Integer, default=0)
```
`app/schemas.py`:
```python
from pydantic import BaseModel, Field


class ItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    stock: int = Field(ge=0)


class ItemOut(BaseModel):
    id: int
    name: str
    stock: int

    model_config = {"from_attributes": True}
```
`app/deps.py`:
```python
from fastapi import Header, HTTPException, status


def get_current_user(x_user_id: str | None = Header(default=None)) -> str:
    if not x_user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail={"code": "UNAUTHENTICATED"})
    return x_user_id
```
`app/routers/__init__.py` (empty), `app/routers/items.py`:
```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user
from app.models import Item
from app.schemas import ItemCreate, ItemOut

router = APIRouter(prefix="/items", tags=["items"])


@router.get("", response_model=list[ItemOut])
def list_items(db: Session = Depends(get_db), user: str = Depends(get_current_user)):
    return db.query(Item).order_by(Item.id).all()


@router.post("", response_model=ItemOut, status_code=status.HTTP_201_CREATED)
def create_item(body: ItemCreate, db: Session = Depends(get_db), user: str = Depends(get_current_user)):
    if db.query(Item).filter(Item.name == body.name).first():
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "ITEM_EXISTS"})
    item = Item(**body.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item
```
`app/services/__init__.py` (empty), `app/services/pricing.py` (contains the seeded bug):
```python
def total_with_discount(unit_price: float, quantity: int, discount_percent: float) -> float:
    """Order total after a percentage discount."""
    discounted_unit = unit_price * (1 - discount_percent / 100)
    subtotal = discounted_unit * quantity
    return round(subtotal - subtotal * discount_percent / 100, 2)
```
`tests/__init__.py` (empty), `tests/test_pricing.py`:
```python
from app.services.pricing import total_with_discount


def test_no_discount():
    assert total_with_discount(100, 2, 0) == 200


def test_bulk_discount_is_applied_once():
    assert total_with_discount(100, 2, 10) == 180
```
`tests/test_items.py`:
```python
from app.schemas import ItemCreate


def test_item_create_rejects_negative_stock():
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        ItemCreate(name="x", stock=-1)
```

**`evals/fixtures/nest-app/`**

`package.json`:
```json
{
  "name": "users-service",
  "version": "0.1.0",
  "private": true,
  "scripts": { "build": "nest build", "test": "jest", "lint": "eslint src", "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.0"
  },
  "devDependencies": { "@nestjs/testing": "^10.0.0", "@types/jest": "^29.5.0", "jest": "^29.7.0", "ts-jest": "^29.1.0", "typescript": "^5.4.0" },
  "jest": { "preset": "ts-jest", "testEnvironment": "node", "rootDir": "src" }
}
```
`tsconfig.json`:
```json
{ "compilerOptions": { "module": "commonjs", "target": "ES2021", "strict": true, "experimentalDecorators": true, "emitDecoratorMetadata": true, "outDir": "dist" }, "include": ["src"] }
```
`src/main.ts`:
```ts
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(3000);
}
bootstrap();
```
`src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { UsersModule } from './users/users.module';

@Module({ imports: [UsersModule] })
export class AppModule {}
```
`src/auth/roles.guard.ts`:
```ts
import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const Roles = (...roles: string[]) => SetMetadata('roles', roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<string[]>('roles', context.getHandler()) ?? [];
    const user = context.switchToHttp().getRequest().user as { roles?: string[] } | undefined;
    return required.length === 0 || required.some((role) => user?.roles?.includes(role));
  }
}
```
`src/users/create-user.dto.ts`:
```ts
import { IsEmail, IsString, MaxLength } from 'class-validator';

export class CreateUserDto {
  @IsEmail() email!: string;
  @IsString() @MaxLength(120) name!: string;
}
```
`src/users/users.service.ts`:
```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateUserDto } from './create-user.dto';

export interface User {
  id: string;
  email: string;
  name: string;
  active: boolean;
}

@Injectable()
export class UsersService {
  private readonly users = new Map<string, User>();

  create(dto: CreateUserDto): User {
    if ([...this.users.values()].some((u) => u.email === dto.email)) throw new ConflictException({ code: 'EMAIL_ALREADY_EXISTS' });
    const user: User = { id: String(this.users.size + 1), ...dto, active: true };
    this.users.set(user.id, user);
    return user;
  }

  get(id: string): User {
    const user = this.users.get(id);
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND' });
    return user;
  }
}
```
`src/users/users.controller.ts`:
```ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { CreateUserDto } from './create-user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.users.get(id);
  }
}
```
`src/users/users.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({ controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
```
`src/users/users.controller.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  it('creates and reads a user', async () => {
    const module = await Test.createTestingModule({ controllers: [UsersController], providers: [UsersService] }).compile();
    const controller = module.get(UsersController);
    const created = controller.create({ email: 'a@example.test', name: 'Ana' });
    expect(controller.get(created.id).email).toBe('a@example.test');
  });
});
```

**`evals/fixtures/celery-app/`**

`pyproject.toml`:
```toml
[project]
name = "billing"
version = "0.1.0"
dependencies = ["celery>=5.3", "redis>=5", "pika>=1.3", "pydantic>=2"]

[project.optional-dependencies]
dev = ["pytest>=8", "ruff>=0.5"]
```
`docker-compose.yml`:
```yaml
services:
  rabbitmq:
    image: rabbitmq:3-management
    ports: ["5672:5672", "15672:15672"]
  redis:
    image: redis:7
    ports: ["6379:6379"]
```
`app/__init__.py` (empty), `app/celery_app.py`:
```python
import os

from celery import Celery

celery_app = Celery("billing", broker=os.environ.get("BROKER_URL", "amqp://localhost"), backend=os.environ.get("RESULT_BACKEND", "redis://localhost:6379/0"))
celery_app.conf.task_serializer = "json"
celery_app.autodiscover_tasks(["app.tasks"])
```
`app/tasks/__init__.py` (empty), `app/tasks/emails.py` (the existing pattern to follow):
```python
from celery import shared_task

from app.mailer import send_mail, TemporaryMailError


@shared_task(bind=True, acks_late=True, autoretry_for=(TemporaryMailError,), retry_backoff=True, max_retries=3)
def send_welcome(self, user_id: int) -> None:
    send_mail(user_id, template="welcome")
```
`app/mailer.py`:
```python
class TemporaryMailError(Exception):
    """The mail provider is temporarily unavailable."""


def send_mail(user_id: int, template: str) -> None:
    raise NotImplementedError
```
`app/models.py` (a tiny in-memory store so the task has something to be idempotent against):
```python
from dataclasses import dataclass, field


@dataclass
class Invoice:
    id: int
    customer_id: int
    amount_cents: int
    sent: bool = False


@dataclass
class Store:
    invoices: dict[int, Invoice] = field(default_factory=dict)
    processed_messages: set[str] = field(default_factory=set)


store = Store()
```
`app/consumers/__init__.py` (empty), `app/consumers/orders.py` (the existing consumer pattern):
```python
import json

import pika

from app.models import store


def handle_order(payload: dict) -> None:
    store.invoices[payload["order_id"]] = None  # placeholder for the real handler


def on_message(channel, method, properties, body):
    payload = json.loads(body)
    handle_order(payload)
    channel.basic_ack(method.delivery_tag)


def main() -> None:
    connection = pika.BlockingConnection(pika.ConnectionParameters("localhost"))
    channel = connection.channel()
    channel.queue_declare("orders", durable=True)
    channel.basic_qos(prefetch_count=10)
    channel.basic_consume("orders", on_message)
    channel.start_consuming()
```
`tests/__init__.py` (empty), `tests/test_emails.py`:
```python
from app.tasks.emails import send_welcome


def test_send_welcome_is_a_registered_task():
    assert send_welcome.name.endswith("send_welcome")
```

- [ ] **Step 4: Write the scenarios**

All prompts are in Portuguese, say that nothing needs installing or running, and end by asking for a short summary. Each `expected` includes a skill read, the relevant reference read, and a file assertion on the produced code; each `forbidden` names a concrete anti-pattern.

`evals/scenarios/backend-django-api.json`:
```json
{
  "id": "backend-django-api",
  "category": "backend",
  "title": "Endpoint Django para arquivar uma nota",
  "fixture": "django-app",
  "prompt": "Adicione a este projeto um endpoint POST /api/notes/{id}/archive/ que marca uma nota como arquivada (campo archived_at) e é idempotente. Siga as convenções do projeto e as skills do kit, incluindo a migração. Não é preciso rodar o app nem instalar dependências. Termine com um resumo curto do que fez e do que verificou.",
  "timeoutSec": 900,
  "expected": [
    { "type": "tool_called", "tool": "skill/backend-architecture" },
    { "type": "tool_called", "tool": "skill/api-design" },
    { "type": "tool_called", "tool": "reference/django" },
    { "type": "file_matches", "glob": "notes/views.py", "pattern": "def archive" },
    { "type": "file_matches", "glob": "notes/models.py", "pattern": "archived_at" },
    { "type": "file_matches", "glob": "notes/migrations/*.py", "pattern": "archived_at" }
  ],
  "forbidden": [
    { "type": "file_matches", "glob": "notes/views.py", "pattern": "Note\\.objects\\.get\\(pk=", "description": "busca sem escopo de dono: qualquer usuário arquivaria a nota de outro" }
  ]
}
```

`evals/scenarios/backend-drf-permission.json`:
```json
{
  "id": "backend-drf-permission",
  "category": "backend",
  "title": "Ação DRF restrita ao dono da nota",
  "fixture": "django-app",
  "prompt": "Adicione GET /api/notes/{id}/summary/ que devolve o título e os primeiros 100 caracteres do corpo, acessível apenas ao dono da nota (outro usuário deve receber 404). Use as skills do kit e mantenha o padrão de permissões que já existe. Não é preciso rodar o app nem instalar dependências. Termine com um resumo curto.",
  "timeoutSec": 900,
  "expected": [
    { "type": "tool_called", "tool": "skill/auth-security" },
    { "type": "tool_called", "tool": "reference/drf" },
    { "type": "file_matches", "glob": "notes/views.py", "pattern": "@action" },
    { "type": "file_matches", "glob": "notes/views.py", "pattern": "def summary" },
    { "type": "file_matches", "glob": "notes/**/*.py", "pattern": "summary" }
  ],
  "forbidden": [
    { "type": "file_matches", "glob": "notes/views.py", "pattern": "AllowAny", "description": "abre o endpoint a qualquer um" },
    { "type": "file_matches", "glob": "notes/serializers.py", "pattern": "fields\\s*=\\s*['\\\"]__all__['\\\"]", "description": "expõe todos os campos (mass assignment / vazamento)" }
  ]
}
```

`evals/scenarios/backend-postgres-migration.json`:
```json
{
  "id": "backend-postgres-migration",
  "category": "backend",
  "title": "Migração segura com índice para notas ativas",
  "fixture": "django-app",
  "prompt": "A listagem 'notas ativas de um usuário' está lenta. Adicione o campo archived_at (nullable) ao modelo Note e um índice adequado para essa consulta, via migração revisada para uma tabela grande no PostgreSQL. Use as skills do kit. Não é preciso rodar o app nem instalar dependências. Termine explicando os riscos de lock e a estratégia de rollback.",
  "timeoutSec": 900,
  "expected": [
    { "type": "tool_called", "tool": "skill/database-migrations" },
    { "type": "tool_called", "tool": "reference/postgresql" },
    { "type": "file_matches", "glob": "notes/migrations/0002_*.py", "pattern": "archived_at" },
    { "type": "file_matches", "glob": "notes/migrations/0002_*.py", "pattern": "[Ii]ndex" },
    { "type": "output_matches", "pattern": "lock", "flags": "i" }
  ],
  "forbidden": [
    { "type": "file_matches", "glob": "notes/migrations/0002_*.py", "pattern": "null\\s*=\\s*False", "description": "coluna NOT NULL sem backfill em tabela grande" },
    { "type": "file_matches", "glob": "notes/migrations/0001_initial.py", "pattern": "archived_at", "description": "editou uma migração já aplicada" }
  ]
}
```

`evals/scenarios/backend-fastapi-api.json`:
```json
{
  "id": "backend-fastapi-api",
  "category": "backend",
  "title": "Endpoint FastAPI para reservar estoque",
  "fixture": "fastapi-app",
  "prompt": "Adicione POST /items/{item_id}/reserve que reserva uma quantidade do estoque de um item. Deve validar a entrada, responder 404 para item inexistente, 409 com código OUT_OF_STOCK quando não houver estoque suficiente, e ser seguro contra reservas concorrentes. Siga as convenções do projeto e as skills do kit. Não é preciso rodar o app nem instalar dependências. Termine com um resumo curto.",
  "timeoutSec": 900,
  "expected": [
    { "type": "tool_called", "tool": "skill/api-design" },
    { "type": "tool_called", "tool": "reference/fastapi" },
    { "type": "file_matches", "glob": "app/routers/items.py", "pattern": "@router\\.post\\([^)]*reserve" },
    { "type": "file_matches", "glob": "app/**/*.py", "pattern": "OUT_OF_STOCK" },
    { "type": "file_matches", "glob": "app/**/*.py", "pattern": "with_for_update|UPDATE .* SET stock|stock\\s*>=|Item\\.stock\\s*-" }
  ],
  "forbidden": [
    { "type": "file_matches", "glob": "app/routers/items.py", "pattern": "print\\(", "description": "log improvisado em vez do logger do projeto" }
  ]
}
```

`evals/scenarios/backend-root-cause-bugfix.json`:
```json
{
  "id": "backend-root-cause-bugfix",
  "category": "backend",
  "title": "Bug de desconto aplicado duas vezes",
  "fixture": "fastapi-app",
  "prompt": "O teste tests/test_pricing.py::test_bulk_discount_is_applied_once está falhando: um pedido de 2 unidades de 100 com 10% de desconto deveria custar 180. Encontre a causa raiz e corrija o código, sem alterar nem pular o teste. Use as skills do kit. Não é preciso rodar o app nem instalar dependências. Termine explicando a causa raiz.",
  "timeoutSec": 900,
  "expected": [
    { "type": "tool_called", "tool": "skill/root-cause-analysis" },
    { "type": "file_matches", "glob": "tests/test_pricing.py", "pattern": "== 180" },
    { "type": "file_matches", "glob": "app/services/pricing.py", "pattern": "def total_with_discount" },
    { "type": "output_matches", "pattern": "duas vezes|dobr|twice|double", "flags": "i" }
  ],
  "forbidden": [
    { "type": "file_matches", "glob": "tests/*.py", "pattern": "pytest\\.mark\\.(skip|xfail)", "description": "escondeu o teste em vez de corrigir o código" },
    { "type": "file_matches", "glob": "tests/test_pricing.py", "pattern": "== 162", "description": "ajustou o teste ao comportamento errado" }
  ]
}
```

`evals/scenarios/backend-external-integration.json`:
```json
{
  "id": "backend-external-integration",
  "category": "backend",
  "title": "Cliente de frete externo com timeout e retry",
  "fixture": "fastapi-app",
  "prompt": "Crie um cliente para uma API externa de cotação de frete (GET https://shipping.example.test/v1/rates?zip=...) em app/clients/shipping.py. Deve ter timeout, retry apenas para falhas transitórias (5xx, 429, rede), tratar o limite de taxa, normalizar a resposta do fornecedor para um tipo próprio e não vazar o formato do fornecedor para o domínio. Use as skills do kit. Não é preciso rodar o app nem instalar dependências. Termine com um resumo curto.",
  "timeoutSec": 900,
  "expected": [
    { "type": "tool_called", "tool": "skill/external-integrations" },
    { "type": "file_matches", "glob": "app/clients/shipping.py", "pattern": "timeout" },
    { "type": "file_matches", "glob": "app/clients/shipping.py", "pattern": "429" },
    { "type": "file_matches", "glob": "app/clients/shipping.py", "pattern": "class \\w*(Rate|Quote)\\w*" }
  ],
  "forbidden": [
    { "type": "file_matches", "glob": "app/**/*.py", "pattern": "verify\\s*=\\s*False", "description": "desliga a verificação TLS" },
    { "type": "file_matches", "glob": "app/**/*.py", "pattern": "while True:\\s*\\n\\s*try", "description": "retry infinito sem limite" }
  ]
}
```

`evals/scenarios/backend-nest-api.json`:
```json
{
  "id": "backend-nest-api",
  "category": "backend",
  "title": "Endpoint NestJS para desativar um usuário",
  "fixture": "nest-app",
  "prompt": "Adicione POST /users/:id/deactivate que desativa um usuário (active = false) e exige o papel 'admin', com DTO validado para o motivo. Responda 404 com o código USER_NOT_FOUND quando não existir. Siga o módulo existente e as skills do kit. Não é preciso rodar o app nem instalar dependências. Termine com um resumo curto.",
  "timeoutSec": 900,
  "expected": [
    { "type": "tool_called", "tool": "skill/api-design" },
    { "type": "tool_called", "tool": "reference/nestjs" },
    { "type": "file_matches", "glob": "src/users/users.controller.ts", "pattern": "@Post\\(':id/deactivate'\\)" },
    { "type": "file_matches", "glob": "src/users/users.controller.ts", "pattern": "RolesGuard" },
    { "type": "file_matches", "glob": "src/users/*.dto.ts", "pattern": "class-validator" }
  ],
  "forbidden": [
    { "type": "file_matches", "glob": "src/**/*.ts", "pattern": ":\\s*any\\b", "description": "tipo any em código novo" }
  ]
}
```

`evals/scenarios/backend-celery-task.json`:
```json
{
  "id": "backend-celery-task",
  "category": "backend",
  "title": "Tarefa Celery idempotente para enviar fatura",
  "fixture": "celery-app",
  "prompt": "Crie a tarefa Celery send_invoice(invoice_id) em app/tasks/invoices.py: deve ser idempotente (uma entrega duplicada não reenvia a fatura), ter retry com backoff apenas para falhas transitórias, limite de tentativas e limite de tempo. Siga o padrão das tarefas existentes e as skills do kit. Não é preciso rodar o app nem instalar dependências. Termine com um resumo curto.",
  "timeoutSec": 900,
  "expected": [
    { "type": "tool_called", "tool": "skill/async-jobs" },
    { "type": "tool_called", "tool": "reference/celery" },
    { "type": "file_matches", "glob": "app/tasks/invoices.py", "pattern": "def send_invoice" },
    { "type": "file_matches", "glob": "app/tasks/invoices.py", "pattern": "max_retries" },
    { "type": "file_matches", "glob": "app/tasks/invoices.py", "pattern": "acks_late" },
    { "type": "file_matches", "glob": "app/tasks/invoices.py", "pattern": "sent" }
  ],
  "forbidden": [
    { "type": "file_matches", "glob": "app/tasks/invoices.py", "pattern": "retry_forever|max_retries\\s*=\\s*None", "description": "retry ilimitado" }
  ]
}
```

`evals/scenarios/backend-rabbitmq-consumer.json`:
```json
{
  "id": "backend-rabbitmq-consumer",
  "category": "backend",
  "title": "Consumidor RabbitMQ com dead-letter e idempotência",
  "fixture": "celery-app",
  "prompt": "Crie em app/consumers/payments.py um consumidor da fila 'payments' com confirmação manual apenas depois do trabalho concluído, dead-letter para mensagens que continuam falhando, e processamento idempotente (a mesma mensagem duas vezes tem um só efeito). Siga o consumidor existente e as skills do kit. Não é preciso rodar o app nem instalar dependências. Termine com um resumo curto.",
  "timeoutSec": 900,
  "expected": [
    { "type": "tool_called", "tool": "skill/async-jobs" },
    { "type": "tool_called", "tool": "reference/rabbitmq" },
    { "type": "file_matches", "glob": "app/consumers/payments.py", "pattern": "basic_ack" },
    { "type": "file_matches", "glob": "app/consumers/payments.py", "pattern": "x-dead-letter-exchange|dead.letter" },
    { "type": "file_matches", "glob": "app/consumers/payments.py", "pattern": "processed" }
  ],
  "forbidden": [
    { "type": "file_matches", "glob": "app/consumers/payments.py", "pattern": "auto_ack\\s*=\\s*True", "description": "confirma antes de processar e perde mensagens" },
    { "type": "file_matches", "glob": "app/consumers/payments.py", "pattern": "requeue\\s*=\\s*True", "description": "reenfileira em laço apertado" }
  ]
}
```

- [ ] **Step 5: Run tests and the offline validator**

Run: `npm test --workspace=packages/evals 2>&1 | grep -E "^ℹ (pass|fail)"; npm run evals:validate 2>&1 | tail -2`
Expected: `fail 0`; `ok: 27 scenarios`. If a fixture trips the "copies cleanly" check or the `{{baseUrl}}` rule in the existing catalog tests, fix the fixture or prompt (never the rule).

- [ ] **Step 6: Commit**

```bash
git add evals packages/evals
git commit -m "evals: nine backend scenarios and four backend fixtures"
```

---

### Task 9: Docs and v0.8.0 release

**Files:**
- Create: `docs/backend.md`
- Modify: `README.md`, `evals/README.md`
- Modify (version 0.7.1 → 0.8.0): `packages/{cli,core,evals}/package.json`, `package-lock.json`, `packages/cli/tests/cli.test.ts`, `packages/cli/tests/util.test.ts` (mirror the v0.7.1 release: `git show df77799 --stat`)

- [ ] **Step 1: Write the docs**

`docs/backend.md` (short): what v0.8 adds (ten skills, thirteen references and where each lives, the selector, the eval suite); the rule that detection comes first and nothing is forced on a project; the backend Definition of Done pointer (`backend-architecture`); how a backend work item flows through the orchestrator; what is not in v0.8 (fullstack contract flow, integration verifier, CLI commands — v0.9; real-host benchmark of the backend scenarios).

`README.md`: change the skill-count line to "…and v0.8 the ten backend skills, for 25 in total", and add a `## v0.8 — backend domain` section after v0.7 (skills, references, `selectBackendReferences`, 9 backend eval scenarios validated offline with `npm run evals:validate`).

`evals/README.md`: add one bullet: scenarios may omit `figma`; `category` may be `backend`.

- [ ] **Step 2: Bump the version**

Run: `sed -i 's/"version": "0.7.1"/"version": "0.8.0"/' packages/cli/package.json packages/core/package.json packages/evals/package.json`, update the two version assertions in `packages/cli/tests/cli.test.ts` and `packages/cli/tests/util.test.ts`, then `npm install --package-lock-only`.

- [ ] **Step 3: Run everything**

```bash
npm test 2>&1 | grep -E "^ℹ (pass|fail)"
npm run typecheck --workspaces --if-present
npm run validate:skills
npm run evals:validate
```

Expected: every `fail` is 0; typecheck clean; `validate-skill: all skills valid.`; `ok: 27 scenarios`.

- [ ] **Step 4: Commit**

```bash
git add docs README.md evals packages package-lock.json
git commit -m "chore: release v0.8.0 — backend domain"
```

---

## Self-review

**Spec coverage (§38 v0.8 checklist):**

| Item | Where |
|---|---|
| backend architecture skill | Task 3 |
| API design | Task 3 |
| data modeling | Task 3 |
| migrations | Task 3 |
| backend testing | Task 4 |
| auth/security | Task 4 |
| integrations | Task 4 |
| jobs/queues | Task 4 |
| observability | Task 4 |
| performance | Task 4 |
| Django/DRF references | Task 5 (`django`), Task 6 (`drf`) |
| FastAPI references | Task 5 |
| Node/Nest references | Task 5 (`node-typescript`, `nestjs`) |
| PostgreSQL/Redis/RabbitMQ/Celery references | Task 6 |
| backend eval suite (9 scenarios) | Task 2 (harness), Task 8 (fixtures, scenarios) |
| §16 "detect first, never force" | Task 1 (`selectBackendReferences`), Review Focus 1 |
| §17 workflow, §34 DoD | Task 3 (`backend-architecture`) |
| §18 API workflow and DoD | Task 3 (`api-design`) |
| §19 migration checks, production read-only | Task 3 (`database-migrations`) |
| §20 async jobs, §21 integrations, §22 security | Task 4 |
| §11/§25 classification loads the right skills | Task 7 |
| §43 compatibility (frontend, MCP, 18 scenarios untouched) | Global Constraints; Task 2 keeps `evals:validate` at 18 before Task 8 |

Additional references named in §16 (`python`, `docker`, `openapi`, `security`) are included: 13 in total.

**Deferred with a stated reason:** the fullstack workflow, the API contract artifact and the integration verifier (§23, v0.9); CLI commands (v0.9); a real-host run of the backend scenarios (the user skipped benchmarks — scenarios are validated offline).

**Decisions recorded in the plan (confirm or overrule):**
1. References are distributed across the skills that own them (six under `backend-architecture`, `drf`/`openapi` under `api-design`, `postgresql` under `data-modeling`, `rabbitmq`/`celery`/`redis` under `async-jobs`, `security` under `auth-security`) rather than under one directory, and their names are globally unique because the harness identifies a read by file name.
2. `ProjectProfile` grows two additive fields (`cache`, `queues`); `queue` keeps its meaning, so no v0.6 consumer changes.
3. Backend `SKILL.md` files are held to the same "no framework names" rule as the shared skills, with a slightly wider forbidden list (ORMs, queues, databases, test runners).
4. Scenarios and fixtures are answerable from source files alone (no installs, no running services), so they stay cheap to run and to validate offline.

**Placeholder scan:** no TBD/TODO; every code and content step carries content. **Type consistency:** `ReferenceHint`/`selectBackendReferences` (Task 1) are the names Task 6 imports; `CATEGORIES`/optional `figma` (Task 2) are what Task 8's scenarios rely on; the 13 reference names in Tasks 5–6 match `EXPECTED` in the coverage test and the selector's output.

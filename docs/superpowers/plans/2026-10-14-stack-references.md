# Stack References Implementation Plan (v1.2 block B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give FastAPI, NestJS, Vue, Nuxt and Next.js a real reference each (structure, data and state, errors and validation, tests, pitfalls), a new `frontend-architecture` skill to hold the three frontend ones, a frontend selector, and the contracts and counts that go with them.

**Architecture:** The kit already loads one `references/<name>.md` per detected stack. The two backend files are deepened in place (`status: baseline` → `guide`); a new skill `frontend-architecture` (symmetric with `backend-architecture`) gets `vue-stack.md`, `nuxt-stack.md`, `next-stack.md`; `selectFrontendReferences(profile)` in `packages/core` mirrors `selectBackendReferences`; `dev-agent inspect` shows the result. A new contract test checks the five guides' shape, and each guide task adds its entry to that test.

**Tech Stack:** Markdown skills and references, TypeScript (ESM, `tsx`), `node:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-14-stack-references-design.md`

All commands run from the repository root (or its worktree) unless a `cd` is shown. Core tests: `cd packages/core && node --import tsx --test tests/<file>.test.ts` (whole package: `npm test`). CLI tests: `cd packages/cli && node --import tsx --test tests/<file>.test.ts`. Everything: `npm test` from the root.

## Global Constraints

- No change to `install`, `verify`, any host adapter or the golden fixtures: skills are copied automatically (spec Goals 4).
- `status` values: the five deepened files use exactly `status: guide`; the other 28 references stay `status: baseline` (spec "The references").
- Reference names must stay unique across the whole kit. New names are exactly `vue-stack`, `nuxt-stack`, `next-stack` (the names `vuejs`, `nuxt`, `nextjs` belong to `figma-to-code`).
- Frontmatter of a reference is exactly `---\nname: <file name>\ndescription: <20–300 chars on one line>\nstatus: guide\n---\n`.
- Every guide keeps these headings, in this order: `## Princípio`, `## Quando aplicar`, `## Quando não aplicar`, `## Exemplo`, `## Estrutura do projeto`, `## Dados e estado`, `## Erros e validação`, `## Testes`, `## Armadilhas`, `## Fonte`; has a line starting `Targets: ` naming the framework and the major versions it was written for; and is 80–200 lines.
- `skills/frontend-architecture/SKILL.md` names no framework, UI library, state library, test runner or design tool, has frontmatter of exactly `name` + one-line `description` (40–400 chars) and at most 60 lines (same rule as the backend skills).
- Selector: deterministic order, no duplicates, `[]` when there is no signal; `nuxt` → `frontend-architecture/nuxt-stack`, `vue` → `frontend-architecture/vue-stack`, `next` → `frontend-architecture/next-stack`, in that order.
- `dev-agent inspect --json` keeps every existing field and gains `frontendReferences`.
- Counts: README "26 skills" → 27; "Frontend (7)" → "Frontend (8)" with `frontend-architecture` added.
- Guide content comes from each stack's **official documentation**, fetched while writing (use WebFetch on the official docs: fastapi.tiangolo.com, docs.nestjs.com, vuejs.org, nuxt.com, nextjs.org). If the docs contradict a hint in this plan, **the docs win**: update the contract entry in the same commit and say so in the report. Never invent an API; if a point cannot be confirmed in the docs, leave it out.

## Review Focus

Failure modes the spec implies but no obvious task exercises; each has an owner task.

1. A Nuxt project must get `nuxt-stack`, and `vue-stack` as well because Nuxt declares `vue`; a Next.js project (which also declares `react`) gets only `next-stack` (Tasks 1, 6).
2. A repository with both a frontend and a backend gets both selector lists, with no duplicate names and no frontend reference named like a figma-to-code one (Tasks 1, 3).
3. Stale guidance in the examples: deprecated APIs presented as current (for FastAPI `@app.on_event`, Pydantic v1 `orm_mode`/`@validator`; for Next.js synchronous `params` in a version that makes them async; for Nuxt/Vue the Options API presented as the default). The contract's `mustNot` patterns pin the known ones (Tasks 4–6).
4. A guide that tells the agent to add a library the project may not use (an ORM, a state library, a UI kit): each guide must say what not to assume (Tasks 4–6).
5. The new skill appearing in an install: `dev-agent install` copies 27 skills, `verify` reports 27 skills, and the sync manifest lists `frontend-architecture` (Task 2).
6. `inspect` on a project with no frontend signal prints `frontend references: -` and `frontendReferences: []` (Task 1).

---

### Task 1: The frontend selector and `inspect`

**Files:**
- Create: `packages/core/src/frontend-references.ts`
- Create: `packages/core/tests/frontend-references.test.ts`
- Modify: `packages/core/src/index.ts` (export)
- Modify: `packages/cli/src/dev-cli.ts` (`inspect`)
- Modify: `packages/cli/tests/dev-cli.test.ts` (inspect tests)

**Interfaces:**
- Consumes: `ProjectProfile` from `packages/core/src/project-profile.ts`; `ReferenceHint` from `packages/core/src/backend-references.ts` (`{ skill: string; reference: string; reason: string }`).
- Produces (used by Tasks 5, 6): `selectFrontendReferences(profile: ProjectProfile): ReferenceHint[]` exported from `@…/core` next to `selectBackendReferences`; `inspect` output line `frontend references: <skill>/<reference>, ...` (or `-`) and JSON field `frontendReferences`.

- [ ] **Step 1: Write the failing selector tests**

```ts
// packages/core/tests/frontend-references.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectFrontendReferences } from '../src/frontend-references.ts';
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
const refs = (p: ProjectProfile) => selectFrontendReferences(p).map((h) => `${h.skill}/${h.reference}`);

test('no frontend signal gives nothing, however much backend there is', () => {
  assert.deepEqual(refs(profile({})), []);
  assert.deepEqual(refs(profile({ languages: ['python'], frameworks: ['fastapi', 'django'], docker: true })), []);
  assert.deepEqual(refs(profile({ languages: ['typescript'], frameworks: ['react', 'tailwind'] })), []);
});

test('vue gets vue-stack, next gets next-stack, nuxt gets nuxt-stack first and vue-stack second', () => {
  assert.deepEqual(refs(profile({ frameworks: ['vue'] })), ['frontend-architecture/vue-stack']);
  assert.deepEqual(refs(profile({ frameworks: ['next', 'react'] })), ['frontend-architecture/next-stack']);
  assert.deepEqual(refs(profile({ frameworks: ['vue', 'nuxt'] })), ['frontend-architecture/nuxt-stack', 'frontend-architecture/vue-stack']);
  assert.deepEqual(refs(profile({ frameworks: ['nuxt'] })), ['frontend-architecture/nuxt-stack']);
});

test('hints carry a reason, never repeat, and keep a stable order', () => {
  const p = profile({ frameworks: ['next', 'vue', 'nuxt', 'vue', 'next'] });
  const hints = selectFrontendReferences(p);
  assert.deepEqual(hints.map((h) => h.reference), ['nuxt-stack', 'vue-stack', 'next-stack']);
  for (const hint of hints) assert.match(hint.reason, /detected/);
  assert.deepEqual(selectFrontendReferences(p), hints);
});

test('a fullstack profile gets both lists, and no reference name appears in both', () => {
  const p = profile({ languages: ['typescript', 'python'], frameworks: ['next', 'react', 'fastapi'], database: 'postgresql' });
  const front = selectFrontendReferences(p).map((h) => h.reference);
  const back = selectBackendReferences(p).map((h) => h.reference);
  assert.deepEqual(front, ['next-stack']);
  assert.ok(back.includes('fastapi'));
  assert.deepEqual(front.filter((name) => back.includes(name)), []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/core && node --import tsx --test tests/frontend-references.test.ts`
Expected: FAIL, cannot find module `../src/frontend-references.ts`.

- [ ] **Step 3: Implement the selector and export it**

```ts
// packages/core/src/frontend-references.ts
import type { ReferenceHint } from './backend-references.js';
import type { ProjectProfile } from './project-profile.js';

/**
 * Which frontend stack references apply to this repository (detect first, never force a technology).
 * Deterministic order, no duplicates, and an empty list when there is no frontend signal. A Nuxt project
 * declares `vue` too, so it gets the Nuxt guide first and the Vue guide second.
 */
export function selectFrontendReferences(profile: ProjectProfile): ReferenceHint[] {
  const has = (framework: string): boolean => profile.frameworks.includes(framework);
  const out: ReferenceHint[] = [];
  const add = (reference: string, reason: string): void => {
    if (!out.some((hint) => hint.reference === reference)) out.push({ skill: 'frontend-architecture', reference, reason });
  };
  if (has('nuxt')) add('nuxt-stack', 'Nuxt detected');
  if (has('vue')) add('vue-stack', 'Vue detected');
  if (has('next')) add('next-stack', 'Next.js detected');
  return out;
}
```

In `packages/core/src/index.ts` add, next to the `backend-references` export (line ~18): `export * from './frontend-references.js';`

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/core && node --import tsx --test tests/frontend-references.test.ts && npm run typecheck`
Expected: PASS (4 tests), typecheck clean.

- [ ] **Step 5: Write the failing `inspect` tests**

In `packages/cli/tests/dev-cli.test.ts`, after the existing `inspect ... no backend signal` test, add (reusing the file's `setup`/`runDev` helpers and imports; add `findKitRoot` from `../src/util.ts` and `join` if not yet imported):

```ts
test('inspect shows the frontend references for the Vue, Nuxt and Next.js eval fixtures', async () => {
  const fixtures = join(findKitRoot(), 'evals', 'fixtures');
  const expected: Array<[string, string[]]> = [
    ['vue-app', ['vue-stack']],
    ['nuxt-app', ['nuxt-stack', 'vue-stack']],
    ['nextjs-app', ['next-stack']]
  ];
  for (const [fixture, names] of expected) {
    const t = setup({});
    try {
      assert.equal(await runDev(['inspect', '--project', join(fixtures, fixture), '--json'], t.io), 0);
      const json = JSON.parse(t.text());
      assert.deepEqual(json.frontendReferences.map((r: { reference: string }) => r.reference), names, fixture);
      assert.ok(Array.isArray(json.backendReferences), 'existing field kept');
      t.out.length = 0;
      assert.equal(await runDev(['inspect', '--project', join(fixtures, fixture)], t.io), 0);
      for (const name of names) assert.match(t.text(), new RegExp(`frontend references: .*frontend-architecture/${name}`), fixture);
    } finally {
      t.cleanup();
    }
  }
});

test('inspect on backend-only fixtures lists no frontend references', async () => {
  const fixtures = join(findKitRoot(), 'evals', 'fixtures');
  for (const fixture of ['fastapi-app', 'nest-app']) {
    const t = setup({});
    try {
      assert.equal(await runDev(['inspect', '--project', join(fixtures, fixture), '--json'], t.io), 0);
      assert.deepEqual(JSON.parse(t.text()).frontendReferences, [], fixture);
      t.out.length = 0;
      assert.equal(await runDev(['inspect', '--project', join(fixtures, fixture)], t.io), 0);
      assert.match(t.text(), /frontend references: -/, fixture);
    } finally {
      t.cleanup();
    }
  }
});
```

Also extend the existing `inspect on a project with no backend signal` test with one assertion: `assert.deepEqual(JSON.parse(t.text()).frontendReferences, [])`.

- [ ] **Step 6: Run to verify it fails**

Run: `cd packages/cli && node --import tsx --test tests/dev-cli.test.ts`
Expected: FAIL (`frontendReferences` undefined / no `frontend references:` line).

- [ ] **Step 7: Implement in `inspect`**

In `packages/cli/src/dev-cli.ts`: import `selectFrontendReferences` from the core package next to `selectBackendReferences` (same import statement), then in `inspect` add `const frontend = selectFrontendReferences(profile);` after `const references = ...`; change the JSON line to `io.stdout(JSON.stringify({ profile, backendReferences: references, frontendReferences: frontend }, null, 2));`; and after the `backend references:` line add:

```ts
  io.stdout(`frontend references: ${frontend.length === 0 ? '-' : frontend.map((r) => `${r.skill}/${r.reference}`).join(', ')}`);
```

- [ ] **Step 8: Run everything**

Run: `npm run typecheck --workspaces --if-present; npm test`
Expected: PASS everywhere, including `docs.test.ts` and the golden tests.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/frontend-references.ts packages/core/src/index.ts packages/core/tests/frontend-references.test.ts packages/cli/src/dev-cli.ts packages/cli/tests/dev-cli.test.ts
git commit -m "core, cli: frontend reference selector and inspect output"
```

---

### Task 2: The `frontend-architecture` skill, counts and hand-off

**Files:**
- Create: `skills/frontend-architecture/SKILL.md`
- Create: `packages/core/tests/frontend-architecture-skill.test.ts`
- Modify: `skills/task-orchestrator/SKILL.md` (line ~19)
- Modify: `README.md` (counts and the Frontend row)
- Modify: `packages/cli/tests/shared-skills-install.test.ts` (the `FRONTEND` list)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the skill directory that Tasks 5 and 6 add `references/` to.

- [ ] **Step 1: Write the failing skill test**

```ts
// packages/core/tests/frontend-architecture-skill.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const kitRoot = fileURLToPath(new URL('../../../', import.meta.url));
const file = join(kitRoot, 'skills', 'frontend-architecture', 'SKILL.md');
// Like the backend skills, this one must stay neutral: frameworks live in references/ (spec §16, §27).
const FORBIDDEN =
  /\b(react|vue|nuxt|next\.js|nextjs|angular|svelte|solid|astro|tailwind|figma|pinia|vuex|redux|zustand|mobx|vitest|jest|playwright|cypress|storybook|vite|webpack|django|fastapi|nestjs|express|flask|laravel|jira|linear|trello|asana|clickup|claude code|codex|cursor)\b/i;

test('frontend-architecture exists with exact frontmatter, neutral text and at most 60 lines', () => {
  assert.ok(existsSync(file), 'skills/frontend-architecture/SKILL.md');
  const text = readFileSync(file, 'utf8');
  const front = text.match(/^---\nname: (.+)\ndescription: (.+)\n---\n/);
  assert.ok(front, 'frontmatter must be exactly name + one-line description');
  assert.equal(front![1], 'frontend-architecture');
  assert.match(front![2], /^.{40,400}$/);
  assert.doesNotMatch(text, FORBIDDEN);
  assert.ok(text.split('\n').length <= 60, 'move detail into references/');
});

test('it loads references on demand and carries the pre-code checklist and the Definition of Done', () => {
  const text = readFileSync(file, 'utf8');
  assert.match(text, /load only the matching file from `references\/`/i);
  assert.match(text, /never assume a stack the repository does not use/i);
  assert.match(text, /## Definition of Done/);
  for (const item of [
    'existing structure and conventions followed',
    'data and state have one clear owner',
    'loading, empty, error and permission states handled',
    'no secrets exposed to the client',
    'accessibility and responsive behavior checked',
    'final diff is task-scoped'
  ]) assert.match(text, new RegExp(item, 'i'), item);
});

test('it points at the neighbouring skills instead of repeating them', () => {
  const text = readFileSync(file, 'utf8');
  for (const skill of ['repository-investigation', 'component-selection', 'accessibility', 'responsive-design', 'surgical-diff', 'figma-to-code', 'frontend-design']) {
    assert.match(text, new RegExp(skill), skill);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/core && node --import tsx --test tests/frontend-architecture-skill.test.ts`
Expected: FAIL (`skills/frontend-architecture/SKILL.md` does not exist).

- [ ] **Step 3: Write the skill**

```markdown
---
name: frontend-architecture
description: Plan frontend changes from the existing application structure, data flow, state ownership and rendering model before writing code, then verify against a Definition of Done. Use for any frontend work item that adds or changes screens, routes, behavior-bearing components, data loading or client state.
---

# Frontend Architecture

Detect the repository's stack first (`repository-investigation`, `repo-memory`, or `dev-agent inspect`). Then load only the matching file from `references/`; never assume a stack the repository does not use. Matching a design is `figma-to-code`; interface heuristics are `frontend-design`; this skill is about how the code is structured.

## Workflow

1. Read the closest existing screen or route: entry point, data loading, state, tests.
2. Decide where each piece of data lives (server, URL, shared client state, local component state) and who owns it.
3. Define the component and module boundaries; reuse what exists (`component-selection`).
4. Plan loading, empty, error and permission states before coding.
5. Implement, then run typecheck, lint and tests, exercise the change in a browser, and review the diff with `surgical-diff`.

## Before coding, when applicable

- where data is fetched, and when it is refreshed or invalidated
- what renders on the server and what only on the client
- forms: validation, submission errors, double submit
- client-side authorization is a convenience; the server decides
- accessibility and responsive behavior of the new surface (`accessibility`, `responsive-design`)

## Rules

- Follow the architecture that exists. A new state library, data-fetching layer or routing convention needs a reason the current one cannot cover.
- Keep one owner per piece of state; derive instead of copying.
- Never put secrets or tokens in code that ships to the browser.
- Production is read-only unless explicitly authorized.

## Definition of Done

- [ ] existing structure and conventions followed
- [ ] data and state have one clear owner
- [ ] loading, empty, error and permission states handled
- [ ] input validated and server errors surfaced
- [ ] no secrets exposed to the client
- [ ] accessibility and responsive behavior checked
- [ ] tests added/updated and the change exercised in a browser
- [ ] final diff is task-scoped
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/core && node --import tsx --test tests/frontend-architecture-skill.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Counts, hand-off and install list**

- `README.md`: `**26 skills**` → `**27 skills**`; the Frontend row becomes ``| Frontend (8) | `figma-to-code`, `component-selection`, `frontend-design`, `frontend-architecture`, `responsive-design`, `motion-design`, `accessibility`, `visual-validation` |``. Do not touch any other README line.
- `skills/task-orchestrator/SKILL.md` line ~19: change `Load only that domain's skills.` to `Load only that domain's skills (for frontend work that includes `frontend-architecture`).` Keep the file within whatever size limit its existing test enforces.
- `packages/cli/tests/shared-skills-install.test.ts` line ~11: add `'frontend-architecture'` to the `FRONTEND` list.

- [ ] **Step 6: Run everything**

Run: `npm test`
Expected: PASS. If a test counts skills or lists them (for example sync-skills, evals skill lists, `verify` output expectations "26 skills"), update only that number or list and say which in the report. The golden fixtures must not change (they do not list skills; if one does, stop and report).

- [ ] **Step 7: Commit**

```bash
git add skills/frontend-architecture skills/task-orchestrator/SKILL.md README.md packages/core/tests/frontend-architecture-skill.test.ts packages/cli/tests/shared-skills-install.test.ts
git commit -m "skills: frontend-architecture"
```

(Add any other test file Step 6 made you touch.)

---

### Task 3: The guide contract

**Files:**
- Create: `packages/core/tests/stack-guides.test.ts`
- Modify: `packages/core/tests/backend-references-coverage.test.ts` (the status check, lines ~29-36)

**Interfaces:**
- Consumes: nothing.
- Produces: `GUIDES`, the array that Tasks 4–6 each append entries to, and the per-guide checks that run over it. With an empty array the suite passes; each guide task adds its entry together with its file.

- [ ] **Step 1: Write the contract test**

```ts
// packages/core/tests/stack-guides.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const kitRoot = fileURLToPath(new URL('../../../', import.meta.url));

interface Guide {
  skill: string;
  name: string;
  /** Patterns that must appear: the current practice the guide has to teach. */
  must: RegExp[];
  /** Patterns that must not appear: deprecated or wrong practice presented as current. */
  mustNot: RegExp[];
}

/** One entry per deepened stack guide. Each guide task appends its entry together with the file. */
export const GUIDES: Guide[] = [];

const SECTIONS = ['Princípio', 'Quando aplicar', 'Quando não aplicar', 'Exemplo', 'Estrutura do projeto', 'Dados e estado', 'Erros e validação', 'Testes', 'Armadilhas', 'Fonte'];
const read = (guide: Guide): string => readFileSync(join(kitRoot, 'skills', guide.skill, 'references', `${guide.name}.md`), 'utf8');

test('GUIDES entries name real files', () => {
  for (const guide of GUIDES) assert.ok(existsSync(join(kitRoot, 'skills', guide.skill, 'references', `${guide.name}.md`)), `${guide.skill}/${guide.name}`);
});

for (const guide of GUIDES) {
  test(`${guide.skill}/${guide.name}: frontmatter is exact and marks the file a guide`, () => {
    assert.match(read(guide), new RegExp(`^---\\nname: ${guide.name}\\ndescription: .{20,300}\\nstatus: guide\\n---\\n`));
  });

  test(`${guide.skill}/${guide.name}: has the sections in order, a Targets line, 80-200 lines and balanced code fences`, () => {
    const text = read(guide);
    let at = -1;
    for (const section of SECTIONS) {
      const index = text.indexOf(`\n## ${section}\n`);
      assert.ok(index > at, `section "${section}" missing or out of order`);
      at = index;
    }
    assert.match(text, /^Targets: .{10,}$/m, 'a "Targets: <framework and major versions>" line');
    const lines = text.split('\n').length;
    assert.ok(lines >= 80 && lines <= 200, `${lines} lines; expected 80-200`);
    const fences = (text.match(/^```/gm) ?? []).length;
    assert.ok(fences >= 2 && fences % 2 === 0, `${fences} code fences`);
  });

  test(`${guide.skill}/${guide.name}: teaches the current practice and none of the known-stale ones`, () => {
    const text = read(guide);
    for (const pattern of guide.must) assert.match(text, pattern, `must mention ${pattern}`);
    for (const pattern of guide.mustNot) assert.doesNotMatch(text, pattern, `must not contain ${pattern}`);
  });

  test(`${guide.skill}/${guide.name}: says what not to assume about the project`, () => {
    assert.match(read(guide), /do not (assume|add|introduce)|if the project (does not|doesn't)|only if the project/i);
  });
}
```

- [ ] **Step 2: Accept both statuses in the backend coverage test**

In `packages/core/tests/backend-references-coverage.test.ts` change the test at lines ~29-36: rename it to `'every reference frontmatter name matches its file name and is marked baseline or guide'` and change `status: baseline` in the regex to `status: (baseline|guide)`.

- [ ] **Step 3: Run**

Run: `cd packages/core && node --import tsx --test tests/stack-guides.test.ts tests/backend-references-coverage.test.ts`
Expected: PASS (the contract has no entries yet; the backend test still passes with both statuses allowed).

- [ ] **Step 4: Commit**

```bash
git add packages/core/tests/stack-guides.test.ts packages/core/tests/backend-references-coverage.test.ts
git commit -m "test: contract for deepened stack guides"
```

---

### Task 4: FastAPI and NestJS guides

**Files:**
- Modify: `skills/backend-architecture/references/fastapi.md`, `skills/backend-architecture/references/nestjs.md` (rewrite in place)
- Modify: `packages/core/tests/stack-guides.test.ts` (append two entries to `GUIDES`)

**Interfaces:**
- Consumes: the `GUIDES` array and its checks (Task 3).
- Produces: two guides with `status: guide`.

**How to write them (this is the task's substance).** Read the current file and the matching official docs first (FastAPI: fastapi.tiangolo.com — tutorial, "Bigger Applications", "Dependencies", "Testing", "Lifespan Events", "Settings"; NestJS: docs.nestjs.com — Modules, Providers, Pipes, Guards, Exception filters, Testing, Configuration). Keep the existing frontmatter keys (`name`, `description`, `status`) with `status: guide` and a new `description` (20–300 chars, one line, no longer "Baseline conventions"). Keep the four existing sections' meaning and add the five new ones, in the order of the Global Constraints, plus `## Fonte` last. Add one line `Targets: ...` under the title block naming the framework, the major versions and the language/runtime floor you confirmed in the docs. Examples must be complete enough to run in context and use the targeted API. Both files are written in the existing style: Portuguese section headings, English prose and code.

**Required content (confirm each in the docs; drop what the docs do not support):**

- **FastAPI** — project layout (routers per feature, `schemas`, `services`, `dependencies`); `Annotated[..., Depends(...)]` dependencies; app startup/shutdown through the `lifespan` context manager (not `on_event`); Pydantic v2 schemas (`model_config = ConfigDict(from_attributes=True)`, `model_validate`, field validators with `@field_validator`), separate input/output schemas, `response_model`; sync `def` vs `async def` endpoints (a blocking call inside `async def` blocks the event loop; sync endpoints run in a threadpool); database session per request through a dependency, commit/rollback in one place, SQLAlchemy 2.0 style (`select()`, `Session.execute`) only if the project already uses SQLAlchemy; settings with pydantic-settings only if present; error handling with `HTTPException` plus registered exception handlers and one consistent error body; testing with `TestClient` (or `httpx.AsyncClient` for async), `app.dependency_overrides` to swap the session/auth, and a test database strategy; pitfalls: blocking I/O in `async def`, returning ORM objects without `response_model`, mutable default arguments, N+1 queries, forgetting `status_code`, CORS misconfiguration, background tasks are not durable jobs.
- **NestJS** — module per feature (providers, controllers, `exports`), dependency injection and provider scopes (default singleton; request scope has a cost); DTOs validated by a global `ValidationPipe` with `whitelist: true` and `transform: true` (and `forbidNonWhitelisted` when the API should reject extras), class-validator/class-transformer only if the project uses them (otherwise follow its schema validator); the request pipeline order (middleware → guards → interceptors → pipes → handler → interceptors → exception filters) stated correctly; guards for authentication/authorization, interceptors for cross-cutting concerns, exception filters mapping domain errors to HTTP; configuration through `@nestjs/config`; persistence only through the project's ORM; testing with `Test.createTestingModule`, `overrideProvider`/`overrideGuard`, and e2e with `supertest` — noting that global pipes/filters registered in `main.ts` must be applied again in the e2e setup; pitfalls: circular dependencies (`forwardRef` is a smell), forgetting `@Injectable()`, request-scoped providers spreading through the graph, business logic in controllers, leaking entities instead of DTOs, unvalidated `@Param`/`@Query`.

- [ ] **Step 1: Append the contract entries first (RED)**

In `packages/core/tests/stack-guides.test.ts` replace `export const GUIDES: Guide[] = [];` with:

```ts
export const GUIDES: Guide[] = [
  {
    skill: 'backend-architecture',
    name: 'fastapi',
    must: [/lifespan/, /Annotated\[/, /response_model/, /dependency_overrides/, /model_config|from_attributes/, /async def/, /Targets: .*FastAPI/],
    mustNot: [/@app\.on_event/, /\borm_mode\b/, /@validator\(/, /\.dict\(\)/]
  },
  {
    skill: 'backend-architecture',
    name: 'nestjs',
    must: [/Test\.createTestingModule/, /ValidationPipe/, /whitelist/, /overrideProvider|overrideGuard/, /supertest/, /guards?.*interceptors?.*pipes?|middleware.*guards?/is, /Targets: .*NestJS/],
    mustNot: []
  }
];
```

Run: `cd packages/core && node --import tsx --test tests/stack-guides.test.ts`
Expected: FAIL (the current baselines are 39 and 43 lines, `status: baseline`, and lack the new sections).

- [ ] **Step 2: Write `fastapi.md` and `nestjs.md`** as described above, fetching the official docs for the points listed.

- [ ] **Step 3: Run to verify it passes**

Run: `cd packages/core && node --import tsx --test tests/stack-guides.test.ts tests/backend-references-coverage.test.ts && npm test`
Expected: PASS. If a `must`/`mustNot` pattern contradicts the official docs for the version you targeted, change the pattern in the same commit and say which and why in the report; do not weaken a pattern just to make the file pass.

- [ ] **Step 4: Self-check the examples**

For each guide, re-read every code example against the docs page you took it from. Report, per guide, the docs URLs used and the exact versions in the `Targets:` line.

- [ ] **Step 5: Commit**

```bash
git add skills/backend-architecture/references/fastapi.md skills/backend-architecture/references/nestjs.md packages/core/tests/stack-guides.test.ts
git commit -m "skills: FastAPI and NestJS guides"
```

---

### Task 5: Vue and Nuxt guides

**Files:**
- Create: `skills/frontend-architecture/references/vue-stack.md`, `skills/frontend-architecture/references/nuxt-stack.md`
- Modify: `packages/core/tests/stack-guides.test.ts` (append two entries)

**Interfaces:**
- Consumes: `skills/frontend-architecture/` (Task 2), the selector's reference names (Task 1), the `GUIDES` contract (Task 3).
- Produces: two guides, `vue-stack` and `nuxt-stack`.

**How to write them.** Official docs: vuejs.org (guide, API, Style Guide, Testing), router.vuejs.org, pinia.vuejs.org; nuxt.com (docs: directory structure, data fetching, server directory, runtime config, testing). Same frontmatter, headings, `Targets:` line and style rules as Task 4 (Global Constraints). Name the major versions confirmed in the docs (Vue 3.x; Nuxt 3 or 4 — whichever the current docs describe; if the docs describe both, target the current major and state differences in one line).

**Required content (confirm in the docs; drop what they do not support):**

- **vue-stack** — Composition API with `<script setup lang="ts">` as the default, Options API only when the project already uses it; typed `defineProps`/`defineEmits`, `defineModel` where the targeted version has it; composables (`useX`) for reusable stateful logic; reactivity rules (`ref` vs `reactive`, destructuring a `reactive` object loses reactivity, `toRefs`/`storeToRefs`, `computed` for derived state instead of copying into a `ref`, `watch` for side effects); component structure (smart containers vs presentational components, props down / events up, `provide`/`inject` for narrow cases); Pinia setup or options stores only if the project uses Pinia, state kept minimal and derived values as getters; Vue Router (route-level code splitting, navigation guards, params as strings); forms and validation; `v-for` with a stable `:key`; testing with Vitest + `@vue/test-utils` (`mount` vs `shallowMount`, awaiting `nextTick`/`flushPromises`, testing behavior not implementation) only if the project uses them; pitfalls: mutating props, `v-if` with `v-for`, forgetting `.value`, stale closures in watchers, large reactive objects, memory leaks from unremoved listeners.
- **nuxt-stack** — directory conventions (`pages/`, `layouts/`, `components/`, `composables/`, `server/`, `middleware/`, `plugins/`), auto-imports (and that they are an implementation detail, not a license to skip imports in non-Nuxt files); data fetching with `useFetch`/`useAsyncData` (keys, SSR hydration, `watch`, `pending`/`error`, `refresh`) versus `$fetch` in event handlers; the server directory (`server/api/*.ts` with `defineEventHandler`, input validation, errors via `createError`); `runtimeConfig` with the public/private split and environment variables (secrets only on the server side); `useState` for SSR-safe shared state and Pinia only if present; route middleware and `definePageMeta`; rendering modes (SSR, SPA, hybrid `routeRules`) stated as the docs describe them; `<ClientOnly>` and hydration mismatches; testing with `@nuxt/test-utils` and Vitest only if the project uses them; pitfalls: browser APIs during SSR, non-unique `useAsyncData` keys, fetching in `onMounted` instead of `useAsyncData`, exposing secrets in `runtimeConfig.public`, mixing server-only code into client bundles.

- [ ] **Step 1: Append the contract entries first (RED)**

Add to `GUIDES` in `packages/core/tests/stack-guides.test.ts`:

```ts
  {
    skill: 'frontend-architecture',
    name: 'vue-stack',
    must: [/<script setup/, /defineProps/, /defineEmits/, /storeToRefs|computed/, /:key/, /@vue\/test-utils|flushPromises/, /Targets: .*Vue/],
    mustNot: [/\bmixins?\b.*recommended/i, /Vue\.component\(/, /new Vue\(/, /\bVuex\b.*(use|recommended)/i]
  },
  {
    skill: 'frontend-architecture',
    name: 'nuxt-stack',
    must: [/useFetch|useAsyncData/, /\$fetch/, /runtimeConfig/, /defineEventHandler/, /createError/, /server\/api/, /ClientOnly|hydration/i, /Targets: .*Nuxt/],
    mustNot: [/asyncData\s*\(/, /@nuxtjs\/axios/, /\bnuxtServerInit\b/, /nuxt\.config\.js\b/]
  }
```

Run: `cd packages/core && node --import tsx --test tests/stack-guides.test.ts`
Expected: FAIL (the two files do not exist).

- [ ] **Step 2: Write `vue-stack.md` and `nuxt-stack.md`**, fetching the official docs for the points above. Create `skills/frontend-architecture/references/` as needed.

- [ ] **Step 3: Run to verify it passes**

Run: `npm test`
Expected: PASS, including the kit-wide unique-name test in `backend-references-coverage.test.ts` (it reads every skill's `references/`, so a name clash with `figma-to-code` would fail here).

- [ ] **Step 4: Self-check the examples** (same as Task 4 Step 4: re-read each example against the docs page; report URLs and the exact `Targets:` lines).

- [ ] **Step 5: Commit**

```bash
git add skills/frontend-architecture/references packages/core/tests/stack-guides.test.ts
git commit -m "skills: Vue and Nuxt guides"
```

---

### Task 6: The Next.js guide, reachability, and the review hand-off

**Files:**
- Create: `skills/frontend-architecture/references/next-stack.md`
- Modify: `packages/core/tests/stack-guides.test.ts` (append one entry, add the reachability test)

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: the third frontend guide; a test proving every hint the frontend selector can return points at an existing file; the manual checklist for the project owner.

**How to write it.** Official docs: nextjs.org/docs (App Router: routing, rendering, data fetching and caching, Server and Client Components, Server Actions, Route Handlers, error handling, testing). Same frontmatter, headings, `Targets:` line and style rules as Task 4. The fixture `evals/fixtures/nextjs-app` uses Next.js `^15.0.0` with React 19; state the exact major(s) you confirm in the docs and explain any behavior that differs between 14/15/16 in one line each (caching defaults, async request APIs, middleware naming).

**Required content (confirm in the docs; drop what they do not support):** App Router layout (`app/`, `layout.tsx`, `page.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, route groups, colocation); Server Components by default and the smallest possible `'use client'` boundary; what can be passed across the boundary (serializable props); data fetching in Server Components and the caching/revalidation model as the docs describe it for the targeted version (`revalidatePath`/`revalidateTag`, explicit opt-in vs default caching); Server Actions (`'use server'`) with input validation and authorization checked inside the action, because actions are public endpoints; Route Handlers (`route.ts`); async `params`/`searchParams`/`cookies()`/`headers()` where the targeted version requires `await`; environment variables (`NEXT_PUBLIC_` exposes to the browser; secrets stay server-side); middleware (and its current name for the targeted version); forms and `useActionState`/`useFormStatus` if the targeted version has them; testing: unit tests for client components and pure functions with the project's runner, and the docs' guidance that async Server Components are better covered by end-to-end tests; pitfalls: leaking secrets into Client Components, sequential fetch waterfalls, using `'use client'` at the top of the tree, un-awaited `params`, stale cache after a mutation, importing server-only code into a client module (`server-only`).

- [ ] **Step 1: Append the contract entry and the reachability test first (RED)**

Add to `GUIDES`:

```ts
  {
    skill: 'frontend-architecture',
    name: 'next-stack',
    must: [/Server Components?/, /'use client'/, /'use server'|Server Actions?/, /NEXT_PUBLIC_/, /revalidate(Path|Tag)/, /route\.ts/, /await params|params: Promise/, /Targets: .*Next\.js/],
    mustNot: [/getServerSideProps/, /getStaticProps/, /getInitialProps/, /pages\/api/]
  }
```

(If the guide deliberately mentions the Pages Router as "not covered", reword the `mustNot` to the call forms, for example `/export (async )?function getServerSideProps/`, and say so in the report.)

Append to `packages/core/tests/stack-guides.test.ts`:

```ts
import { selectFrontendReferences } from '../src/frontend-references.ts';
import type { ProjectProfile } from '../src/project-profile.ts';

test('every hint the frontend selector can produce points at a real guide, and every frontend guide is reachable', () => {
  const everything: ProjectProfile = { languages: ['typescript'], frameworks: ['vue', 'nuxt', 'next', 'react'], testCommands: [], lintCommands: [], typecheckCommands: [], docker: false };
  const hints = selectFrontendReferences(everything);
  for (const hint of hints) assert.ok(existsSync(join(kitRoot, 'skills', hint.skill, 'references', `${hint.reference}.md`)), `${hint.skill}/${hint.reference}`);
  const frontend = GUIDES.filter((g) => g.skill === 'frontend-architecture').map((g) => g.name).sort();
  assert.deepEqual(hints.map((h) => h.reference).sort(), frontend);
});
```

Run: `cd packages/core && node --import tsx --test tests/stack-guides.test.ts`
Expected: FAIL (`next-stack.md` does not exist).

- [ ] **Step 2: Write `next-stack.md`** from the official docs.

- [ ] **Step 3: Run to verify it passes**

Run: `npm test`
Expected: PASS everywhere.

- [ ] **Step 4: Self-check the examples** (re-read each against the docs; report URLs and the `Targets:` line).

- [ ] **Step 5: End-to-end proof on the fixtures**

Run, and put the output in the report:

```bash
for app in vue-app nuxt-app nextjs-app fastapi-app nest-app; do echo "== $app"; node packages/cli/bin/dev-agent.mjs inspect --project evals/fixtures/$app | grep -E "references"; done
node packages/cli/bin/dev-agent.mjs install claude --project "$(mktemp -d)" 2>&1 | grep -E "skills →"
```

Expected: the references named in the spec for each fixture, and `27` skills' worth of files (the `skills →` line reports the added count; confirm `frontend-architecture/SKILL.md` and its three references are among them by listing the temp dir's `.claude/skills/frontend-architecture/references/`).

- [ ] **Step 6: Commit**

```bash
git add skills/frontend-architecture/references/next-stack.md packages/core/tests/stack-guides.test.ts
git commit -m "skills: Next.js guide and reference reachability test

Manual review (project owner, not run by the implementer):
- [ ] read fastapi.md and nestjs.md against the official docs for the versions in their Targets line
- [ ] read vue-stack.md and nuxt-stack.md against vuejs.org / nuxt.com for the versions in their Targets line
- [ ] read next-stack.md against nextjs.org/docs for the version in its Targets line
- [ ] run the FastAPI and NestJS backend eval scenarios before and after (they cost tokens)
- [ ] try the references on the vagas project (FastAPI + Vue) with a real task"
```

---

## Self-Review

**Spec coverage**
- Decisions 1–3 (no per-stack skills; one richer file per stack; one `frontend-architecture` skill): Tasks 2, 4–6.
- Goals 1–4: guides (4–6), selector and `inspect` (1), contracts (3 and the per-guide checks), no install/verify change (Global Constraints; Task 2 Step 6 and Task 6 Step 5 verify the install).
- Design: skill (2), the five files with sections, `Targets:`, `status: guide` (3–6), selector rules and export (1), `inspect` line and `frontendReferences` (1), backend coverage test accepting `guide` (3), new coverage and selector tests (1, 3, 6), counts and orchestrator line (2).
- Testing 1–5: selector/contracts (1, 3), existing suites with only count/status changes (2, 3), fixtures through `inspect` (1, 6 Step 5), owner review and manual benchmark (Task 6 commit body).
- Risks: stale guidance → `mustNot` patterns and the docs-win rule; context cost → one skill only; `inspect --json` new field → Task 1 tests; version targets → recorded in `Targets:`.

**Placeholder scan:** the three guide tasks specify required content, structure, contract patterns, sources and acceptance tests rather than the full text, because the text must be written from the official docs at implementation time (spec Design, "Sourcing"); there is no TBD/TODO.

**Type consistency:** `selectFrontendReferences(profile): ReferenceHint[]` and `ReferenceHint` (Task 1) are used by the reachability test (Task 6); `GUIDES: Guide[]` (Task 3) gets entries in Tasks 4–6; reference names `vue-stack`, `nuxt-stack`, `next-stack` are the same in the selector, the contract and the spec.

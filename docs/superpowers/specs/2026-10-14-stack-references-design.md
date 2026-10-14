# Stack references: FastAPI, NestJS, Vue, Nuxt, Next.js (dev-agent-kit v1.2, block B)

Date: 2026-10-14 · Status: draft for review · Parent: v1.2 decomposition (blocks A–E) · Depends on: none

## Context

The kit loads framework knowledge from `references/` files, chosen by detecting the project's stack (`selectBackendReferences` in `packages/core/src/backend-references.ts`, shown by `dev-agent inspect`). Today all 33 references carry `status: baseline` and are about 40 lines (sections: Princípio, Quando aplicar, Quando não aplicar, Exemplo).

What exists for the four stacks the project owner works in:

| Stack | Today |
|-------|-------|
| FastAPI | `backend-architecture/references/fastapi.md`, baseline (39 lines), selected when `fastapi` is detected |
| NestJS | `backend-architecture/references/nestjs.md`, baseline (43 lines), selected when `nestjs` is detected |
| Vue, Nuxt, Next.js | only `figma-to-code/references/{vuejs,nuxt,nextjs}.md`, which describe implementing a Figma design; nothing about structure, data, state or testing, and no selector (the profile already detects `vue`, `nuxt`, `next`, `react`) |

Facts that constrain the design (checked in the code on 2026-10-14):

- `packages/core/tests/backend-references-coverage.test.ts` requires every backend reference to have frontmatter `name`, `description` (20–300 chars) and exactly `status: baseline`, and requires reference names to be **unique across the whole kit** (a read must identify one file). `vuejs`, `nuxt` and `nextjs` are taken by `figma-to-code`.
- The frontend skills (`frontend-design`, `component-selection`, …) are about UI heuristics and component reuse. There is no frontend counterpart of `backend-architecture`.
- Skill counts are hard-coded in `README.md` ("26 skills", "Frontend (7)") and in the install test's `FRONTEND` list.
- `dev-agent inspect` prints `backend references: ...` and its `--json` has `profile` and `backendReferences`.
- Fixtures for evals already exist (`fastapi-app`, `nest-app`, `vue-app`, `nuxt-app`, `nextjs-app`) with backend scenarios for FastAPI and NestJS.

## Decisions (made with the project owner on 2026-10-14)

1. **Deepen references; no per-stack skills.** The existing mechanism (detect the stack, load one file) stays. Four per-stack skills were rejected: each adds a description to the always-on context, against the kit's own `context-efficiency` skill.
2. **One richer file per stack** (about 100–150 lines, up from about 40), not a folder of topic files with a task classifier the kit does not have.
3. **One new skill, `frontend-architecture`**, symmetric with `backend-architecture` (which already holds the FastAPI and NestJS references), to hold the Vue, Nuxt and Next.js references. Putting them in `frontend-design` was rejected: it would blur that skill's purpose.

## Goals

1. FastAPI, NestJS, Vue, Nuxt and Next.js each have a reference an agent can follow for everyday work in that stack: structure, data and state, errors and validation, tests, common pitfalls.
2. The kit selects the frontend references from the detected stack, the same way it selects backend ones, and `inspect` shows them.
3. The contracts that guard references (frontmatter, unique names, selector coverage) are updated, not bypassed.
4. No change to `install`, `verify` or any host adapter: skills are copied automatically.

## Non-goals

- References for React, Angular, Svelte, Tailwind (beyond what `figma-to-code` has) or other backends.
- Changing `figma-to-code` or its references.
- New eval scenarios. The fixtures exist; running a real benchmark costs tokens and stays a manual checklist.
- Per-task reference selection (decision 2).

## Design

### The skill `skills/frontend-architecture/SKILL.md`

Mirrors `backend-architecture`: frontmatter `name`, a `description` of one or two sentences (what it does and when to use it, same register as the others), then: detect the stack first (`repository-investigation`), load **only** the matching file from `references/`, never assume a stack the repository does not use; a short workflow (read the closest existing screen/route/component, data and state ownership, error and loading states, tests); rules (follow the architecture that exists, no new layer or dependency without a reason, production read-only, no secrets in code); a Definition of Done checklist. The SKILL.md names **no framework** (like the backend skills); frameworks appear only in `references/`.

### The references

| File | Change | Selected when |
|------|--------|---------------|
| `backend-architecture/references/fastapi.md` | `baseline` → `guide`, 100–150 lines | `fastapi` detected (unchanged) |
| `backend-architecture/references/nestjs.md` | `baseline` → `guide` | `nestjs` detected (unchanged) |
| `frontend-architecture/references/vue-stack.md` | new | `vue` detected |
| `frontend-architecture/references/nuxt-stack.md` | new | `nuxt` detected |
| `frontend-architecture/references/next-stack.md` | new | `next` detected |

Names carry the `-stack` suffix only for the frontend files, to stay unique against `vuejs`, `nuxt` and `nextjs`.

Every file keeps the existing sections (Princípio, Quando aplicar, Quando não aplicar, Exemplo) and adds, in this order: **Estrutura do projeto**, **Dados e estado** (persistence for the backends, server and client state for the frontends), **Erros e validação**, **Testes**, **Armadilhas**. Each file states in a line `Targets: <framework and the major versions it was written for>` and tells the reader to check the project's version before applying it. Examples use the real API of the version in the `Targets:` line.

Sourcing: the content is written from each stack's official documentation, fetched during implementation, at the current major version (for example FastAPI with Pydantic v2 and lifespan handlers, NestJS modules/providers/pipes/guards and `Test.createTestingModule`, Vue 3 `<script setup>` with Pinia and Vue Router, Nuxt `useFetch`/`useAsyncData` and `server/` routes, Next.js App Router with Server Components and Server Actions). The reference says what the project should not be assumed to use (an ORM, a state library) exactly as the baselines do.

Frontmatter of the five deepened files: `name` (equal to the file name), `description` (20–300 chars), `status: guide`. The other 28 references keep `status: baseline`.

### The selector `packages/core/src/frontend-references.ts`

```ts
export function selectFrontendReferences(profile: ProjectProfile): ReferenceHint[];
```

Reuses `ReferenceHint` (`{ skill, reference, reason }`). Rules, deterministic order, no duplicates, `[]` when there is no signal:

- `nuxt` → `frontend-architecture/nuxt-stack` ("Nuxt detected")
- `vue` → `frontend-architecture/vue-stack` ("Vue detected"), also for Nuxt projects, which declare `vue`
- `next` → `frontend-architecture/next-stack` ("Next.js detected")

Exported from `packages/core/src/index.ts` next to `selectBackendReferences`. A fullstack repository (for example Next.js + FastAPI) gets both the frontend and the backend lists.

### `dev-agent inspect`

`packages/cli/src/dev-cli.ts` prints one more line, `frontend references: <skill>/<reference>, ...` (or `-`), after `backend references`. With `--json`, the object gains `frontendReferences` (an array of hints) next to `backendReferences`; no existing field changes.

### Contracts and counts

- `backend-references-coverage.test.ts`: the status check accepts `baseline` or `guide`, and requires `guide` for `fastapi` and `nestjs`. The list of 25 backend names does not change.
- New `frontend-references-coverage.test.ts` (core): the three files exist under `frontend-architecture`; names are unique across the kit; frontmatter shape and `status: guide`; each of the five deepened files has the five new sections, a `Targets:` line and 80–200 lines; every hint the selector can return points to a file that exists; `frontend-architecture/SKILL.md` names no framework.
- New `frontend-references.test.ts` (core): selector rules, ordering, no duplicates, empty on no signal, Nuxt gets both, fullstack gets both lists.
- Counts: `README.md` "26 skills" → 27, "Frontend (7)" → "Frontend (8)" with the name added; the install test's `FRONTEND` list gains `frontend-architecture`; any docs that list the frontend skills are updated.
- `task-orchestrator/SKILL.md`: the frontend hand-off line also names `frontend-architecture`.

## Testing

1. Selector and reference contracts as above (deterministic, no network).
2. Existing suites keep passing with only the count and status expectations above changed; the golden install fixtures do not change (they do not list skills).
3. `dev-agent inspect` on the `evals/fixtures` apps: `vue-app` shows `vue-stack`, `nuxt-app` shows `nuxt-stack` (and `vue-stack` when its `package.json` declares `vue`, as Nuxt projects normally do; the test asserts what the fixture really declares), `nextjs-app` shows `next-stack`, `fastapi-app` and `nest-app` show their backend references and no frontend ones, and `fullstack-app` shows both lists (checked in a CLI test).
4. Content review (manual, by the project owner): read the five files against the official docs for the versions they state.
5. Manual benchmark (not automated, costs tokens): run the existing backend scenarios for FastAPI and NestJS before and after, and try the new references on the `vagas` project (FastAPI + Vue) for a real task.

## Risks and open items

1. **Accuracy and age.** Framework guidance goes stale. Mitigations: official-doc sourcing, the `Targets:` line, and the instruction to check the project's version. The owner's content review (Testing 4) is the real gate.
2. **Context cost.** One more skill description is always loaded, and a matching reference is about 2k tokens when a stack is detected.
3. **`inspect --json` gains a field.** Consumers that compare the whole object would notice; the repository's own tests are updated in the plan.
4. **Version targets.** The exact versions each file targets (for example Nuxt 3 vs 4, Next.js 15 vs 16) are decided when the official docs are read during implementation and recorded in the `Targets:` line; if the docs disagree with this spec's examples, the docs win.

## Out of scope

Blocks A, C and D (D is merged), each with its own spec.

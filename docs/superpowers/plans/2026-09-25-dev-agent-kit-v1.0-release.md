# Dev Agent Kit v1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v1.0.0: a compatibility decision for `frontend-agent`, an installable package, a complete README, the adapter-authoring, generic-MCP and migration guides, and release notes, with the two real benchmarks declared as the owner's pending step.

**Architecture:** The repository root becomes the publishable package `dev-agent-kit` (workspaces stay for development; `files` whitelists what ships). Its `bin` exposes `dev-agent` plus `frontend-agent` and `frontend-agent-kit` as permanent compatibility aliases (spec §25 option A). The kit locates itself by directory (skills/ + a known package name), so an installed copy works from `node_modules`. Docs are checked by a test so commands and links cannot rot.

**Tech Stack:** Node ≥ 20, TypeScript run through `tsx`, `node:test`, `npm pack`.

**Spec:** `docs/superpowers/specs/2026-09-24-dev-agent-kit-evolution.md` (§25 compatibility, §38 v1.0 checklist, §43 compatibility rules).

## Global Constraints

- Compatibility (§43): `frontend-agent install|verify` keep working and keep their exit codes; the seven frontend skills keep their names; MCP tool names unchanged; `.frontend-agent/config.yml` keeps working; existing eval scenarios (36) stay valid.
- "Do not silently remove it" (§25): `frontend-agent` stays as an alias with **no removal date**; any future removal needs its own migration plan.
- The deterministic CLI never runs an LLM, opens the network, or mutates Git beyond what earlier versions do.
- Skills stay ≤ 60 lines and neutral (no framework names) — v1.0 changes no skill body.
- The real Claude and Codex benchmarks are the owner's step: this release never runs `npm run bench` and never claims results.
- Publishing to the npm registry and creating the GitHub release are outward-facing: the plan builds and verifies the tarball and the notes; the executor asks before `npm publish`, `gh release create`, merge, tag and push.
- No secrets in the package: the packed file list is checked and scanned.

## Review Focus

1. **Installed layout.** From `node_modules/dev-agent-kit` (global or local, dependencies hoisted or nested) the CLI must find the kit root, find `tsx`, and write MCP config with a launcher path that exists.
2. **What ships.** The tarball must contain skills, integrations, bins and the sources they import, and must not contain tests, `evals/results`, `.worktrees`, `docs/superpowers`, `.env*`, `.dev-agent/` state or `.pyc` files.
3. **Alias fidelity.** `frontend-agent --version`, `--help` and `install/verify` exit codes are identical whichever bin name is used; nothing prints a deprecation warning that would break scripts parsing output.
4. **Docs truth.** Every `dev-agent …` command and flag in README/docs exists in `--help`; every relative link resolves; no doc claims benchmark results.
5. **Version coherence.** One version everywhere (`--version`, all `package.json`, lockfile, release notes, tag).

## Decisions recorded (confirm or overrule)

1. **Compatibility: option A.** `frontend-agent` and `frontend-agent-kit` remain aliases of the same install/verify code, forever until a documented migration says otherwise. The repo keeps its historical package layout under `packages/*`.
2. **Package: root `dev-agent-kit@1.0.0`** (the name is free on npm). The GitHub release carries the `npm pack` tarball so `npm install -g <tarball-url>` works with no registry. `npm publish` is a one-line step left to the owner.
3. **Benchmarks:** README and release notes state "not yet run" with the exact commands; results will be added by the owner.

---

### Task 1: Installable layout and compatibility aliases

**Files:** modify `package.json`, `packages/cli/src/util.ts` (`findKitRoot`), `packages/cli/src/mcp-launch.ts`; create `bin/dev-agent.mjs`, `bin/frontend-agent.mjs` (thin `import('../packages/cli/bin/…')` wrappers); tests `packages/cli/tests/util.test.ts`, `packages/cli/tests/mcp-launch.test.ts` (create if absent), `packages/cli/tests/cli.test.ts`.

**Interfaces:**
- Consumes: `findKitRoot(fromDir)` (currently requires `name === 'frontend-agent-kit'`), `mcpLaunchCommand`/config builder in `mcp-launch.ts`.
- Produces: `findKitRoot` accepts `dev-agent-kit` **and** `frontend-agent-kit`; `resolveTsx(kitRoot): string` returns the first existing of `<kitRoot>/node_modules/.bin/tsx`, then `.bin/tsx` in each ancestor directory up to the filesystem root (hoisted installs), else throws a clear error.

Steps:
- [ ] **Step 1: Failing tests.** `findKitRoot` finds a temp dir whose package.json is named `dev-agent-kit` (with `skills/`), still finds `frontend-agent-kit`, and ignores other names; `resolveTsx` prefers the kit's own `.bin/tsx`, finds a hoisted one in a parent `node_modules/.bin`, and throws `could not find tsx` when none exists; the MCP config uses the resolved path; `runDev(['--version'])` and `run(['--version'])` print the same string.
- [ ] **Step 2: Run, watch them fail** (`node --import tsx --test packages/cli/tests/util.test.ts packages/cli/tests/mcp-launch.test.ts`).
- [ ] **Step 3: Implement.** Root `package.json`: `name: "dev-agent-kit"`, `version: "1.0.0"`, remove `private`, `bin` (`dev-agent`, `frontend-agent`, `frontend-agent-kit` → `bin/*.mjs`), `engines.node >=20`, `license`/`repository`/`description`/`keywords`, `files` whitelist (`bin`, `skills`, `integrations`, `packages/{cli,core,mcp-server}/{package.json,bin,src}`, `README.md`, `docs/*.md`, `docs/release-notes`), and `dependencies` = the union of the runtime dependencies of cli, core and mcp-server (versions copied verbatim). Keep `workspaces`. Wrappers use `await import(new URL('../packages/cli/bin/…', import.meta.url))`. Both `.mjs` files executable (`chmod +x`).
- [ ] **Step 4: Run cli suite + typecheck.** Commit: `git commit -m "feat: installable package layout with frontend-agent compatibility aliases"`.

---

### Task 2: Package verification (list, secrets, install smoke)

**Files:** create `scripts/verify-package.mjs`, `scripts/smoke-install.mjs`; modify root `package.json` scripts (`verify:package`, `smoke:package`); test `packages/cli/tests/package-manifest.test.ts`.

**Interfaces:**
- Consumes: `npm pack --dry-run --json` output (file list), `findSecret` from core (via tsx) for the scan.
- Produces: `verify:package` (fast, offline): fails when the packed list misses `skills/`, `integrations/claude/CLAUDE.md`, `integrations/codex/AGENTS.md`, `bin/*.mjs`, `packages/cli/src/dev-index.ts`, `packages/core/src/index.ts`, `packages/mcp-server/src/index.ts`, or contains any of: `/tests/`, `evals/`, `.worktrees`, `docs/superpowers`, `.env`, `.dev-agent/`, `.frontend-agent/`, `.pyc`, `node_modules`; and when any packed text file matches a secret pattern. `smoke:package` (slow, needs network for dependencies; **not** part of `npm test`): packs, installs the tarball into a temp prefix, runs `dev-agent --version` (= 1.0.0), `frontend-agent --version`, `dev-agent install claude --project <temp git project> --no-figma`, `dev-agent verify claude --project <same>` and asserts exit 0 and that the written `.mcp.json` launcher path exists.

Steps:
- [ ] **Step 1: Failing test** (`package-manifest.test.ts`): parse the root `package.json` — bins point to existing files, `files` includes the required entries, `dependencies` contains every runtime dependency of cli/core/mcp-server at the same range, no `private`, versions of all four workspace packages equal the root version.
- [ ] **Step 2: Run, fail** (versions differ until Task 4 → the test compares against the root version so it can pass earlier; the RED is the missing `files`/`dependencies`/`bin` handled in Task 1 if not yet — otherwise write the test for `verify-package` behaviour: run it against a fixture list and expect failures for each forbidden path).
- [ ] **Step 3: Implement** both scripts (plain Node, no dependencies beyond the repo's).
- [ ] **Step 4: Run** `npm run verify:package` and `npm run smoke:package`; read the output. A smoke failure is a defect in Task 1 to fix here, with a test. Commit: `git commit -m "chore: verify the packed files and smoke-install the tarball"`.

---

### Task 3: Documentation — README, adapter guide, generic-MCP guide, migration guide

**Files:** rewrite `README.md`; create `docs/task-source-adapters.md`, `docs/generic-mcp.md`, `docs/migration-from-frontend-agent.md`; modify `docs/cli.md` only if a command is missing; test `packages/cli/tests/docs.test.ts`.

**Interfaces:**
- Consumes: `DEV_HELP` (dev-cli.ts), `packages/core/src/task-sources/{types,registry,generic-mcp,mapping,normalizer,resolver}.ts`, `skills/task-orchestrator/references/{task-source,generic-mcp}.md`, `config.ts` — read them before writing; docs describe what the code does.
- Produces: docs consistent with the code, plus `docs.test.ts` that (a) extracts every `dev-agent <command words>` from fenced code blocks in README and `docs/*.md` (excluding `superpowers/`) and requires it to be a command listed in `DEV_HELP`; (b) requires every relative Markdown link in those files to resolve to an existing file; (c) requires README to contain the sections named below.

README structure (replaces the v0.1-era text; keep the history pointer to the evolution spec): 1. What it is (one paragraph: provider-neutral engineering agent kit for Claude Code and Codex, skills + deterministic CLI + own MCP server); 2. Install (from tarball/`npm i -g`, or from a checkout) and per-project `dev-agent install`/`verify`; 3. Quick start (configure a task source, "analyze and execute KEY", what the ledger and branch do); 4. What is in the box (26 skills by domain, CLI command table linking `docs/cli.md`, MCP tools); 5. Task sources (`docs/generic-mcp.md`, `docs/task-source-adapters.md`); 6. Backend, fullstack, repository patterns (links to their docs); 7. Compatibility (alias policy, link to migration guide); 8. Benchmarks — **status: not yet run**, with `npm run evals:validate` (offline, 36 scenarios) and `npm run bench` (real, owner) and where results go; 9. Contributing/verification commands; 10. Version history summary v0.5 → v1.0 (short list, details in release notes).

Guides:
- `task-source-adapters.md`: when to use declarative `generic-mcp` (link) vs a custom adapter; the `TaskSourceAdapter` contract and capabilities; the canonical `WorkItem`; registering an adapter; where custom adapters live (`integrations/task-sources/<id>/`) and how `sources verify` reports one that cannot be loaded; read-vs-write policy; a complete worked example (a fake tracker with a paginated search) and how to test it with the normalizer; the checklist "an adapter is done when…".
- `generic-mcp.md`: the config keys, `identifiers` regex rules (single quotes, one backslash, at most one `default`), tool declarations (`arg`, `list`), dotted-path mapping, the two-payload example from `docs/task-orchestrator.md`, collection mappings, MCP envelope handling, common mistakes and the error the parser gives for each, and a verification recipe with `dev-agent sources verify` and `dev-agent task resolve <KEY> --probe`.
- `migration-from-frontend-agent.md`: what changes (package `dev-agent-kit`, new `dev-agent` CLI), what does not (commands, skill names, MCP tool names, `.frontend-agent/config.yml`), command mapping table (`frontend-agent install` = `dev-agent install`, …), new config file `.dev-agent/config.yml` and how both coexist, upgrade steps (reinstall, `dev-agent install --force` only if local skill edits should be overwritten, `dev-agent verify`), rollback, and the no-removal-date policy.

Steps:
- [ ] **Step 1: Failing docs test** (`docs.test.ts`) — expect failures for the missing files/sections and for any stale command or link.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Write the docs**, reading the sources named above first; fix every failure the test reports.
- [ ] **Step 4: Run cli suite; commit** — `git commit -m "docs: README, adapter guide, generic-mcp guide and migration guide"`.

---

### Task 4: Release notes, version 1.0.0 and full verification

**Files:** create `docs/release-notes/v1.0.0.md`; modify version in `packages/{cli,core,evals,mcp-server}/package.json`, lockfile, the two version assertions in `packages/cli/tests/` (`cli.test.ts`, `util.test.ts`); README history section links the notes.

Release notes content: highlights (task orchestration, backend domain in six languages, fullstack contract, dev-agent CLI, repository index and diff review), per-version summary v0.6–v0.11, compatibility statement (what is unchanged), install instructions, the **benchmark status** ("Claude and Codex real benchmarks: not yet run; run `npm run bench`; results are added to `evals/results/` and to these notes by the owner"), known limits (deferred minors: reference prose nits; heuristics are path-based), and upgrade pointer.

- [ ] **Step 1:** update tests to expect `1.0.0` (watch them fail), then bump every version and `npm install --package-lock-only`.
- [ ] **Step 2: Run everything:** `npm test`, `npm run typecheck --workspaces --if-present`, `npm run validate:skills`, `npm run evals:validate` (36), `npm run verify:package`, `npm run smoke:package`.
- [ ] **Step 3: Commit** — `git commit -m "chore: release v1.0.0 — package, compatibility policy, guides and release notes"`.

---

## Self-review

**Spec coverage (§38 v1.0):** package naming/compat decision → Decisions 1–2, Task 1, migration guide; installable package → Tasks 1–2; complete README → Task 3; adapter authoring guide → Task 3; generic MCP mapping documentation → Task 3; migration guide → Task 3; Claude/Codex real benchmark → **owner's step**, declared in README and notes; release notes → Task 4; versioned GitHub release → after review, with approval (`gh release create v1.0.0 <tarball>`).

**Deliberately not in this release:** removing or renaming `frontend-agent`; publishing to npm (owner decision, one command); running real benchmarks; a standalone harness (§25); changes to skills, evals or MCP tools; a bundler or precompiled build (the package runs TypeScript through `tsx`, as the repository always has).

**Placeholder scan:** README and guide content is specified by section and by the source files it must be derived from; the executor reads those files and the docs test enforces commands and links. Scripts are specified by exact checks.

**Type consistency:** `findKitRoot` and `resolveTsx` (Task 1) are consumed by `mcp-launch.ts` and by the smoke script (Task 2); the version string asserted in Task 1's alias test is `readKitVersion()`, so it follows Task 4's bump without a hard-coded value there.

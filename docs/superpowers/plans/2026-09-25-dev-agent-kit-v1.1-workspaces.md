# Dev Agent Kit v1.1 Implementation Plan — multi-repo workspaces

> **Status:** decisions confirmed; **execution not started** — the owner asked to record the confirmation only. Do not execute until told to.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one workspace root (a plain folder that is not a Git repository) hold several projects, each its own repository, so a single work item can span them: per-project inspection and review, a dependency order, version-pin checks between packages, a multi-repo ledger and a cross-service API contract.

**Architecture:** `.dev-agent/config.yml` at the root gains a `workspaces:` map (path, role, `dependsOn`, optional `baseBranch`). A new core module resolves and orders workspaces safely; another reads package manifests (`pyproject.toml`, `package.json`) to check that dependents pin a satisfiable version of their dependencies. `TaskState` and the ledger gain an optional per-workspace record; `checkResume` verifies every recorded workspace. The CLI adds `workspaces`, `workspaces verify`, `workspaces order` and a `--workspace <name>` option on the existing per-project commands. Without a `workspaces:` key every existing behavior is byte-for-byte unchanged.

**Tech Stack:** TypeScript on Node ≥ 20.6, `yaml`, `smol-toml` (already a root dependency; added to `packages/core`), `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-24-dev-agent-kit-evolution.md` (§10 resume, §12 Git safety, §26 project inspector, §43 compatibility). Driven by two real layouts, both one repository per folder under a non-Git parent:

```text
altave/  cloud-back  cloud-front  edge-back  edge-front      (cloud and edge talk to each other)
pumpkin/ models  backend  policy-api  client  admin          (models ← backend ← policy-api ← client/admin;
                                                              models and backend are pyproject-pinned packages)
```

## Global Constraints

- **Compatibility (§43):** a config without `workspaces` behaves exactly as v1.0.0; `frontend-agent` commands, the 26 skill names, the five MCP tool names, `.frontend-agent/config.yml`, existing task state JSON and existing ledgers keep working. New fields are optional.
- **The CLI never mutates Git, never publishes, never opens the network, never runs a model.** Branch creation stays the agent's job under `references/git-workflow.md`; publishing a package version is always a stop-and-ask.
- **Workspace paths:** relative POSIX, inside the root, no `..`, no absolute paths, no symlink at or above the workspace directory, at most 30 workspaces, names `^[a-z][a-z0-9-]{0,31}$`.
- **Bounded work:** manifest files read at most 1 MB each; version parsing accepts only `major.minor.patch` numerics with an optional pre-release tail that makes the result `unknown`; no regex over unbounded input.
- **No secrets in output:** dependency specifiers carrying credentials (`pkg @ https://user:pass@host/…`) are never echoed; findings name the dependency and the status only.
- Skills stay ≤ 60 lines and neutral (no framework or product names); detail goes in `references/`.
- Real benchmarks remain the owner's step.

## Review Focus

1. **Path safety.** A workspace path that is absolute, contains `..`, is a symlink, sits under a symlink, points at a file, is a duplicate of another workspace or nests inside another must be rejected with a message naming the workspace.
2. **Old data.** A v1.0 config with no `workspaces`, a v1.0 `TaskState` JSON with no `workspaces` field and a v1.0 ledger with no `Workspaces` section must load, resume and update without error or rewrite.
3. **Pin checks must not lie.** Constraint forms the parser does not understand (`!=`, ranges with commas, `*`, markers such as `; python_version>"3.9"`, extras, URL/path/git dependencies, editable installs, poetry tables) yield `unknown`, never `ok`. A dependent that does not declare the package at all is `not-declared`.
4. **Mixed layouts.** A workspace directory that is not a Git repository, a repository on another branch, one with a dirty tree and one that does not exist must each be reported per workspace; `diff review --all-workspaces` skips non-repositories with a note instead of failing the others.
5. **Graph.** Cycles, self-dependencies and `dependsOn` names that do not exist are config errors naming the offenders; `workspaces order` is deterministic (alphabetical tie-break) and `--only` includes the dependencies a change needs only when asked (`--with-deps`).
6. **Config injection.** An unknown key, a non-string path, an oversized `dependsOn` or a workspace name colliding with a reserved word (`all`) is a parse error, not a silent default.

## Decisions recorded (confirmed by the owner on 2026-09-25)

1. **Where things live.** The ledger (`.dev-agent/tasks/<KEY>.md`), state and contract stay at the workspace root, which is not a repository, so they never land in a commit. Per-workspace data (branch, base SHA, status) lives inside the state.
2. **One branch name per work item, in every touched repository** (the normal pattern rendering). The agent creates them with the existing safe procedure; the CLI only reports.
3. **Version pins are checked, not changed.** `workspaces verify` reports `ok | behind | ahead | unknown | not-declared` for each `dependsOn` edge. Publishing a new package version is always a stop-and-ask; local testing before publishing uses an editable install that the agent does not commit.
4. **Contract producer/consumer covers HTTP boundaries only** (Cloud ↔ Edge, `policy-api` ↔ `client`/`admin`). The Python boundary `backend` ↔ `policy-api` is covered by pins and each repository's own tests; no in-process contract is invented.
5. **One tracker item per feature by default.** The ledger splits it into per-workspace steps in dependency order. For independent release cadences, an item with `parent`/`child` links works the same way: each child is a step.
6. **No new eval scenarios.** The benchmark harness runs one repository per scenario; multi-repo behavior is covered by deterministic tests over temporary trees.

---

### Task 1: Workspace configuration, path safety and ordering

**Files:** modify `packages/core/src/config.ts`, `packages/core/src/index.ts`; create `packages/core/src/workspaces.ts`; tests `packages/core/tests/workspaces.test.ts` and additions to `packages/core/tests/config.test.ts`.

**Interfaces:**
- Consumes: `parseDevAgentConfig`, `DevAgentConfig`, `safeReadFile` conventions in `config.ts`/`safe-fs.ts`.
- Produces:
  ```ts
  export interface WorkspaceConfig { name: string; path: string; role?: 'library' | 'backend' | 'api' | 'frontend' | 'infra' | 'other'; dependsOn: string[]; baseBranch?: string }
  // DevAgentConfig gains: workspaces: WorkspaceConfig[]   (empty when the key is absent)
  export function workspaceRoot(root: string, ws: WorkspaceConfig): string        // realpath inside root; throws naming the workspace
  export function findWorkspace(cfg: { workspaces: WorkspaceConfig[] }, name: string): WorkspaceConfig  // throws with the known names
  export function orderWorkspaces(cfg: { workspaces: WorkspaceConfig[] }, opts?: { only?: string[]; withDeps?: boolean }): WorkspaceConfig[]  // dependencies first, alphabetical tie-break
  ```
- YAML shape:
  ```yaml
  workspaces:
    models:     { path: models, role: library }
    backend:    { path: backend, role: backend, dependsOn: [models] }
    policy-api: { path: policy-api, role: api, dependsOn: [backend] }
    client:     { path: client, role: frontend, dependsOn: [policy-api], baseBranch: develop }
  ```

- [ ] **Step 1: Failing tests.** Config: the Pumpkin and Altave examples parse (Altave has no `dependsOn` at all); absent key → `workspaces: []`; errors (each names the workspace or key and is asserted by message): unknown key, non-string or empty `path`, absolute path, `..`, backslash, duplicate names, duplicate or nested paths, name `all`, invalid name, more than 30, `dependsOn` naming an unknown workspace, self-dependency, a cycle (`a→b→a`), non-array `dependsOn`, invalid `role`. `workspaceRoot`: returns the realpath for a real directory; throws for a missing directory, a file, a symlink workspace directory and a symlinked parent. `orderWorkspaces`: Pumpkin order is `models, backend, policy-api, admin, client` (alphabetical tie-break between `admin` and `client`); `only: ['client']` alone returns `client`; with `withDeps` returns the chain `models, backend, policy-api, client`; unknown name in `only` throws.
- [ ] **Step 2: Run, watch them fail.**
- [ ] **Step 3: Implement** the parser section, `workspaces.ts` and the index export. Ordering is an iterative topological sort (no recursion) with the alphabetical tie-break.
- [ ] **Step 4: Run core suite and typecheck; commit** — `git commit -m "core: workspace configuration, safe paths and dependency order"`.

---

### Task 2: Version-pin verification between workspaces

**Files:** create `packages/core/src/workspace-pins.ts`; modify `packages/core/package.json` (add `smol-toml` at the same range as the root: `^1.9.0`); test `packages/core/tests/workspace-pins.test.ts`.

**Interfaces:**
- Consumes: `WorkspaceConfig`, `workspaceRoot`, `safeReadFile`.
- Produces:
  ```ts
  export interface PackageInfo { name: string; version?: string; dependencies: Record<string, string> }   // dependency name (PEP 503-normalized for Python) -> raw constraint text, never a URL with credentials
  export function readPackageInfo(dir: string): PackageInfo | null       // pyproject.toml ([project] or [tool.poetry]) first, then package.json
  export type PinStatus = 'ok' | 'behind' | 'ahead' | 'unknown' | 'not-declared'
  export interface PinReport { dependent: string; dependency: string; status: PinStatus; constraint?: string; version?: string; note?: string }
  export function checkPins(root: string, workspaces: WorkspaceConfig[]): PinReport[]   // one row per dependsOn edge, in orderWorkspaces order
  ```
- Semantics: constraint forms understood — `==x.y.z`, `>=x.y.z`, `~=x.y`/`~=x.y.z`, `^x.y.z`, `~x.y.z` and a bare `x.y.z` (npm exact). `ok`: the dependency's current version satisfies the constraint. `behind`: it does not, because the dependency is **newer** than an upper/exact bound (the dependent must bump its pin). `ahead`: the dependency is **older** than a lower bound (`>=`), meaning the dependent needs a version that is not released yet (publish first). Anything else, a missing version, URL/path/git/editable specs, markers, extras with unknown syntax, pre-release versions → `unknown` with a short `note`. A dependency name is matched by the package name declared in the dependency workspace's own manifest.

- [ ] **Step 1: Failing tests** over temporary trees: PEP 621 (`dependencies = ["models>=1.2.0"]`), poetry (`[tool.poetry.dependencies] models = "^1.2.0"` and the table form `{ version = "^1.2" }`), `package.json` (`"@acme/models": "^1.2.0"`); each status with a concrete pair (`>=1.3.0` vs 1.2.0 → `ahead`; `==1.2.0` vs 1.3.0 → `behind`; `~=1.2` vs 1.9.0 → `ok`, vs 2.0.0 → `behind`); `not-declared` when the dependent lists no such package; `unknown` for `models @ git+https://user:secret@example.com/m.git`, `models>=1,<2`, `models; python_version>"3.9"`, `models[extra]>=1.0` (extras stripped, constraint parsed), a `1.0.0rc1` version, a missing `version`, a 2 MB pyproject and malformed TOML/JSON; no output field ever contains `secret`; PEP 503 normalization (`My_Models` matches `my-models`); a `dependsOn` edge to a workspace with no manifest → `unknown` with a note.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement** with bounded reads and a small numeric version comparator; no regex on unbounded text (split on known delimiters).
- [ ] **Step 4: Run core suite and typecheck; commit** — `git commit -m "core: check that dependent workspaces pin a satisfiable version"`.

---

### Task 3: Multi-workspace task state, ledger and resume

**Files:** modify `packages/core/src/ledger.ts` (`TaskState`, `parseTaskState`, `LEDGER_SECTIONS`, `renderLedger`), `packages/core/src/resume.ts`; tests `packages/core/tests/ledger.test.ts`, `packages/core/tests/resume.test.ts`.

**Interfaces:**
- Consumes: `WorkspaceConfig`, `workspaceRoot` (Task 1), `currentBranch`, `isAncestor`, `dirtyFiles`, `isGitRepo`.
- Produces:
  ```ts
  export type WorkspaceStepStatus = 'pending' | 'in-progress' | 'done' | 'blocked'
  export interface WorkspaceState { baseBranch?: string; baseSha?: string; workingBranch?: string; status: WorkspaceStepStatus }
  // TaskState gains: workspaces?: Record<string, WorkspaceState>
  // LEDGER_SECTIONS gains 'Workspaces' after 'Git'
  export type ResumeCheck  // ok:true gains workspaceReports: Array<{ workspace: string; ok: boolean; reasons: string[] }>; ok:false reasons are prefixed "<workspace>: " for per-workspace problems
  export function checkResume(root, cfg: TaskDirs & { knowledgeDir; taskSources; workspaces?: WorkspaceConfig[] }, key): ResumeCheck
  ```
- Rules: with no `workspaces` in the state, resume behaves as in v1.0 (root branch and base checks). With `workspaces`, each recorded workspace is checked in its own directory: repository present, branch equals `workingBranch`, `baseSha` an ancestor of `HEAD`; the root is not required to be a repository. Uncommitted work never blocks (existing rule) but is reported as a note per workspace. A recorded workspace missing from the config is a reason.

- [ ] **Step 1: Failing tests.** `parseTaskState`: accepts a state with `workspaces`, rejects bad names, bad status, non-object, more than 30 entries, over-long strings; a v1.0 JSON without the field parses to a state without it and round-trips unchanged. Ledger: a v1.0 ledger without a `Workspaces` section is parsed and `setLedgerSection(md, 'Workspaces', …)` appends it in the right position without disturbing other sections; a new ledger renders the section as `_Not yet recorded._`. Resume: Pumpkin-shaped temp tree with three repositories, all on the right branches → ok with three reports; one on `main` → `client: on branch "main" but the task recorded "feat/…"`; one whose `baseSha` was rewritten → reason; one directory that is not a repository → reason; a workspace absent from the config → reason; the root itself not a repository → still ok.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run core suite and typecheck; commit** — `git commit -m "core: per-workspace task state, ledger section and resume"`.

---

### Task 4: Cross-service contract (producer and consumers)

**Files:** modify `packages/core/src/contract.ts`, `packages/cli/src/dev-contract-commands.ts`; tests `packages/core/tests/contract.test.ts`, `packages/cli/tests/dev-contract-commands.test.ts`.

**Interfaces:**
- Consumes: `ApiContract`, `contractPath`, `usage` verifier, `loadDevAgentConfig`, `workspaceRoot`.
- Produces: `ApiContract` gains optional `producer?: string` and `consumers?: string[]` (workspace names, each `^[a-z][a-z0-9-]{0,31}$`, at most 10, producer not among consumers). `dev-agent contract usage <KEY>` no longer requires `--client` when the contract lists `consumers` and the config defines them: it scans each consumer workspace directory and prints results per consumer. An explicit `--client` still works and wins. Unknown consumer names, or a contract with `consumers` but no `workspaces` in the config, are usage errors naming the problem. `contract show` prints the fields unchanged.

- [ ] **Step 1: Failing tests.** Core: a contract with `producer: 'cloud-back'`, `consumers: ['edge-back']` parses and round-trips; producer inside consumers, invalid names, non-array, more than 10 → errors; a v1.0 contract without them is unchanged. CLI: `contract usage` with consumers and workspaces resolves both consumer directories and reports per consumer (exit 2 when any consumer never calls the route with the method); `--client` overrides; consumers without workspaces config → exit 1 with a clear message; unknown consumer → exit 1.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run core and cli suites and typecheck; commit** — `git commit -m "core, cli: producer and consumers in the API contract"`.

---

### Task 5: CLI — `workspaces`, `workspaces verify`, `workspaces order`, `--workspace`

**Files:** create `packages/cli/src/dev-workspace-commands.ts`; modify `packages/cli/src/dev-cli.ts` (routing, help), `packages/cli/src/dev-common.ts` (shared target resolution), `packages/cli/src/dev-repo-commands.ts`, `dev-cli.ts` `inspect`; test `packages/cli/tests/dev-workspace-commands.test.ts`.

**Interfaces:**
- Consumes: `orderWorkspaces`, `workspaceRoot`, `checkPins`, `detectProjectProfile`, `reviewDiff`, `indexRepository`, `findSimilar`, `checkResume`, `loadDevAgentConfig`, `isGitRepo`, `currentBranch`, `dirtyFiles`.
- Produces (all with `--project <root> [--json]`):
  - `dev-agent workspaces` — one row per workspace in dependency order: name, path, role, `dependsOn`, detected languages/frameworks, Git state (`repo`, branch, `dirty`/`clean`, or `not a repository`, or `missing`). No `workspaces` configured → `no workspaces configured` and exit 0.
  - `dev-agent workspaces verify` — config parses, each path is a real directory, each is a repository (warning if not), and one line per `dependsOn` edge with its pin status. Exit 2 on errors (bad path, missing directory); `behind`, `ahead` and `unknown` are warnings; `not-declared` is a warning.
  - `dev-agent workspaces order [--only a,b] [--with-deps]` — the implementation order, one name per line.
  - `--workspace <name>` on `inspect`, `repo index`, `repo similar` and `diff review`: the command runs against `<root>/<workspace path>`; for `diff review` the workspace's `baseBranch` (else the root config's) is used; `--workspace` with no `workspaces` configured or an unknown name → exit 1 listing the known names. `--workspace all` is rejected on commands other than `diff review`.
  - `diff review --workspace all`: reviews every workspace that is a repository, prints a section per workspace, prints `skipped <name>: not a repository` for the others, and exits 2 if any workspace has an error finding, 1 if none could be reviewed.
  - `dev-agent task status <KEY>` prints the per-workspace reports from `checkResume` when the state has workspaces.

- [ ] **Step 1: Failing tests** over a Pumpkin-shaped temporary root (three real repositories and two plain directories), asserting each command's output lines and exit codes above, `--json` parses, the help lists the new commands (the docs test then requires them documented), and the v1.0 behavior of every touched command without `workspaces` is unchanged (existing tests stay green).
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement** with a single `resolveTarget(values, io)` helper in `dev-common.ts` used by the four per-project commands.
- [ ] **Step 4: Run core and cli suites and typecheck; commit** — `git commit -m "cli: workspaces commands and --workspace for per-project commands"`.

---

### Task 6: Skills, docs, release 1.1.0

**Files:** create `skills/task-orchestrator/references/workspaces.md` (`type: contract`), `docs/workspaces.md`, `docs/release-notes/v1.1.0.md`; modify `skills/task-orchestrator/SKILL.md` (one line pointing to the reference), `skills/task-orchestrator/references/git-workflow.md` (multi-repository section), `skills/fullstack-contract/SKILL.md` (producer/consumers, one or two lines), `docs/cli.md`, `docs/task-orchestrator.md`, `docs/fullstack.md`, `README.md`; version `1.0.0` → `1.1.0` in the root and the four workspace `package.json`, lockfile, the two version assertions in `packages/cli/tests/`, `packages/cli/tests/package-manifest.test.ts`; tests `packages/core/tests/shared-skills.test.ts` (reference count), `packages/cli/tests/docs.test.ts` (existing checks now cover the new docs).

Content:
- `references/workspaces.md`: read the `workspaces:` map; classify per workspace; order by `dependsOn`; one branch name in every touched repository, created with the safe procedure one repository at a time (a refusal in one stops and reports, never forces); the ledger and state live at the root and the `Workspaces` section lists each workspace's step in order; run `dev-agent diff review --workspace <name>` after each step and `--workspace all` at the end; before touching a dependent, run `dev-agent workspaces verify` and treat `ahead`/`behind` as a pin to fix, never as done; **never publish a package version: stop and ask the user**, then continue once the new version exists; local pre-publish testing may use an editable install that is not committed; contract producer and consumers name workspaces.
- `docs/workspaces.md`: the concept, the config, every command, and two complete worked examples — **Altave** (four repositories, cloud↔edge contract with `producer`/`consumers`, config with no `dependsOn`) and **Pumpkin** (five repositories, dependency chain, pyproject pins, publish-then-bump flow, one tracker item per feature with the ledger split per workspace) — plus limits (what is not covered: in-process contracts, monorepos with one Git root, automatic release).
- README: a short "Workspaces" section and a v1.1 history line. Release notes: what is new, compatibility statement (a config without `workspaces` is unchanged), limits.
- Skill tests: the six-reference assertion in `shared-skills.test.ts` becomes seven and requires `workspaces`; `SKILL.md` stays ≤ 60 lines and neutral; the new reference passes the contract-reference frontmatter check.

- [ ] **Step 1:** update the skill and manifest tests first and watch them fail; write the skills and docs; the existing `docs.test.ts` (commands exist in `--help`, links resolve) must pass with the new files.
- [ ] **Step 2:** bump versions and `npm install --package-lock-only`.
- [ ] **Step 3: Run everything:** `npm test` (all four packages), `npm run typecheck --workspaces --if-present`, `npm run validate:skills`, `npm run evals:validate` (36 scenarios, unchanged), `npm run verify:package`, `npm run smoke:package`.
- [ ] **Step 4: Commit** — `git commit -m "chore: release v1.1.0 — multi-repo workspaces"`.

---

## Self-review

**Coverage of the request:** Altave (four sibling repositories, Cloud ↔ Edge) → Tasks 1, 3, 4, 5 and the worked example; Pumpkin (layered packages with `pyproject`-pinned `models` and `backend`) → Tasks 1, 2, 3, 5 and the worked example; "each folder is its own repository under a non-Git parent" → Decision 1, Tasks 3 and 5; tracker items → Decision 5 and the reference.

**Deliberately not in this release:** creating branches or publishing from the CLI; an in-process (non-HTTP) contract between Python packages; monorepo-aware detection inside one repository; automatic version bumps; benchmark scenarios spanning several repositories; a tracker adapter that creates child items.

**Placeholder scan:** every task states exact signatures, error cases and expected outputs; the executor writes the tests in the existing helper style (`makeRepo`, `project()` temp trees) and must watch each fail first.

**Type consistency:** `WorkspaceConfig` (Task 1) is consumed by Tasks 2–5; `PinReport` (Task 2) is printed by Task 5; `WorkspaceState` (Task 3) is read by `checkResume` and printed by Task 5's `task status`; `producer`/`consumers` (Task 4) resolve through `workspaceRoot` (Task 1).

# Dev Agent Kit v0.11 — Repo Index, Similar Features and Diff Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (inline, native). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the agent apply good patterns that already exist in the code, deterministically. `dev-agent repo index` maps the repository (layers, features, conventions) and can write it into `.dev-agent/knowledge/`; `dev-agent repo similar <words>` finds the existing features closest to a change, grouped by role, so new code copies them; `dev-agent diff review` checks the actual diff against safe-change rules before a task is reported done.

**Architecture:** Three pure modules in `packages/core` (`repo-index.ts`, `repo-similar.ts`, `diff-review.ts`) and three CLI commands in `packages/cli`. The index reads **paths only** (never file contents), so it is bounded, cannot backtrack on untrusted text and cannot leak secrets. Knowledge files are written through the existing `writeKnowledge` (containment, secret scan, source SHA). Skills gain one neutral line each pointing at the commands; no new skills.

**Tech Stack:** TypeScript (ES2022, NodeNext), `node --test` via `tsx`, the `git` binary.

**Spec:** `docs/superpowers/specs/2026-09-24-dev-agent-kit-evolution.md` — §6.1 (repo-memory), §25 (`repo index`, `diff review`), §26 (project inspector), §24 (context economy), §43 (compatibility).

## Global Constraints

- Compatibility (§43): `frontend-agent`, existing skills' behavior, MCP tool names and all 36 eval scenarios stay untouched and green.
- The index reads directory listings and file **names** only; it never opens file contents. Walk limits: at most 20 000 files, depth 8, skipping `node_modules .git dist build target bin obj vendor .venv venv __pycache__ .next .nuxt .output .svelte-kit out coverage .dev-agent .worktrees .idea .vscode .gradle .cache tmp log` and every symlink.
- `repo index --write` writes only inside `.dev-agent/knowledge/` through `writeKnowledge` (refuses symlinks and secret-looking text, stamps `sourceSha`). It never writes elsewhere. There is no `--force`: existing knowledge files are simply regenerated (they are derived data); a symlinked directory is refused.
- `diff review` and `repo similar` are read-only. `diff review` reads a bounded patch (at most 2 MB of diff text) and scans **added lines only** for secrets, reporting the file and never echoing the value.
- CLI exit codes as before: `0` ok, `1` usage/environment error, `2` checked and not OK (`diff review` errors).
- Skills stay neutral and ≤ 60 lines (existing tests enforce the shared-skill and backend-skill rules); each gets at most a couple of lines.
- Commits: append the attribution trailer the session configures. Never `git reset --hard`, never force-push. The real benchmark is run by the user.

## Review Focus

1. Boundedness on hostile trees: 100k files in one directory, deeply nested directories, huge file names, symlink loops, directories named like skip-list entries, unreadable directories → completes fast, `truncated: true`, no crash, no symlink followed.
2. Role and feature heuristics do not misreport: a repo with no recognizable layers yields an honest empty result, not invented structure; generic names (`index`, `main`, `utils`) never become features; deterministic ordering across runs and platforms.
3. `repo similar`: empty or stopword-only queries, non-Latin queries, very long queries, ties → deterministic ranking; never returns a feature with a single unrelated file as "the pattern".
4. `diff review`: renames, deletions, binary files, untracked files, a base that does not exist, an empty diff, a huge diff (cap), CRLF, paths with spaces/quotes; migrations detected as edited vs added; secrets in added lines reported without printing them.
5. `--write` idempotence and safety: running twice produces identical files except `updatedAt`; a repo with no commits, a bare repo, a symlinked `.dev-agent`, and a knowledge dir configured elsewhere behave safely.

---

### Task 1: Repository index (core)

**Files:** Create `packages/core/src/repo-index.ts`; modify `packages/core/src/index.ts`; test `packages/core/tests/repo-index.test.ts`.

**Interfaces (produces):**
```ts
export type Role = 'test' | 'migration' | 'route' | 'controller' | 'service' | 'repository' | 'model' | 'schema' | 'component' | 'config' | 'other';
export interface IndexedFile { path: string; role: Role }
export interface Feature { name: string; files: IndexedFile[]; roles: Role[] }
export interface RepoIndex {
  profile: ProjectProfile;
  headSha: string | null;
  fileCount: number;
  truncated: boolean;
  topDirs: Array<{ name: string; files: number }>;
  extensions: Array<{ ext: string; files: number }>;
  roles: Partial<Record<Role, string[]>>;      // up to 12 example directories or files per role
  features: Feature[];                          // sorted: more distinct roles first, then more files, then name
  conventions: { fileNaming: 'kebab-case' | 'snake_case' | 'camelCase' | 'PascalCase' | 'mixed' | 'unknown'; testSuffix?: string; testDirs: string[] };
}
export function classifyPath(relPath: string): Role;
export function featureKey(relPath: string): string | null;
export function indexRepository(root: string, opts?: { maxFiles?: number }): RepoIndex;
```

**Rules:**
- `classifyPath` works on the lower-cased path segments and file name, first match wins in this order: **test** (a `test`, `tests`, `__tests__`, `spec` or `e2e` directory segment; a name containing `.test.` or `.spec.`; a name ending in `_test.<ext>`, `_spec.rb`, `Test.java`, `Tests.cs`, `Tests.php`; a name starting `test_`); **migration** (`migrations`, `migrate` or `db/migration` segment); **route** (`routes`/`route`/`router` segment or a stem of `routes`/`urls`/`router`); **controller** (`controllers`/`controller`/`handlers`/`views` segment, or a stem containing `controller`/`handler`, or stem `views`); **service** (`services`/`usecases`/`actions` segment or stem ending `service`/`usecase`); **repository** (`repositories`/`repository`/`dao` segment or stem ending `repository`/`dao`); **model** (`models`/`entities` segment or stem `models`/ending `entity`/`model`); **schema** (`schemas`/`dto`/`dtos`/`serializers` segment or stem ending `dto`/`schema`/`serializer`/`request`); **component** (extension `.tsx .jsx .vue .svelte` under a `components`/`pages`/`views` segment); **config** (`config`/`settings` segment or stem `settings`/`config`); else **other**.
- `featureKey` derives the feature name: take the deepest directory segment that is not generic (generic: `src app apps lib main java kotlin resources com org net io tests test spec __tests__ e2e` and every role directory name above, `web api http public internal domain`) and use it lower-cased, singularized (strip a trailing `s` when the word is longer than 3 characters and does not end in `ss`); if there is none, use the file stem with role words removed (`controller service repository model dto schema test tests spec request response entity handler view views serializer routes urls migration`), split on non-alphanumerics and camelCase boundaries, the first remaining token of length ≥ 3, singularized. Return `null` for stems that are only generic (`index`, `main`, `app`, `utils`, `util`, `helpers`, `common`, `base`, `types`, `constants`, `init`, `__init__`).
- `indexRepository`: bounded walk as in the Global Constraints (breadth-first, sorted names for determinism, symlinks skipped, unreadable directories skipped, `truncated = true` when `maxFiles` (default 20 000) is hit). Group files by feature; keep features with at least 2 files **and** at least 2 distinct roles, or at least 3 files; cap at 60 features with at most 15 files each (extra files are dropped, the feature stays). `conventions.fileNaming` is the dominant style among file stems (≥ 70 % of stems classified, ignoring single-word stems), `mixed` otherwise, `unknown` with fewer than 5 classifiable stems; `testSuffix` is the most common test-file suffix pattern (`.test.ts`, `_test.py`, `Test.java`, `_spec.rb`, `Tests.cs`) when at least 2 exist; `testDirs` lists test directories (up to 5). `profile` comes from `detectProjectProfile(root)`, `headSha` from `headSha(root)`.

- [ ] **Step 1: Write the failing tests.** Cases (write as `assert.deepEqual`/`equal` with the file's temp-project helper that creates files from a path→content map):
  - `classifyPath` table: `src/controllers/note_controller.py` → controller; `app/Http/Controllers/NoteController.php` → controller; `notes/views.py` → controller; `src/routes/notes.ts` → route; `config/routes.rb` → route; `src/services/notes.ts` → service; `NoteService.java` → service; `notes/models.py` → model; `app/models/note.rb` → model; `src/notes/dto/create-note.dto.ts` → schema; `notes/serializers.py` → schema; `db/migrate/2024_x.rb` → migration; `notes/migrations/0001_initial.py` → migration; `tests/test_notes.py`, `src/notes.test.ts`, `spec/requests/notes_spec.rb`, `NoteControllerTest.java`, `Notes.Tests/NotesTests.cs` → test; `src/components/Card.tsx` → component; `config/settings.py` → config; `README.md`, `LICENSE` → other. Test beats controller (`tests/controllers/x.py` → test).
  - `featureKey` table: `notes/views.py` → `note`; `notes/models.py` → `note`; `src/services/notes.ts` → `note`; `app/Http/Controllers/NoteController.php` → `note`; `src/users/users.controller.ts` → `user`; `src/index.ts`, `src/utils/helpers.ts`, `main.py`, `__init__.py` → `null`; `app/models/user_profile.rb` → `user`; `OrderService.java` → `order`; a word ending in `ss` (`address`) stays `address`.
  - A Django-like tree (`notes/{models,views,serializers,urls,permissions}.py`, `notes/migrations/0001_initial.py`, `notes/tests/test_notes.py`, `config/settings.py`, `manage.py`, `requirements.txt`) → a feature `note` with roles ⊇ {model, controller, schema, route, migration, test}; `conventions.fileNaming` `snake_case`; `testSuffix` undefined (only one test); `profile.frameworks` contains `django`; features sorted with `note` first; `roles.migration` lists the migrations directory.
  - A Rails-like, a Spring-like (`src/main/java/com/example/notes/{NoteController,NoteService,NoteRepository,Note}.java` + `src/test/java/.../NoteControllerTest.java` → feature `note`, testSuffix `Test.java`), a Node/Express-like and a React-like tree produce plausible features and `fileNaming`.
  - A repository with no recognizable layers (`a.txt`, `b.txt`, `docs/x.md`) → `features: []`, `roles` empty of everything but `other`, `fileNaming: 'unknown'`, no crash.
  - Boundedness: 30 000 empty files in one directory with `maxFiles: 500` → `truncated: true`, `fileCount` 500, finishes under 2 s; a symlink to a directory and a symlink loop are skipped (not followed, no hang); a directory named `node_modules` containing `models.py` contributes nothing; a 200-level nested directory chain stops at depth 8.
  - Determinism: indexing the same tree twice deep-equals; creating files in a different order gives the same result.
- [ ] **Step 2: Run to verify failure** — `node --import tsx --test packages/core/tests/repo-index.test.ts`.
- [ ] **Step 3: Implement** (`readdirSync` with `withFileTypes`, sorted; iterate an explicit queue, not recursion, so depth cannot overflow the stack).
- [ ] **Step 4: Run** the core suite and typecheck.
- [ ] **Step 5: Commit** — `git commit -m "core: a bounded, path-only repository index (layers, features, conventions)"`.

---

### Task 2: Knowledge rendering and writing (core)

**Files:** Create `packages/core/src/repo-knowledge.ts`; modify `packages/core/src/index.ts`; test `packages/core/tests/repo-knowledge.test.ts`.

**Interfaces:**
```ts
export function renderKnowledge(index: RepoIndex): Partial<Record<KnowledgeName, string>>;   // bodies only
export function writeRepoKnowledge(root: string, index: RepoIndex, knowledgeDir?: string): { written: KnowledgeName[]; sourceSha: string };
```
- `renderKnowledge` returns Markdown bodies (each ≤ 6 000 characters, truncated with a final `…` line): `repository` (stack: languages, frameworks, package manager, database, migration tool, queues, cache, Docker; top directories with file counts; top extensions), `commands` (test / lint / typecheck from the profile, each with `(from the profile: <ecosystem hint>)`; `none detected` when empty), `architecture` (a `Layers` list: role → example directories/files; a `Features` list of up to 12 features, each `name — roles — up to 4 example paths`; a `Conventions` list: file naming, test suffix, test directories), and `backend` **or** `frontend` only when the profile has a backend framework/queue/database (`backend`) or a UI framework (`react vue nuxt next angular tailwind`) (`frontend`): conventions relevant to that side drawn from the same index (roles present, migration directory, component directories). Bodies contain only paths, counts and profile values — never file contents. Every line is written so that a fact can be re-verified from the repository.
- `writeRepoKnowledge` requires `index.headSha !== null` (throws a clear error `repo index --write needs a git repository with at least one commit` otherwise) and writes each body with `writeKnowledge(root, name, body, { sourceSha: headSha }, knowledgeDir)`; default `knowledgeDir` is `.dev-agent/knowledge`. Only names present in the rendered result are written; it does not delete other knowledge files.

- [ ] **Step 1: Failing tests.** Django-like index → `repository` mentions `django`, `python`; `commands` says the test command or `none detected`; `architecture` contains `note` and its roles; `backend` present, `frontend` absent; a React-like index → `frontend` present, `backend` absent; a plain index → only `repository`, `commands`, `architecture`. Every body ≤ 6 000 chars even with 60 features. Bodies contain no file contents (assert the string of a marker written in a fixture file's content is absent). `writeRepoKnowledge` on a real temp git repo writes the files, `readKnowledgeIn` returns each with `sourceSha` equal to `headSha`; running twice keeps identical bodies; a repo with no commit throws the clear error and writes nothing; a symlinked `.dev-agent` is refused; `checkFreshness` reports `fresh` right after writing and `stale` after another commit.
- [ ] **Steps 2–5:** implement, run, commit — `git commit -m "core: render and write repository knowledge from the index"`.

---

### Task 3: Similar features (core)

**Files:** Create `packages/core/src/repo-similar.ts`; modify `packages/core/src/index.ts`; test `packages/core/tests/repo-similar.test.ts`.

**Interfaces:**
```ts
export interface SimilarFeature { name: string; score: number; reason: 'name-match' | 'path-match' | 'most-complete'; files: IndexedFile[]; roles: Role[] }
export function findSimilar(index: RepoIndex, query: string, limit?: number): SimilarFeature[];
```
- Tokenize the query: lower-case, split on non-alphanumerics (Unicode-aware `\p{L}\p{N}`), drop tokens shorter than 3 characters and stopwords (`the and for with add new create make endpoint feature that this from into use using implement fix update para com uma que dos das como add`), singularize each token like `featureKey`, cap at 20 tokens and 200 characters of input.
- Score each feature: `+3` per query token equal to the feature name; `+1` per distinct query token that appears as a token in any of the feature's file paths (split on non-alphanumerics and camelCase); `+0.1` per distinct role in the feature (completeness tiebreak). Return features with `score ≥ 1` ordered by score desc, then more files, then name; at most `limit` (default 3). `reason` is `name-match` when a name match contributed, else `path-match`.
- When the query yields no tokens or no feature scores ≥ 1, return the `limit` **most complete** features (most distinct roles, then files, then name) with `reason: 'most-complete'` and `score: 0`, but only features with at least 3 distinct roles; otherwise `[]`.
- Never returns a feature that has fewer than 2 files.

- [ ] **Step 1: Failing tests** on a hand-built `RepoIndex` (plus one from a temp tree): query `"add archive endpoint for notes"` → `note` first with reason `name-match`; `"invoices"` when features are `note`, `user`, `order` → falls back to most-complete with `reason: 'most-complete'`; a stopword-only query and an empty string → most-complete or `[]` when nothing has 3 roles; ties resolve by file count then name (run twice, same order); a 5 000-character query is truncated and returns quickly; `"Ação de cadastro"` (accents) tokenizes without throwing; a feature with a single file never appears; `limit` respected.
- [ ] **Steps 2–5:** implement, run, commit — `git commit -m "core: find the existing features closest to a change"`.

---

### Task 4: Diff review (core)

**Files:** Create `packages/core/src/diff-review.ts`; modify `packages/core/src/index.ts`; test `packages/core/tests/diff-review.test.ts`.

**Interfaces:**
```ts
export interface ChangedFile { path: string; status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'; role: Role }
export interface Finding { id: string; severity: 'error' | 'warning' | 'info'; message: string; files?: string[] }
export interface DiffReview { base: string; files: ChangedFile[]; findings: Finding[]; truncated: boolean }
export function reviewDiff(root: string, opts?: { base?: string }): DiffReview;
```
- Base: `opts.base` when given (must resolve with `git rev-parse --verify --quiet <base>^{commit}`, otherwise throw `base "<x>" is not a commit`), else the merge-base of `HEAD` with the detected base branch (`detectBaseBranch` + `defaultRemote`) when that exists and differs from `HEAD`, else `HEAD` itself (so an uncommitted change is reviewed against the last commit). The review covers committed changes since the base **and** the working tree (staged, unstaged and untracked files), via `git diff --name-status -z --find-renames <base>` plus `git ls-files --others --exclude-standard -z`. Paths are read NUL-separated (spaces and quotes are safe). More than 500 changed files → keep the first 500 and set `truncated`.
- Findings (deterministic ids):
  - `migration-edited` **error**: a migration-role file that existed in the base and is `modified` or `deleted` (shipped migrations must not be edited); `migration-added` **info** for added ones.
  - `secret-in-diff` **error**: an **added** line (`+` lines of `git diff -U0 <base>` limited to 2 MB, plus untracked text files ≤ 200 KB) for which `findSecret` returns a label; the message names the file and the label only, never the value.
  - `dependencies-changed` **warning**: a manifest changed (`package.json`, `requirements*.txt`, `pyproject.toml`, `Pipfile`, `composer.json`, `Gemfile`, `pom.xml`, `build.gradle`, `build.gradle.kts`, any `*.csproj`, `go.mod`, `Cargo.toml`): "confirm the task required a dependency change".
  - `lockfile-only` **warning**: a lockfile (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `poetry.lock`, `uv.lock`, `composer.lock`, `Gemfile.lock`, `packages.lock.json`) changed with no manifest changed.
  - `no-tests` **warning**: at least one added or modified file with role controller, route, service, repository or model, and no changed file with role `test`.
  - `new-top-level-dir` **info**: added files under a top-level directory that has no file in the base (`git ls-tree -d --name-only <base>`).
  - `many-files` **info**: more than 25 changed files.
  - `generated-or-binary` **warning**: changed paths under `dist/`, `build/`, `node_modules/`, `target/`, `bin/`, `obj/`, `__pycache__/`, or ending `.pyc`, `.class`, `.dll`, `.exe`, `.zip`.
  - `empty-diff` **info** when there are no changes.
- Exit-worthy: the caller treats any `error` finding as "not OK".

- [ ] **Step 1: Failing tests** in a temp git repo (use the helpers `makeRepo`, `commitFile`, `sh` from `tests/helpers.ts`): clean tree → `empty-diff`; modify a tracked `notes/migrations/0001_initial.py` → `migration-edited` error; add `0002_x.py` → `migration-added` info and no error; add a controller file only → `no-tests` warning, adding a test file too clears it; change `package.json` → `dependencies-changed`; change `package-lock.json` alone → `lockfile-only`, with `package.json` too → `dependencies-changed` only; a file added in a new `docs2/` directory → `new-top-level-dir`; 26 added files → `many-files`; an added line containing `password = "hunter2hunter2"` → `secret-in-diff` error whose message does not contain `hunter2`; the same secret in an **unchanged** line of a modified file → no finding; a file with a space and a quote in its name is reported with the right path; a rename is `renamed`; a deleted file is `deleted`; `base: 'nope'` throws `is not a commit`; a repo whose feature branch is ahead of `main` reviews the whole branch (committed + working tree); untracked files appear as `untracked`; 600 added files → `truncated: true` with 500 entries; a binary file does not crash the secret scan; CRLF content does not change results.
- [ ] **Steps 2–5:** implement (`runGit` for every call, no shell), run, commit — `git commit -m "core: review the actual diff against safe-change rules"`.

---

### Task 5: CLI — `repo index|similar` and `diff review`

**Files:** Create `packages/cli/src/dev-repo-commands.ts`; modify `packages/cli/src/dev-cli.ts` (routing + help); test `packages/cli/tests/dev-repo-commands.test.ts`.

**Commands:**
- `dev-agent repo index [--write] [--project <dir>] [--json]`: prints `files: N (truncated)`, `naming: …`, `tests: …`, the layers (`role: examples`), and the top features (`name — roles`). `--json` prints the index. With `--write` also writes the knowledge files and prints `wrote: repository, commands, architecture, backend (sourceSha …)`; a repo without commits → exit 1 with the core error message; a symlinked `.dev-agent` → exit 1 naming the symlink. Uses the configured `knowledgeDir` from `.dev-agent/config.yml` (via `loadDevAgentConfig`; an invalid config → exit 1).
- `dev-agent repo similar <words…> [--limit N] [--project <dir>] [--json]`: prints each similar feature (`name (reason, score)` then its files grouped by role). No result → `no similar feature found` and exit 0. Missing query words are allowed (most-complete fallback).
- `dev-agent diff review [--base <ref>] [--project <dir>] [--json]`: prints `base: <ref>`, the changed files (status, role, path — first 40, then `… and N more`), then findings as `✘ error`, `! warning`, `· info` lines. Exit 0 when there is no `error` finding, 2 otherwise, 1 for usage errors (not a git repo, bad base).
- The help text (`DEV_HELP`) lists the three commands.

- [ ] **Step 1: Failing tests** (helpers `setup` from `dev-helpers.ts`, git repo helpers as in the task tests): `repo index` on a Django-like temp repo prints the layers and `note`; `--json` parses and has `features`; `--write` creates `.dev-agent/knowledge/architecture.md` with `sourceSha`; a no-commit repo with `--write` exits 1; a symlinked `.dev-agent` with `--write` exits 1 and writes nothing outside; running `--write` twice gives identical bodies; `repo similar add archive endpoint for notes` shows `note`; `--limit 1`; `--json`; no match exits 0 with the message; `diff review` on a clean repo exits 0 with `empty-diff`; editing a shipped migration exits 2 with `migration-edited`; a secret in an added line exits 2 and the output never contains the secret text; `--base nope` exits 1; a non-git directory exits 1; `dev-agent --help` lists `repo index`, `repo similar`, `diff review`.
- [ ] **Steps 2–5:** implement, run cli + core suites and typecheck, commit — `git commit -m "cli: repo index, repo similar and diff review"`.

---

### Task 6: Skill wiring, docs and v0.11.0 release

**Files:** modify `skills/repo-memory/SKILL.md`, `skills/repository-investigation/SKILL.md`, `skills/surgical-diff/SKILL.md`; modify `docs/cli.md`, `README.md`; create `docs/patterns.md`; version `0.10.0` → `0.11.0` (`packages/{cli,core,evals}/package.json`, lockfile, the two version assertions in `packages/cli/tests/`); test additions in `packages/core/tests/shared-skills.test.ts`.

- `repo-memory` gains a short section: "Generate a first draft with `dev-agent repo index --write` (paths, counts and commands only, stamped with the source SHA), then verify and enrich it; the file is derived data and is regenerated when stale." Keep ≤ 60 lines.
- `repository-investigation` step 5 (Neighbors) gains: "`dev-agent repo similar <words describing the change>` lists the existing features closest to it, grouped by role; read those files and copy their structure."
- `surgical-diff` gains, in the procedure: "Run `dev-agent diff review` first: it flags edited migrations, secrets in added lines, dependency and lockfile changes, missing tests and new top-level directories."
- Tests: each of the three skills still passes the shared-skill neutrality/size tests and now mentions its command (`repo index`, `repo similar`, `diff review`).
- `docs/patterns.md`: how to ask for "follow the existing pattern" — the three commands, what the index does and does not know (paths only, heuristics), how to override (edit the knowledge files), and the limits.
- `docs/cli.md`: three new rows. `README.md`: a `## v0.11` section.

- [ ] **Step 1:** update skills, docs and tests (write the skill-mention tests first and watch them fail). **Step 2:** bump the version and `npm install --package-lock-only`.
- [ ] **Step 3: Run everything** — `npm test`, `npm run typecheck --workspaces --if-present`, `npm run validate:skills`, `npm run evals:validate` (36 scenarios).
- [ ] **Step 4: Commit** — `git commit -m "chore: release v0.11.0 — repo index, similar features and diff review"`.

---

## Self-review

**Coverage:** §25 `dev-agent repo index` and `dev-agent diff review` → Tasks 1, 2, 4, 5; the user's request ("apply good patterns already existing in the code") → `repo similar` (Task 3, 5) plus the skill wiring (Task 6); §6.1 repo-memory generation → Task 2.

**Deliberately not in this release:** reading file contents for pattern extraction (kept path-only for boundedness and privacy); a "conventions linter" that scores the diff against the index; language-server or AST analysis; embeddings; auto-applying patterns (the agent still writes the code).

**Decisions recorded (confirm or overrule):**
1. The index uses **paths and names only**, so heuristics are transparent and cannot leak content; the cost is that it cannot see code-level idioms (naming inside files, error-handling style).
2. `repo index --write` regenerates derived knowledge files freely (no `--force`); hand edits to those files are overwritten, so enriched knowledge should live in sections the agent re-verifies rather than in the generated ones — documented in `docs/patterns.md`.
3. `diff review` errors are limited to things that are almost never intended (edited shipped migrations, secrets in added lines); everything else is a warning or info.

**Placeholder scan:** tests are specified as concrete inputs and expected results; the executor writes them in the files' existing helper style and must watch each fail first.

**Type consistency:** `Role`, `IndexedFile`, `RepoIndex` (Task 1) are consumed by Tasks 2–4; `KnowledgeName` and `writeKnowledge` already exist; `Finding`/`DiffReview` (Task 4) are printed by Task 5.

# Dev Agent Kit v0.6 — Shared Engineering Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider-neutral engineering behavior (7 shared skills, a deterministic `packages/core`, shorter generalized managed instructions) without changing any existing frontend behavior.

**Architecture:** A new workspace package `packages/core` holds deterministic, dependency-free modules (git helpers, project profile detector, repo-memory freshness, context audit). Seven new top-level skills under `skills/` are picked up by the existing `syncSkills` with no installer change. The managed `CLAUDE.md`/`AGENTS.md` blocks are rewritten short and generic, keeping the frontend rules as a compact section.

**Tech Stack:** TypeScript (ES2022, NodeNext), `node --test` via `tsx`, no runtime dependencies in `packages/core` (only `node:*` and the `git` binary).

**Spec:** `docs/superpowers/specs/2026-09-24-dev-agent-kit-evolution.md` — §6 (v0.6), §24 (context economy), §26 (project inspector), §27 (instruction files), §38 (v0.6 checklist), §43 (compatibility).

## Global Constraints

- Do not create a second installer, benchmark framework, skill synchronizer or host adapter (§2). `packages/core` is a library only.
- All new skills are top-level directories under `skills/` (§4). No nested domain directories.
- Shared skills must not assume any frontend framework, backend framework, model host or task source (§6.1). Enforced by a test in Task 5.
- Every generated knowledge file carries `sourceSha` and `updatedAt` (§6.1). Knowledge and ledgers never contain secrets (§22, §24.3).
- Keep always-on instructions short; detailed workflows live in skills (§27). Do not mention task-source products in them.
- Compatibility (§43): `frontend-agent install|verify`, the seven frontend skill names, the MCP tool names, `.frontend-agent/config.yml` and all 18 existing eval scenarios stay untouched.
- Imports between `src/` files use `.js` extensions; tests import `src/` with `.ts` (repo convention). Cross-package imports use relative paths, no package exports.
- Git safety helpers in v0.6 are read-only. Anything that mutates a branch (fetch/ff-only/branch creation) is v0.7.
- Commits: append the attribution trailer the session configures. Never `git reset --hard`, never force-push.
- The real benchmark is intentionally skipped by the user; do not run `npm run bench`.

## Review Focus

Failure modes the spec implies but no obvious task test would otherwise exercise (each is pinned by a test in the owning task):

1. Directory that is not a git repo → `headSha`/`detectBaseBranch` return `null`/`undefined`, freshness is `unknown`, nothing throws (Task 1, 3).
2. Malformed or empty `package.json` / `pyproject.toml` → `detectProjectProfile` returns an empty-ish profile instead of throwing (Task 2).
3. `sourceSha` no longer in history (rebased/force-pushed repo) → freshness `unknown`, never `fresh` (Task 3).
4. Knowledge name with path traversal (`../../etc/x`) or a body containing a token/private key → write refused (Task 3).
5. Knowledge dir or file is a symlink → write refused (Task 3).
6. `CLAUDE.md` and `AGENTS.md` symlinked to one file → counted once by the audit, not reported as duplicate (Task 4).
7. Installed skills count grows from 7 to 14 and a re-run stays a no-op (Task 5).

---

### Task 1: `packages/core` scaffold + read-only git helpers

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/git.ts`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/tests/helpers.ts`
- Test: `packages/core/tests/git.test.ts`

**Interfaces:**
- Produces (`git.ts`):
  - `isGitRepo(root: string): boolean`
  - `headSha(root: string): string | null` — 12-char short SHA of HEAD
  - `changedSince(root: string, sha: string): string[] | null` — files changed between `sha` and HEAD; `null` if `sha` is malformed or not in history
  - `detectBaseBranch(root: string, configured?: string): string | undefined` — `configured` → `origin/HEAD` → `main` → `master`
- Produces (`tests/helpers.ts`): `makeRepo(branch?: string): string`, `commitFile(dir: string, name: string, content?: string): void`, `sh(dir: string, ...args: string[]): string`

- [ ] **Step 1: Create the package files**

`packages/core/package.json`:

```json
{
  "name": "@frontend-agent-kit/core",
  "version": "0.5.1",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --import tsx --test tests/*.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```

`packages/core/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "types": ["node"],
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

`packages/core/src/index.ts` (start empty of exports; each task appends):

```ts
export * from './git.js';
```

Run: `npm install` from the repo root (links the new workspace, updates `package-lock.json`).
Expected: exits 0; `git status` shows `package-lock.json` and the new package files.

- [ ] **Step 2: Write the test helpers**

`packages/core/tests/helpers.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function sh(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** A fresh git repo (no commits yet) with a local identity, on `branch`. */
export function makeRepo(branch = 'main'): string {
  const dir = mkdtempSync(join(tmpdir(), 'dak-core-'));
  sh(dir, 'init', '-q', '-b', branch);
  sh(dir, 'config', 'user.email', 't@example.com');
  sh(dir, 'config', 'user.name', 'Test');
  sh(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

export function commitFile(dir: string, name: string, content = 'x'): void {
  writeFileSync(join(dir, name), content);
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', `add ${name}`);
}
```

- [ ] **Step 3: Write the failing tests**

`packages/core/tests/git.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changedSince, detectBaseBranch, headSha, isGitRepo } from '../src/git.ts';
import { commitFile, makeRepo, sh } from './helpers.ts';

test('a directory that is not a git repo yields null/undefined, never throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dak-core-'));
  try {
    assert.equal(isGitRepo(dir), false);
    assert.equal(headSha(dir), null);
    assert.equal(changedSince(dir, 'abcdef1'), null);
    assert.equal(detectBaseBranch(dir), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('headSha is the 12-char short SHA; changedSince lists files after it', () => {
  const dir = makeRepo();
  try {
    commitFile(dir, 'a.txt');
    const first = headSha(dir)!;
    assert.match(first, /^[0-9a-f]{12}$/);
    assert.deepEqual(changedSince(dir, first), []);
    commitFile(dir, 'b.txt');
    assert.deepEqual(changedSince(dir, first), ['b.txt']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('changedSince returns null for a malformed sha or one that is not in history', () => {
  const dir = makeRepo();
  try {
    commitFile(dir, 'a.txt');
    assert.equal(changedSince(dir, '--output=/tmp/x'), null);
    assert.equal(changedSince(dir, 'not-a-sha'), null);
    assert.equal(changedSince(dir, 'deadbeefdead'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectBaseBranch: configured wins, then origin/HEAD, then main, then master', () => {
  const dir = makeRepo('trunk');
  const remote = mkdtempSync(join(tmpdir(), 'dak-core-remote-'));
  try {
    commitFile(dir, 'a.txt');
    assert.equal(detectBaseBranch(dir), undefined, 'no main/master/origin yet');
    assert.equal(detectBaseBranch(dir, 'develop'), 'develop');

    sh(remote, 'init', '-q', '--bare', '-b', 'trunk');
    sh(dir, 'remote', 'add', 'origin', remote);
    sh(dir, 'push', '-q', 'origin', 'trunk');
    sh(dir, 'remote', 'set-head', 'origin', 'trunk');
    assert.equal(detectBaseBranch(dir), 'trunk');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  }
});

test('detectBaseBranch falls back to main, then master', () => {
  const withMain = makeRepo('main');
  const withMaster = makeRepo('master');
  try {
    commitFile(withMain, 'a.txt');
    commitFile(withMaster, 'a.txt');
    assert.equal(detectBaseBranch(withMain), 'main');
    assert.equal(detectBaseBranch(withMaster), 'master');
  } finally {
    rmSync(withMain, { recursive: true, force: true });
    rmSync(withMaster, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm test --workspace=packages/core`
Expected: FAIL — `Cannot find module '../src/git.ts'`.

- [ ] **Step 5: Implement `git.ts`**

`packages/core/src/git.ts`:

```ts
import { execFileSync } from 'node:child_process';

const SHA_RE = /^[0-9a-f]{7,40}$/;

/** Run a read-only git command in `root`; null on any failure (not a repo, unknown ref, no git). */
function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function isGitRepo(root: string): boolean {
  return git(root, ['rev-parse', '--is-inside-work-tree']) === 'true';
}

export function headSha(root: string): string | null {
  return git(root, ['rev-parse', '--short=12', 'HEAD']);
}

/** Files changed between `sha` and HEAD. null when `sha` is malformed or not in this history. */
export function changedSince(root: string, sha: string): string[] | null {
  if (!SHA_RE.test(sha)) return null;
  const out = git(root, ['diff', '--name-only', `${sha}..HEAD`]);
  return out === null ? null : out.split('\n').filter(Boolean);
}

/** Base branch discovery: explicit config, then origin/HEAD, then a local main, then a local master. */
export function detectBaseBranch(root: string, configured?: string): string | undefined {
  if (configured) return configured;
  const originHead = git(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (originHead?.startsWith('origin/')) return originHead.slice('origin/'.length);
  for (const name of ['main', 'master']) {
    if (git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`]) !== null) return name;
  }
  return undefined;
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm test --workspace=packages/core && npm run typecheck --workspace=packages/core`
Expected: 5 tests pass; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/core package-lock.json
git commit -m "core: scaffold packages/core with read-only git helpers"
```

---

### Task 2: Project profile detector

**Files:**
- Create: `packages/core/src/project-profile.ts`
- Modify: `packages/core/src/index.ts` (add export)
- Test: `packages/core/tests/project-profile.test.ts`

**Interfaces:**
- Consumes: `isGitRepo`, `detectBaseBranch` from `./git.js`
- Produces: `interface ProjectProfile { languages: string[]; frameworks: string[]; packageManager?: string; testCommands: string[]; lintCommands: string[]; typecheckCommands: string[]; database?: string; migrationTool?: string; queue?: string; docker: boolean; baseBranch?: string }` and `detectProjectProfile(root: string): ProjectProfile`

Rules (spec §26): detect from repository evidence only; repository scripts beat Make/Task targets, which beat tool-config guesses; never invent a command.

- [ ] **Step 1: Write the failing tests**

`packages/core/tests/project-profile.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { detectProjectProfile } from '../src/project-profile.ts';
import { commitFile, makeRepo } from './helpers.ts';

function project(files: Record<string, string>): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'dak-profile-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('npm project: scripts become commands, frameworks come from dependencies', () => {
  const p = project({
    'package.json': JSON.stringify({
      scripts: { test: 'vitest', lint: 'eslint .', typecheck: 'tsc --noEmit', dev: 'vite' },
      dependencies: { react: '^18' },
      devDependencies: { typescript: '^5', tailwindcss: '^3' }
    }),
    'package-lock.json': '{}',
    'tsconfig.json': '{}'
  });
  try {
    const profile = detectProjectProfile(p.dir);
    assert.deepEqual(profile.languages, ['typescript']);
    assert.deepEqual(profile.frameworks.sort(), ['react', 'tailwind']);
    assert.equal(profile.packageManager, 'npm');
    assert.deepEqual(profile.testCommands, ['npm test']);
    assert.deepEqual(profile.lintCommands, ['npm run lint']);
    assert.deepEqual(profile.typecheckCommands, ['npm run typecheck']);
    assert.equal(profile.docker, false);
  } finally {
    p.cleanup();
  }
});

test('pnpm lockfile switches the command runner', () => {
  const p = project({ 'package.json': JSON.stringify({ scripts: { test: 'vitest', 'type-check': 'tsc' } }), 'pnpm-lock.yaml': '' });
  try {
    const profile = detectProjectProfile(p.dir);
    assert.equal(profile.packageManager, 'pnpm');
    assert.deepEqual(profile.testCommands, ['pnpm test']);
    assert.deepEqual(profile.typecheckCommands, ['pnpm type-check']);
    assert.deepEqual(profile.languages, ['javascript']);
  } finally {
    p.cleanup();
  }
});

test('Nest project with prisma, postgres compose and bullmq', () => {
  const p = project({
    'package.json': JSON.stringify({ dependencies: { '@nestjs/core': '^10', bullmq: '^5' } }),
    'prisma/schema.prisma': 'datasource db {\n  provider = "postgresql"\n}\n',
    'docker-compose.yml': 'services:\n  db:\n    image: postgres:16\n'
  });
  try {
    const profile = detectProjectProfile(p.dir);
    assert.deepEqual(profile.frameworks, ['nestjs']);
    assert.equal(profile.database, 'postgresql');
    assert.equal(profile.migrationTool, 'prisma');
    assert.equal(profile.queue, 'bullmq');
    assert.equal(profile.docker, true);
  } finally {
    p.cleanup();
  }
});

test('Django + DRF + celery + rabbitmq project uses tool config for commands when nothing else exists', () => {
  const p = project({
    'manage.py': '',
    'requirements.txt': 'Django==5.0\ndjangorestframework==3.15\ncelery==5\npytest\nruff\nmypy\npsycopg2-binary\n',
    'docker-compose.yml': 'services:\n  mq:\n    image: rabbitmq:3\n'
  });
  try {
    const profile = detectProjectProfile(p.dir);
    assert.deepEqual(profile.languages, ['python']);
    assert.deepEqual(profile.frameworks.sort(), ['django', 'drf']);
    assert.equal(profile.migrationTool, 'django');
    assert.equal(profile.database, 'postgresql');
    assert.equal(profile.queue, 'rabbitmq');
    assert.deepEqual(profile.testCommands, ['pytest']);
    assert.deepEqual(profile.lintCommands, ['ruff check .']);
    assert.deepEqual(profile.typecheckCommands, ['mypy .']);
  } finally {
    p.cleanup();
  }
});

test('django-cors-headers alone does not make a project Django', () => {
  const p = project({ 'requirements.txt': 'fastapi\ndjango-cors-headers\n' });
  try {
    assert.deepEqual(detectProjectProfile(p.dir).frameworks, ['fastapi']);
  } finally {
    p.cleanup();
  }
});

test('a Makefile target beats a tool-config guess; a package script beats a Makefile target', () => {
  const p = project({ 'pyproject.toml': '[tool.pytest]\n', Makefile: 'test:\n\tpytest -q\nlint:\n\truff .\n' });
  const q = project({ 'package.json': JSON.stringify({ scripts: { test: 'jest' } }), Makefile: 'test:\n\techo other\n' });
  try {
    const profile = detectProjectProfile(p.dir);
    assert.deepEqual(profile.testCommands, ['make test']);
    assert.deepEqual(profile.lintCommands, ['make lint']);
    assert.deepEqual(detectProjectProfile(q.dir).testCommands, ['npm test']);
  } finally {
    p.cleanup();
    q.cleanup();
  }
});

test('malformed package.json and empty directories never throw', () => {
  const bad = project({ 'package.json': '{ not json' });
  const empty = project({});
  try {
    const badProfile = detectProjectProfile(bad.dir);
    assert.deepEqual(badProfile.languages, []);
    assert.deepEqual(badProfile.testCommands, []);
    const emptyProfile = detectProjectProfile(empty.dir);
    assert.deepEqual(emptyProfile, {
      languages: [],
      frameworks: [],
      testCommands: [],
      lintCommands: [],
      typecheckCommands: [],
      docker: false
    });
  } finally {
    bad.cleanup();
    empty.cleanup();
  }
});

test('baseBranch is filled from git when the project is a repo', () => {
  const dir = makeRepo('main');
  try {
    commitFile(dir, 'a.txt');
    assert.equal(detectProjectProfile(dir).baseBranch, 'main');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=packages/core -- tests/project-profile.test.ts` (or `cd packages/core && node --import tsx --test tests/project-profile.test.ts`)
Expected: FAIL — `Cannot find module '../src/project-profile.ts'`.

- [ ] **Step 3: Implement `project-profile.ts`**

`packages/core/src/project-profile.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { detectBaseBranch, isGitRepo } from './git.js';

export interface ProjectProfile {
  languages: string[];
  frameworks: string[];
  packageManager?: string;
  testCommands: string[];
  lintCommands: string[];
  typecheckCommands: string[];
  database?: string;
  migrationTool?: string;
  queue?: string;
  docker: boolean;
  baseBranch?: string;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  packageManager?: string;
}

type Category = 'test' | 'lint' | 'typecheck';

const SCRIPT_NAMES: Record<Category, string[]> = {
  test: ['test'],
  lint: ['lint'],
  typecheck: ['typecheck', 'type-check']
};
const PYTHON_TOOL_COMMANDS: Record<Category, Array<[string, string]>> = {
  test: [['pytest', 'pytest']],
  lint: [['ruff', 'ruff check .']],
  typecheck: [['mypy', 'mypy .']]
};
const NODE_FRAMEWORKS: Array<[string, string]> = [
  ['react', 'react'],
  ['next', 'next'],
  ['vue', 'vue'],
  ['nuxt', 'nuxt'],
  ['@angular/core', 'angular'],
  ['@nestjs/core', 'nestjs'],
  ['express', 'express'],
  ['tailwindcss', 'tailwind']
];
const PYTHON_FRAMEWORKS: Array<[string, string]> = [
  ['django', 'django'],
  ['djangorestframework', 'drf'],
  ['fastapi', 'fastapi']
];
const NODE_PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'];
const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

function read(root: string, rel: string): string | null {
  try {
    return readFileSync(path.join(root, rel), 'utf8');
  } catch {
    return null;
  }
}

const has = (root: string, rel: string): boolean => existsSync(path.join(root, rel));

function readPackageJson(root: string): PackageJson | null {
  const text = read(root, 'package.json');
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as PackageJson) : null;
  } catch {
    return null;
  }
}

/** True when `name` appears in `text` as a whole requirement name (django-cors-headers is not django). */
function mentions(text: string, name: string): boolean {
  return new RegExp(`(^|[^a-z0-9_-])${name}([^a-z0-9_-]|$)`).test(text);
}

function detectPackageManager(root: string, pkg: PackageJson | null): string | undefined {
  const declared = pkg?.packageManager?.split('@')[0];
  if (declared && NODE_PACKAGE_MANAGERS.includes(declared)) return declared;
  if (has(root, 'pnpm-lock.yaml')) return 'pnpm';
  if (has(root, 'yarn.lock')) return 'yarn';
  if (has(root, 'bun.lockb') || has(root, 'bun.lock')) return 'bun';
  if (has(root, 'package-lock.json')) return 'npm';
  if (has(root, 'poetry.lock')) return 'poetry';
  if (has(root, 'uv.lock')) return 'uv';
  return pkg ? 'npm' : undefined;
}

function scriptCommand(pm: string, name: string): string {
  if (pm === 'npm') return name === 'test' ? 'npm test' : `npm run ${name}`;
  return `${pm} ${name}`;
}

function makeTargets(root: string): Set<string> {
  const targets = new Set<string>();
  for (const match of (read(root, 'Makefile') ?? '').matchAll(/^([A-Za-z0-9_-]+):/gm)) targets.add(`make ${match[1]}`);
  for (const match of (read(root, 'Taskfile.yml') ?? '').matchAll(/^ {2}([A-Za-z0-9_-]+):/gm)) targets.add(`task ${match[1]}`);
  return targets;
}

export function detectProjectProfile(root: string): ProjectProfile {
  const pkg = readPackageJson(root);
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const pyText = `${read(root, 'pyproject.toml') ?? ''}\n${read(root, 'requirements.txt') ?? ''}`.toLowerCase();
  const isPython = has(root, 'pyproject.toml') || has(root, 'requirements.txt') || has(root, 'manage.py') || has(root, 'setup.py');
  const compose = COMPOSE_FILES.map((f) => read(root, f) ?? '').join('\n').toLowerCase();

  const languages: string[] = [];
  if (pkg) languages.push(has(root, 'tsconfig.json') || 'typescript' in deps ? 'typescript' : 'javascript');
  if (isPython) languages.push('python');
  if (has(root, 'composer.json')) languages.push('php');

  const frameworks = NODE_FRAMEWORKS.filter(([dep]) => dep in deps).map(([, name]) => name);
  for (const [requirement, name] of PYTHON_FRAMEWORKS) if (mentions(pyText, requirement)) frameworks.push(name);
  if (has(root, 'manage.py') && !frameworks.includes('django')) frameworks.push('django');

  const packageManager = detectPackageManager(root, pkg);
  const nodePm = packageManager && NODE_PACKAGE_MANAGERS.includes(packageManager) ? packageManager : 'npm';
  const targets = makeTargets(root);
  const commandsFor = (category: Category): string[] => {
    const fromScripts = SCRIPT_NAMES[category].filter((name) => typeof pkg?.scripts?.[name] === 'string').map((name) => scriptCommand(nodePm, name));
    if (fromScripts.length > 0) return fromScripts;
    const fromTargets = SCRIPT_NAMES[category].flatMap((name) => [`make ${name}`, `task ${name}`]).filter((command) => targets.has(command));
    if (fromTargets.length > 0) return fromTargets;
    return PYTHON_TOOL_COMMANDS[category].filter(([tool]) => mentions(pyText, tool)).map(([, command]) => command);
  };

  const profile: ProjectProfile = {
    languages,
    frameworks,
    testCommands: commandsFor('test'),
    lintCommands: commandsFor('lint'),
    typecheckCommands: commandsFor('typecheck'),
    docker: has(root, 'Dockerfile') || COMPOSE_FILES.some((f) => has(root, f))
  };
  if (packageManager) profile.packageManager = packageManager;

  const prismaProvider = read(root, 'prisma/schema.prisma')?.match(/provider\s*=\s*"(postgresql|mysql|sqlite|sqlserver|mongodb)"/)?.[1];
  const composeDb = compose.match(/image:\s*["']?(postgres|mysql|mariadb)/)?.[1];
  const database =
    prismaProvider ??
    ('pg' in deps || 'postgres' in deps ? 'postgresql' : undefined) ??
    ('mysql2' in deps || 'mysql' in deps ? 'mysql' : undefined) ??
    ('sqlite3' in deps || 'better-sqlite3' in deps ? 'sqlite' : undefined) ??
    (mentions(pyText, 'psycopg2-binary') || mentions(pyText, 'psycopg2') || mentions(pyText, 'psycopg') ? 'postgresql' : undefined) ??
    (composeDb === 'postgres' ? 'postgresql' : composeDb === 'mariadb' ? 'mysql' : composeDb);
  if (database) profile.database = database;

  const migrationTool = has(root, 'alembic.ini') ? 'alembic' : has(root, 'prisma') ? 'prisma' : frameworks.includes('django') ? 'django' : undefined;
  if (migrationTool) profile.migrationTool = migrationTool;

  const queue = /image:\s*["']?rabbitmq/.test(compose) ? 'rabbitmq' : mentions(pyText, 'celery') ? 'celery' : 'bullmq' in deps ? 'bullmq' : undefined;
  if (queue) profile.queue = queue;

  if (isGitRepo(root)) {
    const baseBranch = detectBaseBranch(root);
    if (baseBranch) profile.baseBranch = baseBranch;
  }
  return profile;
}
```

- [ ] **Step 4: Export and run**

Append to `packages/core/src/index.ts`: `export * from './project-profile.js';`

Run: `npm test --workspace=packages/core && npm run typecheck --workspace=packages/core`
Expected: all pass. If the "empty directory" `deepEqual` fails because a temp dir lives inside a git repo, that is a bug: `/tmp` is not in a repo, so `baseBranch` must stay absent.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "core: deterministic project profile detector"
```

---

### Task 3: Repo memory (knowledge files + freshness)

**Files:**
- Create: `packages/core/src/repo-memory.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/repo-memory.test.ts`

**Interfaces:**
- Consumes: `headSha`, `changedSince` from `./git.js`
- Produces:
  - `KNOWLEDGE_NAMES = ['repository','architecture','frontend','backend','commands'] as const`; `type KnowledgeName`
  - `interface KnowledgeDoc { name: KnowledgeName; sourceSha: string; updatedAt: string; body: string }`
  - `knowledgePath(knowledgeDir: string, name: string): string` — throws for a name not in `KNOWLEDGE_NAMES`
  - `findSecret(text: string): string | null` — label of the first secret-looking pattern
  - `writeKnowledge(knowledgeDir: string, name: KnowledgeName, body: string, meta: { sourceSha: string; updatedAt?: string }): string` — returns the file path
  - `readKnowledge(knowledgeDir: string, name: KnowledgeName): KnowledgeDoc | null`
  - `type Freshness = { state: 'fresh' } | { state: 'stale'; changedFiles: string[] } | { state: 'unknown'; reason: string }`
  - `checkFreshness(root: string, doc: KnowledgeDoc): Freshness`

- [ ] **Step 1: Write the failing tests**

`packages/core/tests/repo-memory.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkFreshness, findSecret, knowledgePath, readKnowledge, writeKnowledge } from '../src/repo-memory.ts';
import { headSha } from '../src/git.ts';
import { commitFile, makeRepo } from './helpers.ts';

function tmp(): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'dak-mem-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('write then read round-trips body, sourceSha and updatedAt', () => {
  const t = tmp();
  try {
    const dir = join(t.dir, '.dev-agent', 'knowledge');
    const file = writeKnowledge(dir, 'commands', 'test: npm test\n', { sourceSha: 'abc1234', updatedAt: '2026-09-24T14:00:00Z' });
    assert.equal(file, join(dir, 'commands.md'));
    assert.match(readFileSync(file, 'utf8'), /^---\nsourceSha: abc1234\nupdatedAt: 2026-09-24T14:00:00Z\n---\n/);
    assert.deepEqual(readKnowledge(dir, 'commands'), {
      name: 'commands',
      sourceSha: 'abc1234',
      updatedAt: '2026-09-24T14:00:00Z',
      body: 'test: npm test'
    });
    assert.equal(readKnowledge(dir, 'backend'), null);
  } finally {
    t.cleanup();
  }
});

test('names outside the fixed set and malformed shas are refused', () => {
  const t = tmp();
  try {
    assert.throws(() => knowledgePath(t.dir, '../../etc/passwd'), /unknown knowledge file/);
    assert.throws(() => writeKnowledge(t.dir, 'repository', 'x', { sourceSha: 'not a sha' }), /invalid sourceSha/);
  } finally {
    t.cleanup();
  }
});

test('a body that looks like it holds a secret is refused', () => {
  const t = tmp();
  try {
    for (const body of [
      '-----BEGIN RSA PRIVATE KEY-----\nabc',
      'token ghp_' + 'a'.repeat(30),
      'AKIA' + 'A'.repeat(16),
      'api_key = "supersecretvalue123"',
      'password: hunter2hunter2'
    ]) {
      assert.throws(() => writeKnowledge(t.dir, 'repository', body, { sourceSha: 'abc1234' }), /secret/);
    }
    assert.equal(findSecret('the token is stored in the vault'), null);
  } finally {
    t.cleanup();
  }
});

test('writing through a symlinked knowledge dir or file is refused', () => {
  const t = tmp();
  try {
    const real = join(t.dir, 'real');
    mkdirSync(real);
    symlinkSync(real, join(t.dir, 'linkdir'));
    assert.throws(() => writeKnowledge(join(t.dir, 'linkdir'), 'repository', 'x', { sourceSha: 'abc1234' }), /symbolic link/);

    const dir = join(t.dir, 'k');
    mkdirSync(dir);
    writeFileSync(join(t.dir, 'target.md'), 'victim');
    symlinkSync(join(t.dir, 'target.md'), join(dir, 'repository.md'));
    assert.throws(() => writeKnowledge(dir, 'repository', 'x', { sourceSha: 'abc1234' }), /symbolic link/);
    assert.equal(readFileSync(join(t.dir, 'target.md'), 'utf8'), 'victim');
  } finally {
    t.cleanup();
  }
});

test('readKnowledge treats a file without valid frontmatter as missing', () => {
  const t = tmp();
  try {
    writeFileSync(join(t.dir, 'repository.md'), 'no frontmatter here');
    assert.equal(readKnowledge(t.dir, 'repository'), null);
  } finally {
    t.cleanup();
  }
});

test('freshness: fresh at the same HEAD, stale with changed files after new commits', () => {
  const repo = makeRepo();
  try {
    commitFile(repo, 'a.txt');
    const sha = headSha(repo)!;
    const doc = { name: 'repository' as const, sourceSha: sha, updatedAt: 'x', body: 'b' };
    assert.deepEqual(checkFreshness(repo, doc), { state: 'fresh' });
    commitFile(repo, 'b.txt');
    assert.deepEqual(checkFreshness(repo, doc), { state: 'stale', changedFiles: ['b.txt'] });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('freshness is unknown, never fresh, when the repo is missing or the sha left history', () => {
  const t = tmp();
  const repo = makeRepo();
  try {
    const doc = { name: 'repository' as const, sourceSha: 'deadbeefdead', updatedAt: 'x', body: 'b' };
    assert.equal(checkFreshness(t.dir, doc).state, 'unknown');
    commitFile(repo, 'a.txt');
    const result = checkFreshness(repo, doc);
    assert.equal(result.state, 'unknown');
  } finally {
    t.cleanup();
    rmSync(repo, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/core && node --import tsx --test tests/repo-memory.test.ts`
Expected: FAIL — `Cannot find module '../src/repo-memory.ts'`.

- [ ] **Step 3: Implement `repo-memory.ts`**

`packages/core/src/repo-memory.ts`:

```ts
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { changedSince, headSha } from './git.js';

export const KNOWLEDGE_NAMES = ['repository', 'architecture', 'frontend', 'backend', 'commands'] as const;
export type KnowledgeName = (typeof KNOWLEDGE_NAMES)[number];

export interface KnowledgeDoc {
  name: KnowledgeName;
  sourceSha: string;
  updatedAt: string;
  body: string;
}

export type Freshness = { state: 'fresh' } | { state: 'stale'; changedFiles: string[] } | { state: 'unknown'; reason: string };

const SHA_RE = /^[0-9a-f]{7,40}$/;
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bghp_[A-Za-z0-9]{20,}/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, 'GitHub token'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'API key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*['"]?[^\s'"]{8,}/i, 'credential assignment']
];

/** Label of the first secret-looking pattern in `text`, or null. */
export function findSecret(text: string): string | null {
  for (const [pattern, label] of SECRET_PATTERNS) if (pattern.test(text)) return label;
  return null;
}

export function knowledgePath(knowledgeDir: string, name: string): string {
  if (!(KNOWLEDGE_NAMES as readonly string[]).includes(name)) throw new Error(`unknown knowledge file "${name}"`);
  return path.join(knowledgeDir, `${name}.md`);
}

function assertNotSymlink(target: string): void {
  try {
    if (lstatSync(target).isSymbolicLink()) throw new Error(`refusing to write through a symbolic link: ${target}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export function writeKnowledge(knowledgeDir: string, name: KnowledgeName, body: string, meta: { sourceSha: string; updatedAt?: string }): string {
  const file = knowledgePath(knowledgeDir, name);
  if (!SHA_RE.test(meta.sourceSha)) throw new Error(`invalid sourceSha "${meta.sourceSha}"`);
  const secret = findSecret(body);
  if (secret) throw new Error(`refusing to write ${name}.md: the body looks like it contains a secret (${secret})`);
  assertNotSymlink(knowledgeDir);
  assertNotSymlink(file);
  mkdirSync(knowledgeDir, { recursive: true });
  const updatedAt = meta.updatedAt ?? new Date().toISOString();
  writeFileSync(file, `---\nsourceSha: ${meta.sourceSha}\nupdatedAt: ${updatedAt}\n---\n\n${body.trim()}\n`);
  return file;
}

export function readKnowledge(knowledgeDir: string, name: KnowledgeName): KnowledgeDoc | null {
  let text: string;
  try {
    text = readFileSync(knowledgePath(knowledgeDir, name), 'utf8');
  } catch {
    return null;
  }
  const match = text.match(/^---\nsourceSha: ([0-9a-f]{7,40})\nupdatedAt: (\S+)\n---\n\n?([\s\S]*)$/);
  if (!match) return null;
  return { name, sourceSha: match[1], updatedAt: match[2], body: match[3].trim() };
}

/** Compare a knowledge file's source commit with the repository's HEAD. Never reports fresh on doubt. */
export function checkFreshness(root: string, doc: KnowledgeDoc): Freshness {
  const head = headSha(root);
  if (head === null) return { state: 'unknown', reason: 'not a git repository or no commits' };
  if (head.startsWith(doc.sourceSha) || doc.sourceSha.startsWith(head)) return { state: 'fresh' };
  const changed = changedSince(root, doc.sourceSha);
  if (changed === null) return { state: 'unknown', reason: `source commit ${doc.sourceSha} is not in this history` };
  return changed.length === 0 ? { state: 'fresh' } : { state: 'stale', changedFiles: changed };
}
```

- [ ] **Step 4: Export and run**

Append to `packages/core/src/index.ts`: `export * from './repo-memory.js';`

Run: `npm test --workspace=packages/core && npm run typecheck --workspace=packages/core`
Expected: all pass. Note `'password: hunter2hunter2'` matches the credential pattern (value has 14 chars); `'the token is stored in the vault'` does not (no `:`/`=`).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "core: repo-memory knowledge files with sourceSha freshness and secret/symlink guards"
```

---

### Task 4: Context audit

**Files:**
- Create: `packages/core/src/context.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/context.test.ts`

**Interfaces:**
- Consumes: `KNOWLEDGE_NAMES`, `checkFreshness`, `readKnowledge` from `./repo-memory.js`
- Produces:
  - `MAX_INSTRUCTION_TOKENS = 1500`, `MAX_SKILL_TOKENS = 2500`
  - `estimateTokens(text: string): number` — `Math.ceil(chars / 4)`
  - `type FindingKind = 'large-instruction-file' | 'duplicate-content' | 'framework-knowledge' | 'oversized-skill' | 'stale-knowledge'`
  - `interface ContextFinding { kind: FindingKind; path: string; detail: string; removableTokens: number }`
  - `interface ContextAuditReport { findings: ContextFinding[]; alwaysOnTokens: number; removableTokens: number }`
  - `auditContext(root: string): ContextAuditReport`
  - `formatAuditReport(report: ContextAuditReport): string`

Sources scanned (all relative to `root`): `CLAUDE.md`, `AGENTS.md` (counted once if they resolve to the same file), `SKILL.md` of each skill under `.claude/skills/*` and `.agents/skills/*` (a skill present in both is read once), and `.dev-agent/knowledge/*.md`.

- [ ] **Step 1: Write the failing tests**

`packages/core/tests/context.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { auditContext, estimateTokens, formatAuditReport, MAX_INSTRUCTION_TOKENS } from '../src/context.ts';
import { headSha } from '../src/git.ts';
import { writeKnowledge } from '../src/repo-memory.ts';
import { commitFile, makeRepo } from './helpers.ts';

function project(files: Record<string, string>): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'dak-ctx-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const PARAGRAPH = 'Always run the full test suite before reporting a task as finished, and record the exact command and its result in the task notes.';
const skill = (body: string) => `---\nname: s\ndescription: d\n---\n\n${body}\n`;

test('estimateTokens is ceil(chars / 4)', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2);
});

test('a small clean project has no findings', () => {
  const p = project({ 'CLAUDE.md': '# Rules\n\nInspect before editing.\n' });
  try {
    const report = auditContext(p.dir);
    assert.deepEqual(report.findings, []);
    assert.ok(report.alwaysOnTokens > 0);
    assert.equal(report.removableTokens, 0);
    assert.match(formatAuditReport(report), /no findings/i);
  } finally {
    p.cleanup();
  }
});

test('an instruction file over the limit is flagged with the excess as removable', () => {
  const p = project({ 'CLAUDE.md': 'x'.repeat(4 * (MAX_INSTRUCTION_TOKENS + 100)) });
  try {
    const finding = auditContext(p.dir).findings.find((f) => f.kind === 'large-instruction-file');
    assert.equal(finding?.path, 'CLAUDE.md');
    assert.equal(finding?.removableTokens, 100);
  } finally {
    p.cleanup();
  }
});

test('the same paragraph in an instruction file and a skill is a duplicate; short repeats are not', () => {
  const p = project({
    'CLAUDE.md': `${PARAGRAPH}\n\nShort line.\n`,
    '.claude/skills/verify/SKILL.md': skill(`${PARAGRAPH}\n\nShort line.`)
  });
  try {
    const duplicates = auditContext(p.dir).findings.filter((f) => f.kind === 'duplicate-content');
    assert.equal(duplicates.length, 1);
    assert.equal(duplicates[0].path, '.claude/skills/verify/SKILL.md');
    assert.match(duplicates[0].detail, /CLAUDE\.md/);
    assert.equal(duplicates[0].removableTokens, estimateTokens(PARAGRAPH));
  } finally {
    p.cleanup();
  }
});

test('CLAUDE.md and AGENTS.md symlinked to one file are counted once, not as duplicates', () => {
  const p = project({ 'CLAUDE.md': `${PARAGRAPH}\n` });
  try {
    symlinkSync(join(p.dir, 'CLAUDE.md'), join(p.dir, 'AGENTS.md'));
    const report = auditContext(p.dir);
    assert.deepEqual(report.findings, []);
    assert.equal(report.alwaysOnTokens, estimateTokens(`${PARAGRAPH}\n`));
  } finally {
    p.cleanup();
  }
});

test('a skill installed for both hosts is read once', () => {
  const body = skill(PARAGRAPH);
  const p = project({ '.claude/skills/verify/SKILL.md': body, '.agents/skills/verify/SKILL.md': body });
  try {
    assert.deepEqual(auditContext(p.dir).findings, []);
  } finally {
    p.cleanup();
  }
});

test('an instruction file naming three or more frameworks is flagged as lazy-loadable knowledge', () => {
  const p = project({
    'CLAUDE.md': '# Stack\n\nUse React hooks for state.\nUse Django views for the API.\nStyle with Tailwind utilities.\nAlways write tests.\n'
  });
  try {
    const finding = auditContext(p.dir).findings.find((f) => f.kind === 'framework-knowledge');
    assert.ok(finding);
    assert.match(finding!.detail, /react/i);
    assert.ok(finding!.removableTokens > 0);
  } finally {
    p.cleanup();
  }
});

test('an oversized skill is flagged', () => {
  const p = project({ '.claude/skills/big/SKILL.md': skill('y'.repeat(4 * 2600)) });
  try {
    assert.equal(auditContext(p.dir).findings.find((f) => f.kind === 'oversized-skill')?.path, '.claude/skills/big/SKILL.md');
  } finally {
    p.cleanup();
  }
});

test('stale repo knowledge is reported; fresh knowledge is not', () => {
  const repo = makeRepo();
  try {
    commitFile(repo, 'a.txt');
    const dir = join(repo, '.dev-agent', 'knowledge');
    writeKnowledge(dir, 'repository', 'Fresh facts about the repository layout.', { sourceSha: headSha(repo)! });
    assert.deepEqual(auditContext(repo).findings.filter((f) => f.kind === 'stale-knowledge'), []);
    commitFile(repo, 'b.txt');
    const stale = auditContext(repo).findings.filter((f) => f.kind === 'stale-knowledge');
    assert.equal(stale.length, 1);
    assert.equal(stale[0].path, '.dev-agent/knowledge/repository.md');
    assert.match(stale[0].detail, /1 file/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('formatAuditReport lists each finding and the totals', () => {
  const p = project({ 'CLAUDE.md': `${PARAGRAPH}\n\n${PARAGRAPH}\n` });
  try {
    const text = formatAuditReport(auditContext(p.dir));
    assert.match(text, /always-on: ~\d+ tokens/);
    assert.match(text, /\[duplicate-content\] CLAUDE\.md/);
    assert.match(text, /removable: ~\d+ tokens/);
  } finally {
    p.cleanup();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/core && node --import tsx --test tests/context.test.ts`
Expected: FAIL — `Cannot find module '../src/context.ts'`.

- [ ] **Step 3: Implement `context.ts`**

`packages/core/src/context.ts`:

```ts
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { KNOWLEDGE_NAMES, checkFreshness, readKnowledge } from './repo-memory.js';

export const MAX_INSTRUCTION_TOKENS = 1500;
export const MAX_SKILL_TOKENS = 2500;
const MIN_DUPLICATE_CHARS = 80;
const FRAMEWORK_RE = /\b(react|vue|nuxt|next\.js|angular|django|fastapi|nestjs|laravel|tailwind)\b/gi;
const MIN_FRAMEWORKS_FOR_FINDING = 3;

export type FindingKind = 'large-instruction-file' | 'duplicate-content' | 'framework-knowledge' | 'oversized-skill' | 'stale-knowledge';

export interface ContextFinding {
  kind: FindingKind;
  path: string;
  detail: string;
  removableTokens: number;
}

export interface ContextAuditReport {
  findings: ContextFinding[];
  alwaysOnTokens: number;
  removableTokens: number;
}

interface Source {
  file: string;
  text: string;
  kind: 'instruction' | 'skill';
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function readIfFile(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function collectSources(root: string): Source[] {
  const sources: Source[] = [];
  const seenReal = new Set<string>();
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    const file = path.join(root, name);
    if (!existsSync(file)) continue;
    const real = realpathSync(file);
    if (seenReal.has(real)) continue;
    seenReal.add(real);
    const text = readIfFile(file);
    if (text !== null) sources.push({ file: name, text, kind: 'instruction' });
  }
  const seenSkills = new Set<string>();
  for (const skillsDir of ['.claude/skills', '.agents/skills']) {
    let entries: string[];
    try {
      entries = readdirSync(path.join(root, skillsDir), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      continue;
    }
    for (const skillName of entries.sort()) {
      if (seenSkills.has(skillName)) continue;
      const rel = `${skillsDir}/${skillName}/SKILL.md`;
      const text = readIfFile(path.join(root, rel));
      if (text === null) continue;
      seenSkills.add(skillName);
      sources.push({ file: rel, text, kind: 'skill' });
    }
  }
  return sources;
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length >= MIN_DUPLICATE_CHARS);
}

export function auditContext(root: string): ContextAuditReport {
  const findings: ContextFinding[] = [];
  const sources = collectSources(root);

  const firstSeen = new Map<string, string>();
  for (const source of sources) {
    for (const paragraph of paragraphs(source.text)) {
      const earlier = firstSeen.get(paragraph);
      if (earlier === undefined) {
        firstSeen.set(paragraph, source.file);
      } else {
        findings.push({
          kind: 'duplicate-content',
          path: source.file,
          detail: `paragraph already in ${earlier}: "${paragraph.slice(0, 60)}…"`,
          removableTokens: estimateTokens(paragraph)
        });
      }
    }
  }

  for (const source of sources) {
    const tokens = estimateTokens(source.text);
    if (source.kind === 'instruction') {
      if (tokens > MAX_INSTRUCTION_TOKENS) {
        findings.push({
          kind: 'large-instruction-file',
          path: source.file,
          detail: `~${tokens} tokens always loaded (limit ${MAX_INSTRUCTION_TOKENS}); move detail into skills`,
          removableTokens: tokens - MAX_INSTRUCTION_TOKENS
        });
      }
      const names = new Set([...source.text.matchAll(FRAMEWORK_RE)].map((m) => m[1].toLowerCase()));
      if (names.size >= MIN_FRAMEWORKS_FOR_FINDING) {
        const frameworkLines = source.text.split('\n').filter((line) => new RegExp(FRAMEWORK_RE.source, 'i').test(line));
        findings.push({
          kind: 'framework-knowledge',
          path: source.file,
          detail: `names ${[...names].sort().join(', ')}; load framework detail lazily from skills/references`,
          removableTokens: estimateTokens(frameworkLines.join('\n'))
        });
      }
    } else if (tokens > MAX_SKILL_TOKENS) {
      findings.push({
        kind: 'oversized-skill',
        path: source.file,
        detail: `~${tokens} tokens (limit ${MAX_SKILL_TOKENS}); move detail into references/`,
        removableTokens: tokens - MAX_SKILL_TOKENS
      });
    }
  }

  const knowledgeDir = path.join(root, '.dev-agent', 'knowledge');
  for (const name of KNOWLEDGE_NAMES) {
    const rel = `.dev-agent/knowledge/${name}.md`;
    if (!existsSync(path.join(knowledgeDir, `${name}.md`))) continue;
    const doc = readKnowledge(knowledgeDir, name);
    if (!doc) {
      findings.push({ kind: 'stale-knowledge', path: rel, detail: 'missing or malformed sourceSha frontmatter; regenerate', removableTokens: 0 });
      continue;
    }
    const freshness = checkFreshness(root, doc);
    if (freshness.state === 'stale') {
      findings.push({
        kind: 'stale-knowledge',
        path: rel,
        detail: `${freshness.changedFiles.length} file(s) changed since ${doc.sourceSha}; revalidate the affected sections`,
        removableTokens: estimateTokens(doc.body)
      });
    } else if (freshness.state === 'unknown') {
      findings.push({ kind: 'stale-knowledge', path: rel, detail: `cannot verify freshness: ${freshness.reason}`, removableTokens: estimateTokens(doc.body) });
    }
  }

  return {
    findings,
    alwaysOnTokens: sources.filter((s) => s.kind === 'instruction').reduce((sum, s) => sum + estimateTokens(s.text), 0),
    removableTokens: findings.reduce((sum, f) => sum + f.removableTokens, 0)
  };
}

export function formatAuditReport(report: ContextAuditReport): string {
  const lines = [`context audit — always-on: ~${report.alwaysOnTokens} tokens`];
  if (report.findings.length === 0) {
    lines.push('no findings');
  } else {
    for (const f of report.findings) lines.push(`  [${f.kind}] ${f.path} — ${f.detail} (~${f.removableTokens} tokens)`);
    lines.push(`removable: ~${report.removableTokens} tokens`);
  }
  return lines.join('\n');
}
```

Design note for the executor: the `formatAuditReport` test expects a `removable:` line only when there are findings; the empty case prints `no findings`.

- [ ] **Step 4: Export and run**

Append to `packages/core/src/index.ts`: `export * from './context.js';`

Run: `npm test --workspace=packages/core && npm run typecheck --workspace=packages/core`
Expected: all pass. If the "symlinked" test fails on `alwaysOnTokens`, check that `AGENTS.md` (a symlink to `CLAUDE.md`) resolves via `realpathSync` to the same real path and is skipped.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "core: context audit (large/duplicate/framework/stale findings, token estimates)"
```

---

### Task 5: The seven shared skills

**Files:**
- Create: `skills/engineering-architecture/SKILL.md`
- Create: `skills/repository-investigation/SKILL.md`
- Create: `skills/verification/SKILL.md`
- Create: `skills/root-cause-analysis/SKILL.md`
- Create: `skills/surgical-diff/SKILL.md`
- Create: `skills/context-efficiency/SKILL.md`
- Create: `skills/repo-memory/SKILL.md`
- Test: `packages/core/tests/shared-skills.test.ts`
- Test: `packages/cli/tests/shared-skills-install.test.ts`

**Interfaces:**
- Consumes: `run`, `CliIo` from `packages/cli/src/cli.ts`; `findKitRoot` from `packages/cli/src/util.ts`
- Produces: seven skill directories the existing `syncSkills` installs automatically (no installer change).

Skills follow the existing format: frontmatter `name` (= directory name) and a single-line `description`, then a body. English, like the current skills. `scripts/validate-skill.mjs` only requires frontmatter and a body of at least 50 chars for a `SKILL.md`.

- [ ] **Step 1: Write the failing guard tests**

`packages/core/tests/shared-skills.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const kitRoot = fileURLToPath(new URL('../../../', import.meta.url));
const SHARED = [
  'engineering-architecture',
  'repository-investigation',
  'verification',
  'root-cause-analysis',
  'surgical-diff',
  'context-efficiency',
  'repo-memory'
];
// Shared skills must not assume a framework, a host, a design tool or a task-source product (spec §6.1, §27).
const FORBIDDEN =
  /\b(react|vue|nuxt|next\.js|angular|django|drf|fastapi|nestjs|express|laravel|tailwind|figma|jira|linear|trello|asana|clickup|azure devops|claude code|codex)\b/i;
const MAX_LINES = 60;

for (const name of SHARED) {
  test(`skill ${name}: valid frontmatter, neutral, compact`, () => {
    const text = readFileSync(join(kitRoot, 'skills', name, 'SKILL.md'), 'utf8');
    const front = text.match(/^---\nname: (.+)\ndescription: (.+)\n---\n/);
    assert.ok(front, 'frontmatter must be exactly name + one-line description');
    assert.equal(front![1], name);
    assert.match(front![2], /^.{40,400}$/);
    assert.doesNotMatch(text, FORBIDDEN);
    assert.ok(text.split('\n').length <= MAX_LINES, `${name} has more than ${MAX_LINES} lines; move detail into references/`);
  });
}
```

`packages/cli/tests/shared-skills-install.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, type CliIo } from '../src/cli.ts';

const SHARED = ['engineering-architecture', 'repository-investigation', 'verification', 'root-cause-analysis', 'surgical-diff', 'context-efficiency', 'repo-memory'];
const FRONTEND = ['accessibility', 'component-selection', 'figma-to-code', 'frontend-design', 'motion-design', 'responsive-design', 'visual-validation'];

test('install puts the 7 frontend and 7 shared skills in the project, and a re-run is a no-op', async () => {
  const base = mkdtempSync(join(tmpdir(), 'frontend-agent-shared-'));
  try {
    const projectRoot = join(base, 'project');
    const homeDir = join(base, 'home');
    mkdirSync(projectRoot);
    mkdirSync(homeDir);
    const out: string[] = [];
    const io: CliIo = { stdout: (l) => out.push(l), stderr: () => {}, env: { PATH: '', CODEX_HOME: join(base, 'codex-home') }, cwd: projectRoot, homeDir };
    assert.equal(await run(['install', 'claude', '--project', projectRoot], io), 0);
    for (const name of [...FRONTEND, ...SHARED]) assert.ok(existsSync(join(projectRoot, '.claude', 'skills', name, 'SKILL.md')), name);
    assert.equal(readdirSync(join(projectRoot, '.claude', 'skills'), { withFileTypes: true }).filter((e) => e.isDirectory()).length, 14);
    out.length = 0;
    assert.equal(await run(['install', 'claude', '--project', projectRoot], io), 0);
    assert.match(out.join('\n'), /0 added, 0 updated, 0 removed/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run to verify both fail**

Run: `npm test --workspace=packages/core -- tests/shared-skills.test.ts` and `cd packages/cli && node --import tsx --test tests/shared-skills-install.test.ts`
Expected: FAIL — `ENOENT ... skills/engineering-architecture/SKILL.md` and missing skill files in the install test.

- [ ] **Step 3: Write the seven skills**

`skills/engineering-architecture/SKILL.md`:

```markdown
---
name: engineering-architecture
description: Inspect the existing architecture before designing anything, reuse local patterns, and define boundaries, states and concurrency rules explicitly. Use before adding a module, service, data model or any change that crosses a boundary.
---

# Engineering Architecture

Design from what the repository already does, not from a preferred style.

## Before designing

1. Find the closest existing feature (see `repository-investigation`) and read how it is layered: entry point, domain logic, persistence, tests.
2. List the boundaries the change touches: modules, processes, network calls, storage.
3. Write down the invariants the change must protect: data that must stay consistent, states that must never coexist.

## Rules

- Reuse a local pattern before introducing an abstraction. A new layer, interface or helper needs a concrete second caller or a stated reason.
- Give each boundary one owner. If two modules can both write the same state, decide which one does.
- Model states explicitly: name them, list the allowed transitions, reject the rest at the boundary.
- For every write path ask: can two writers act at once? Can this run twice? What makes it safe (transaction, unique constraint, idempotency key, lock)?
- Keep the change minimal: no new dependency, folder or convention unless the existing ones cannot express it.
- Record the decision and the rejected alternative in one or two lines; do not write an essay.

## Output

A short design note: boundaries touched, existing pattern followed, invariants, concurrency/idempotency answer, files expected to change.
```

`skills/repository-investigation/SKILL.md`:

```markdown
---
name: repository-investigation
description: Build a compact, evidence-backed map of an unfamiliar repository - stack, package manager, real test/lint/typecheck commands, structure and neighboring implementations. Use before planning or editing in any repository you have not mapped yet.
---

# Repository Investigation

Read the repository; do not assume it. Every claim in the map cites a file.

## Steps

1. Stack: read the manifest and config files (`package.json`, `pyproject.toml`, `requirements.txt`, `composer.json`, `Dockerfile`, compose files). Do not assume a framework.
2. Package manager: from the lockfile or the declared field, not from habit.
3. Commands: take test, lint and typecheck commands from the repository's own scripts, Makefile or task runner. Never guess a command when a script exists; if none exists, say so.
4. Structure: list the top-level folders and what each holds.
5. Neighbors: find the closest existing component, service, model, schema or endpoint to the change, and its tests. The new code should look like them.
6. History when useful: `git log -n 5 -- <path>` on the files you will touch, to learn recent intent.
7. If fresh repo memory exists (`repo-memory`), start from it and only re-read what changed.

## Output

Keep it under about 25 lines:

```
STACK        language, frameworks, package manager
COMMANDS     test / lint / typecheck / run, each with its source file
STRUCTURE    folder -> purpose
NEIGHBORS    path:line -> why it is the pattern to follow
RISKS        anything surprising or unverified
```
```

`skills/verification/SKILL.md`:

```markdown
---
name: verification
description: Prove behavior with the surface's real mechanism instead of compilation alone - render UIs, call APIs, run migrations, consume jobs, reproduce bugs before and after. Use before reporting any task as done.
---

# Verification

Compilation and unit tests are necessary and never sufficient. Compilation alone is never runtime proof.

## What counts as proof

| Surface | Proof |
|---|---|
| User interface | Render it and interact with it |
| API | A real request against a running service when practical, checking status, body and side effects |
| Database | Run the migration and the query against a real database |
| Background job | Enqueue and consume a message when practical |
| Bug fix | Reproduce before the fix and again after it |
| Refactor | The same tests pass before and after, unchanged |

## Rules

- Run the repository's own test, lint and typecheck commands first (see `repository-investigation`).
- Then exercise the changed behavior for real. If you cannot (no service, no credentials, no browser), say exactly what was not run and why.
- Never claim "works" from reading code. Evidence is a command and its observed result.
- A failure you did not expect is a finding, not noise: stop and diagnose it (see `root-cause-analysis`).

## Report

For each check: the command or action, the observed result, and anything left unverified.
```

`skills/root-cause-analysis/SKILL.md`:

```markdown
---
name: root-cause-analysis
description: Fix defects by reproducing them, gathering evidence, naming the root cause, adding a regression test and only then fixing. Use for any bug report, failing test or unexpected behavior.
---

# Root Cause Analysis

Sequence, in order and without skipping:

```
reproduce -> evidence -> root cause -> regression test -> fix -> verify
```

## Rules

1. Reproduce first. Get the failure to happen on demand with a command or a test. If you cannot reproduce it, say so and stop guessing.
2. Collect evidence: the exact error, the input, the code path, recent changes to it (`git log`, `git blame`).
3. Name the root cause in one sentence, and state the evidence that separates it from the symptom.
4. Write a regression test that fails for that cause before the fix.
5. Fix the cause, not the symptom. Do not add a guard that hides the failure.
6. Verify: the new test passes, the reproduction no longer fails, the surrounding suite is green (see `verification`).
7. Look for siblings: other places with the same flawed pattern. Report them; fix them only if they are in scope.

## Report

Reproduction, root cause, the test added, the fix, and the verification result.
```

`skills/surgical-diff/SKILL.md`:

```markdown
---
name: surgical-diff
description: Compare the requested scope with the actual diff before finishing and remove or justify anything unrelated - renames, formatting churn, speculative abstractions, stray comments. Use as the last step before reporting a change as complete.
---

# Surgical Diff

```
requested scope  ~=  actual diff
```

## Procedure

1. Restate the requested scope in one or two lines.
2. Read the full diff (`git diff` and `git status`), not just the file list.
3. Flag every hunk that is not required by the scope:
   - unrelated renames or file moves
   - formatting or whitespace churn in untouched lines
   - speculative abstractions, options or parameters nobody uses yet
   - unrelated comments, dead code, debug output
   - dependency or config changes the task did not need
4. For each flagged hunk: revert it, or justify it in one line if it is genuinely required.
5. Confirm tests still cover the intended change and nothing else was silently dropped.

## Report

`scope check: clean` or a list of the items removed and the items kept with their reason.
```

`skills/context-efficiency/SKILL.md`:

```markdown
---
name: context-efficiency
description: Keep agent context small without lowering correctness - load only task-relevant skills, keep subagent reports compact and structured, reuse fresh repository memory. Use at the start of a task and whenever delegating work.
---

# Context Efficiency

Use the minimum context required to make the correct decision. Not the fewest tokens possible.

## Rules

- Load only the skills the task needs. Do not load frontend references for a backend task, or the reverse.
- Load a reference only when the stack it covers is present in the repository.
- Do not re-derive repository facts that fresh repo memory already holds (see `repo-memory`); re-read only what changed.
- Never compress code, error messages, commands or file paths. Compress prose only, and only where meaning survives.
- Do not restate to the user or to a subagent what is already visible in the conversation.

## Subagent reports

Ask for a structured, low-noise report:

```
FILES     path: role
PATTERN   the convention found
RISK      what could go wrong
NEXT      the single next action
```

Reject long narrative reports; ask for the structure instead.

## When unsure

Prefer one more targeted read over a guess. Correctness outranks economy.
```

`skills/repo-memory/SKILL.md`:

```markdown
---
name: repo-memory
description: Persist and revalidate stable repository knowledge under .dev-agent/knowledge, each file stamped with the source commit SHA, so later tasks skip rediscovery without trusting stale facts. Use after investigating a repository and before repeating an investigation.
---

# Repo Memory

Stable facts about a repository, cached locally so the next task does not rediscover them.

## Files

```
.dev-agent/knowledge/
  repository.md    stack, package manager, structure
  architecture.md  boundaries, service map, patterns
  frontend.md      design system location, component conventions
  backend.md       service boundaries, data and job conventions
  commands.md      test / lint / typecheck / run commands and their sources
```

Every file starts with:

```yaml
---
sourceSha: abc1234abcde
updatedAt: 2026-09-24T14:00:00Z
---
```

`sourceSha` is `git rev-parse --short=12 HEAD` at the time the facts were verified.

## Using memory

1. Read the file and compare `sourceSha` with the current `git rev-parse --short=12 HEAD`.
2. Equal: trust it.
3. Different: run `git diff --name-only <sourceSha> HEAD`. Revalidate only the sections that mention changed files, then update the file and its `sourceSha`.
4. `sourceSha` not found in history, or not a git repository: treat the file as stale and regenerate it.

## Never cache

- Secrets, tokens, credentials or private URLs.
- Task-specific state or progress. That belongs in the task ledger, not here.
- Anything you did not verify in the repository.
```

- [ ] **Step 4: Run guards, validator and the full suites**

Run: `npm run validate:skills && npm test`
Expected: `validate-skill: all skills valid.`, core tests pass (including 7 skill guards), cli tests pass (including the 14-skill install test), evals tests pass.

- [ ] **Step 5: Commit**

```bash
git add skills packages/core/tests/shared-skills.test.ts packages/cli/tests/shared-skills-install.test.ts
git commit -m "skills: add the seven shared engineering skills"
```

---

### Task 6: Short, generalized managed instructions

**Files:**
- Modify: `integrations/claude/CLAUDE.md`
- Modify: `integrations/codex/AGENTS.md`
- Modify: `packages/cli/tests/instructions.test.ts:53,56` (heading text)
- Test: `packages/cli/tests/instructions-shape.test.ts`

**Interfaces:**
- Consumes: `findKitRoot` from `packages/cli/src/util.ts`
- Produces: rewritten managed-block texts. The block markers, `instructionsContent` and every adapter stay unchanged.

Constraints: at most 1800 characters each (about 450 tokens); generic principles first; the existing frontend rules stay as a compact section (compatibility, since the benchmark baseline is skipped); no mention of `task-orchestrator` (it does not exist until v0.7) or of any task-source product.

- [ ] **Step 1: Write the failing test**

`packages/cli/tests/instructions-shape.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findKitRoot } from '../src/util.ts';

const MAX_CHARS = 1800;
const files = { claude: 'integrations/claude/CLAUDE.md', codex: 'integrations/codex/AGENTS.md' };

for (const [host, rel] of Object.entries(files)) {
  test(`${host} instructions: short, generic first, frontend rules kept, no task-source products`, () => {
    const text = readFileSync(join(findKitRoot(), rel), 'utf8');
    assert.ok(text.length <= MAX_CHARS, `${rel} is ${text.length} chars, limit ${MAX_CHARS}`);
    assert.match(text, /^# Dev Agent Kit/);
    assert.match(text, /Inspect the repository before editing/i);
    assert.match(text, /real behavior/i);
    assert.match(text, /requested scope/i);
    assert.ok(text.indexOf('Inspect the repository') < text.indexOf('Figma'), 'generic principles come before the frontend section');
    for (const kept of ['Figma', 'compare_screenshots', 'run_responsive_suite', 'run_accessibility_audit']) assert.match(text, new RegExp(kept));
    assert.doesNotMatch(text, /task-orchestrator|jira|linear|trello|asana|clickup/i);
  });
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/cli && node --import tsx --test tests/instructions-shape.test.ts`
Expected: FAIL — headings still say `# Frontend Agent Kit` / `# Frontend repository instructions`.

- [ ] **Step 3: Rewrite the two files**

`integrations/claude/CLAUDE.md`:

```markdown
# Dev Agent Kit

Use the skills installed in `.claude/skills/` (from this kit's canonical `skills/` directory). Load only the ones the task needs.

1. Inspect the repository before editing: existing patterns, neighboring code, the real test, lint and typecheck commands.
2. Verify real behavior, not just compilation: run it, exercise it, reproduce bugs before and after the fix.
3. Keep the diff to the requested scope.

## Frontend tasks

For Figma implementation tasks:

1. Treat Figma as the design source of truth.
2. Reuse existing repository components before creating new components.
3. Use the Figma MCP for design context, variables, screenshots and assets.
4. Use the frontend-agent MCP (capture_screenshot, inspect_dom, compare_screenshots, run_responsive_suite, run_accessibility_audit) for browser validation and visual diff.
5. Run visual and responsive validation before considering the task complete.
```

`integrations/codex/AGENTS.md`:

```markdown
# Dev Agent Kit repository instructions

Use the skills installed in `.agents/skills/` (from this kit's canonical `skills/` directory). Load only the ones the task needs.

## Mandatory workflow

- Inspect the repository before editing: existing patterns, neighboring code, the real test, lint and typecheck commands.
- Verify real behavior, not just compilation: run it, exercise it, reproduce bugs before and after the fix.
- Keep the diff to the requested scope.

## Frontend tasks

- For tasks containing a Figma link, use the `figma-to-code` skill.
- Reuse repository components and tokens before introducing new primitives.
- Use Figma MCP design context and screenshots as the source of truth.
- Validate implemented UI through the frontend-agent MCP (compare_screenshots, run_responsive_suite, run_accessibility_audit).
- Run responsive and accessibility validation before finishing substantial UI work; validate the configured target viewports.
```

- [ ] **Step 4: Fix the old heading assertions**

In `packages/cli/tests/instructions.test.ts` replace the two occurrences of `Frontend repository instructions` (line 53 regex `/Frontend repository instructions/` and line 56 string) with `Dev Agent Kit repository instructions`.

- [ ] **Step 5: Run the CLI and evals suites**

Run: `npm test --workspace=packages/cli && npm test --workspace=packages/evals`
Expected: all pass. The evals fake-host tests install through the CLI, so they also prove the new instructions install cleanly.

- [ ] **Step 6: Commit**

```bash
git add integrations packages/cli/tests
git commit -m "instructions: short generic managed blocks, frontend rules kept as a section"
```

---

### Task 7: Docs, version bump and release v0.6.0

**Files:**
- Create: `docs/context-efficiency.md`
- Modify: `README.md` (new "v0.6" section after the CLI section)
- Modify: `packages/cli/package.json`, `packages/evals/package.json`, `packages/core/package.json` (`0.5.1` → `0.6.0`)
- Modify: `packages/cli/tests/util.test.ts`, `packages/cli/tests/cli.test.ts` (`'0.5.1'` → `'0.6.0'`)
- Modify: `package-lock.json` (via `npm install`)

- [ ] **Step 1: Write `docs/context-efficiency.md`**

```markdown
# Context efficiency

Rule: use the minimum context required to make the correct decision — not the fewest tokens possible.

## What v0.6 adds

- **Seven shared skills** (`engineering-architecture`, `repository-investigation`, `verification`, `root-cause-analysis`, `surgical-diff`, `context-efficiency`, `repo-memory`). They are framework-, host- and task-source-neutral and are installed with the frontend skills.
- **Short managed instructions.** `CLAUDE.md` / `AGENTS.md` blocks hold only the generic principles and a compact frontend section. Detailed workflows live in skills, loaded on demand.
- **`packages/core`.** Deterministic helpers: `detectProjectProfile`, `headSha`/`changedSince`/`detectBaseBranch`, repo-memory read/write/freshness, and `auditContext`.

## Repo memory

Stable facts live in `.dev-agent/knowledge/{repository,architecture,frontend,backend,commands}.md`. Each file starts with `sourceSha` and `updatedAt`. When HEAD differs from `sourceSha`, revalidate only the sections touching `git diff --name-only <sourceSha> HEAD`. Secrets are never written (writes containing them are refused), and writes through symlinks are refused.

## Context audit

`auditContext(root)` (from `packages/core`) reports: instruction files over ~1500 tokens, paragraphs duplicated across instructions and skills, framework detail in always-on files, skills over ~2500 tokens, and stale repo memory — with an estimated removable token count (`chars / 4`). A CLI command (`dev-agent context audit`) is planned with the v0.9 CLI work.

## Not in v0.6

Task sources, the task ledger and Git branch preparation (v0.7); backend skills (v0.8); fullstack contract and the `dev-agent` CLI alias (v0.9).
```

- [ ] **Step 2: Add a README section**

Append to `README.md` (after the existing CLI documentation, before any "Development" section if present):

```markdown
## v0.6 — shared engineering core

Seven provider-neutral skills (`engineering-architecture`, `repository-investigation`, `verification`, `root-cause-analysis`, `surgical-diff`, `context-efficiency`, `repo-memory`) now ship with the frontend skills, and `packages/core` provides deterministic project inspection, repo-memory freshness and a context audit. Frontend behavior and the `frontend-agent` CLI are unchanged. See `docs/context-efficiency.md` and `docs/superpowers/specs/2026-09-24-dev-agent-kit-evolution.md`.
```

- [ ] **Step 3: Bump versions**

Run:

```bash
sed -i 's/"version": "0.5.1"/"version": "0.6.0"/' packages/cli/package.json packages/evals/package.json packages/core/package.json
sed -i "s/'0\.5\.1'/'0.6.0'/" packages/cli/tests/util.test.ts packages/cli/tests/cli.test.ts
npm install --package-lock-only
```

Expected: `git diff --stat` touches only version strings and `package-lock.json`.

- [ ] **Step 4: Run everything**

Run: `npm test && npm run validate:skills && npm run evals:validate && npm run typecheck --workspaces --if-present`
Expected: all green; `ok: 18 scenarios` (unchanged); core, cli, evals, mcp-server suites pass.

- [ ] **Step 5: Commit, tag, push**

```bash
git add -A
git commit -m "chore: release v0.6.0 — shared engineering core"
git tag -a v0.6.0 -m "v0.6.0 — shared engineering core (real benchmark intentionally skipped)"
git push origin main --tags
```

---

## Self-Review (spec coverage)

§38 v0.6 checklist:

| Item | Task |
|---|---|
| packages/core foundation | 1–4 |
| engineering-architecture, repository-investigation, verification, root-cause-analysis, surgical-diff, context-efficiency, repo-memory skills | 5 |
| short generalized managed instructions | 6 |
| existing 18 evals unchanged and green | 6 (evals suite), 7 (`evals:validate` = 18) |

Other v0.6 requirements: `sourceSha`/`updatedAt` on knowledge (Task 3); revalidate on HEAD change via Git delta (Task 3 `checkFreshness`, Task 5 `repo-memory` skill); §26 project inspector (Task 2); §6.3 context audit logic (Task 4; CLI exposure deferred to v0.9 per §25); §27 always-on instructions kept short with no task-source products (Task 6 test); §6.2 no competing orchestrators (none added); §43 compatibility (no scenario, CLI command, MCP tool or config file touched).

Placeholder scan: none. Type consistency: `ProjectProfile` (Task 2), `KnowledgeDoc`/`Freshness` (Task 3) and `ContextFinding` (Task 4) are defined once and used with the same field names downstream. `headSha` returns 12 chars everywhere; `SHA_RE` accepts 7–40.

Known gaps accepted: no real-host benchmark for the new instructions (user decision); `task-state.ts` and mutating Git helpers are v0.7 (spec §37 order puts them after the profile detector and repo-memory).

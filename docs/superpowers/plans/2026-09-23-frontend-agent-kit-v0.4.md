# Frontend Agent Kit v0.4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `packages/cli` — the `frontend-agent` installer with a `HostAdapter` per host. Real `ClaudeCodeAdapter` and `CodexAdapter`, `CursorAdapter`/`VsCodeAdapter` as stubs. It installs the kit's skills, host instructions and MCP servers into a target project, and it verifies the installation, including a live start of the kit's MCP server.

**Architecture:** Everything is file-based and project-scoped. The CLI never shells out to `claude`/`codex` and never writes outside the target project. Skills sync `skills/` → `<project>/.claude/skills` and `<project>/.agents/skills`, and a manifest of content hashes means the sync never overwrites local edits or touches unmanaged skills. Host instructions go into `CLAUDE.md`/`AGENTS.md` inside a marked block. MCP servers are registered in `<project>/.mcp.json` (Claude Code project scope) and `<project>/.codex/config.toml` (Codex project config; Codex only loads it for trusted projects). `verify` checks the files, then launches the configured MCP server over stdio and lists its tools.

**Tech Stack:** TypeScript (ESM, NodeNext), Node's `util.parseArgs`, `@modelcontextprotocol/sdk` (client, for verify), `smol-toml`, `tsx` (runtime for the bin), Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-23-frontend-agent-kit-design.md` (§6 CLI installer + Host Adapters, §2 layout, §9 Segurança, §10 v0.4 roadmap line)

## Global Constraints

- New workspace package `packages/cli` (`@frontend-agent-kit/cli`, version `0.4.0`), TypeScript ESM with the same `tsconfig.json` settings as `packages/mcp-server`. Imports between `src/` files use `.js`; tests import `src/` files with `.ts`.
- Spec §6 `HostAdapter` shape: `detect()`, `installSkills(sourceDir)`, `installMcp(config: McpConfig)`, `verify(): VerificationResult`. Real adapters: `ClaudeCodeAdapter`, `CodexAdapter`. `CursorAdapter`/`VsCodeAdapter` exist as stubs with no installation logic.
- Spec §6: command `frontend-agent install` (auto-detects hosts) or `frontend-agent install claude|codex|--all`. Skills sync `skills/` → `.claude/skills/` and `.agents/skills/` and **never deletes skills not managed by the kit** (tracked by a manifest).
- The CLI never executes shell commands or host CLIs (spec §9 spirit). It writes only inside the target project root. It reads `$CODEX_HOME/config.toml` (default `~/.codex/config.toml`) read-only, during `verify`.
- User content is never lost: files outside the manifest, text outside the managed markers, and other MCP servers in `.mcp.json`/`.codex/config.toml` are preserved. A config file that fails to parse is a hard error naming the file, and nothing is written.
- CLI output goes to stdout; errors go to stderr with exit code 1. `verify` exits 0 only when every check passes.
- Out of scope: publishing to npm / `npx frontend-agent-kit` from the registry (v1.0), eval suite (v0.5), real Cursor/VS Code logic, writing Codex trust settings (a security decision left to the user).

## Controller rulings baked into this plan

- **Return values vs spec sketch:** the spec sketches `installSkills`/`installMcp` as `Promise<void>`. Here they return reports (`SyncReport`, `string[]` of actions) so the CLI can print what changed. `installInstructions()` is added to the interface, because host instruction files are part of installing and the spec's manual v0.1 flow copies them.
- **MCP registration scope:** project scope for both hosts: `.mcp.json` and `.codex/config.toml`. Global configs stay untouched. `FRONTEND_AGENT_PROJECT_ROOT` is set to the target project, so the v0.2 cwd pitfall disappears.
- **Figma MCP:** registered by default (`--no-figma` opts out), only if no `figma` entry already exists.
- **Local edits win:** a managed file whose content differs from the hash recorded at install time is reported and left alone. `--force` overrides.
- **Installing into the kit checkout itself is refused.** It would duplicate the kit's own instructions into its root files.

## Review Focus

1. Re-running `install` after the user edited an installed skill file → the edit is kept and reported; untouched files update. (Task 2 tests.)
2. An existing `CLAUDE.md`/`AGENTS.md` with the user's own content → content kept; a re-run replaces only the managed block, in place. (Task 3 tests.)
3. An existing `.mcp.json`/`.codex/config.toml` with other servers or comments → preserved; an unparseable file → clear error, file untouched. (Tasks 5 and 6 tests.)
4. Codex project not trusted → `verify` fails with an actionable message rather than reporting ok. (Task 6 test.)
5. `install` with no host argument on a machine where no host is detected, or `--project` pointing at a missing directory → clear error, exit 1. (Task 7 tests.)

---

### Task 1: CLI package scaffolding and shared utilities

**Files:**
- Create: `packages/cli/package.json`, `packages/cli/tsconfig.json`
- Create: `packages/cli/src/types.ts`, `packages/cli/src/util.ts`
- Create: `packages/cli/tests/util.test.ts`

**Interfaces:**
- Produces (`src/types.ts`): `type HostName = 'claude' | 'codex' | 'cursor' | 'vscode'`; `interface McpConfig { kitRoot: string; projectRoot: string; includeFigma: boolean }`; `interface CheckResult { name: string; ok: boolean; detail: string }`; `interface VerificationResult { host: HostName; ok: boolean; checks: CheckResult[] }`; `interface AdapterContext { projectRoot: string; kitRoot: string; kitVersion: string; env: NodeJS.ProcessEnv; homeDir: string; force: boolean }`.
- Produces (`src/util.ts`): `findKitRoot(fromDir?: string): string`, `readKitVersion(): string`, `which(command: string, env: NodeJS.ProcessEnv): string | null`, `sha256File(filePath: string): string`, `listFilesRecursive(dir: string): string[]`.

- [ ] **Step 1: Create the package files**

`packages/cli/package.json`:
```json
{
  "name": "@frontend-agent-kit/cli",
  "version": "0.4.0",
  "private": true,
  "type": "module",
  "bin": {
    "frontend-agent": "bin/frontend-agent.mjs",
    "frontend-agent-kit": "bin/frontend-agent.mjs"
  },
  "scripts": {
    "test": "node --import tsx --test tests/*.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "tsx": "^4.19.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0"
  }
}
```

`packages/cli/tsconfig.json`:
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

Then run from the worktree root: `npm install` (registers the new workspace; the lockfile updates).

- [ ] **Step 2: Write `src/types.ts`**

```ts
export type HostName = 'claude' | 'codex' | 'cursor' | 'vscode';

export interface McpConfig {
  kitRoot: string;
  projectRoot: string;
  includeFigma: boolean;
}

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface VerificationResult {
  host: HostName;
  ok: boolean;
  checks: CheckResult[];
}

export interface AdapterContext {
  projectRoot: string;
  kitRoot: string;
  kitVersion: string;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  force: boolean;
}
```

- [ ] **Step 3: Write the failing tests**

`packages/cli/tests/util.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findKitRoot, readKitVersion, which, sha256File, listFilesRecursive } from '../src/util.ts';

test('findKitRoot walks up to the directory holding the kit package.json and skills/', () => {
  const root = findKitRoot();
  assert.ok(existsSync(join(root, 'skills', 'figma-to-code', 'SKILL.md')));
  assert.ok(existsSync(join(root, 'packages', 'mcp-server', 'src', 'index.ts')));
});

test('readKitVersion returns the cli package version', () => {
  assert.equal(readKitVersion(), '0.4.0');
});

test('which finds an executable on PATH and ignores non-executable files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontend-agent-which-'));
  try {
    writeFileSync(join(dir, 'fakehost'), '#!/bin/sh\n');
    chmodSync(join(dir, 'fakehost'), 0o755);
    writeFileSync(join(dir, 'notexec'), 'x');
    chmodSync(join(dir, 'notexec'), 0o644);
    mkdirSync(join(dir, 'adir'));
    assert.equal(which('fakehost', { PATH: dir }), join(dir, 'fakehost'));
    assert.equal(which('notexec', { PATH: dir }), null);
    assert.equal(which('adir', { PATH: dir }), null);
    assert.equal(which('fakehost', { PATH: '' }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sha256File hashes file bytes and listFilesRecursive returns sorted posix relative paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontend-agent-files-'));
  try {
    writeFileSync(join(dir, 'b.md'), 'abc');
    mkdirSync(join(dir, 'references'));
    writeFileSync(join(dir, 'references', 'a.md'), 'x');
    writeFileSync(join(dir, 'A.md'), 'y');
    assert.equal(sha256File(join(dir, 'b.md')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.deepEqual(listFilesRecursive(dir), ['A.md', 'b.md', 'references/a.md']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test --workspace=packages/cli`
Expected: FAIL — `Cannot find module '../src/util.ts'`.

- [ ] **Step 5: Implement `src/util.ts`**

```ts
import { accessSync, constants, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Walk up from `fromDir` to the kit checkout: the directory whose package.json is named "frontend-agent-kit" and that holds skills/. */
export function findKitRoot(fromDir: string = HERE): string {
  let current = path.resolve(fromDir);
  for (;;) {
    const pkgPath = path.join(current, 'package.json');
    if (existsSync(pkgPath) && existsSync(path.join(current, 'skills'))) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
      if (pkg.name === 'frontend-agent-kit') return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`frontend-agent: could not find the kit checkout above "${fromDir}".`);
    }
    current = parent;
  }
}

export function readKitVersion(): string {
  const pkg = JSON.parse(readFileSync(path.join(HERE, '..', 'package.json'), 'utf8')) as { version: string };
  return pkg.version;
}

/** Resolve `command` against env.PATH without spawning a shell. Returns the absolute path or null. */
export function which(command: string, env: NodeJS.ProcessEnv): string | null {
  const dirs = (env.PATH ?? '').split(path.delimiter).filter((dir) => dir.length > 0);
  for (const dir of dirs) {
    const candidate = path.join(dir, command);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not present or not executable here — keep looking
    }
  }
  return null;
}

export function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/** All files under `dir`, as sorted relative paths with "/" separators. */
export function listFilesRecursive(dir: string): string[] {
  const files: string[] = [];
  const walk = (current: string, prefix: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(current, entry.name), rel);
      else if (entry.isFile()) files.push(rel);
    }
  };
  walk(dir, '');
  return files.sort();
}
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `npm test --workspace=packages/cli && npm run typecheck --workspace=packages/cli`
Expected: 4 tests passing, no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/cli package-lock.json
git commit -m "Add packages/cli scaffolding with shared types and file utilities"
```

---

### Task 2: Skill sync with a managed manifest

**Files:**
- Create: `packages/cli/src/sync-skills.ts`
- Create: `packages/cli/tests/sync-skills.test.ts`

**Interfaces:**
- Consumes: `sha256File`, `listFilesRecursive` (Task 1).
- Produces: `MANIFEST_FILE = '.frontend-agent-kit-manifest.json'`; `interface SkillsManifest { kitVersion: string; skills: Record<string, Record<string, string>> }` (skill → relative file path → sha256); `interface SyncReport { targetDir: string; added: string[]; updated: string[]; removed: string[]; unchanged: string[]; skipped: Array<{ path: string; reason: string }> }`; `readManifest(targetDir: string): SkillsManifest`; `syncSkills(sourceDir: string, targetDir: string, options: { kitVersion: string; force?: boolean }): SyncReport`. Report paths are `"<skill>/<relative file path>"` (or just `"<skill>"` for a whole-skill skip).

- [ ] **Step 1: Write the failing tests**

`packages/cli/tests/sync-skills.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncSkills, readManifest, MANIFEST_FILE } from '../src/sync-skills.ts';

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'frontend-agent-sync-'));
  const source = join(base, 'skills');
  const target = join(base, 'project', '.claude', 'skills');
  mkdirSync(join(source, 'alpha', 'references'), { recursive: true });
  writeFileSync(join(source, 'alpha', 'SKILL.md'), 'alpha v1');
  writeFileSync(join(source, 'alpha', 'references', 'react.md'), 'react v1');
  mkdirSync(join(source, 'beta'));
  writeFileSync(join(source, 'beta', 'SKILL.md'), 'beta v1');
  mkdirSync(join(source, 'not-a-skill'));
  writeFileSync(join(source, 'not-a-skill', 'README.md'), 'no SKILL.md here');
  return { base, source, target, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test('a fresh sync copies every skill (dirs with SKILL.md only) and writes the manifest', () => {
  const { source, target, cleanup } = setup();
  try {
    const report = syncSkills(source, target, { kitVersion: '0.4.0' });
    assert.deepEqual(report.added.sort(), ['alpha/SKILL.md', 'alpha/references/react.md', 'beta/SKILL.md']);
    assert.equal(readFileSync(join(target, 'alpha', 'references', 'react.md'), 'utf8'), 'react v1');
    assert.equal(existsSync(join(target, 'not-a-skill')), false);
    const manifest = readManifest(target);
    assert.equal(manifest.kitVersion, '0.4.0');
    assert.deepEqual(Object.keys(manifest.skills).sort(), ['alpha', 'beta']);
    assert.ok(existsSync(join(target, MANIFEST_FILE)));
  } finally {
    cleanup();
  }
});

test('a second sync with no changes reports everything unchanged', () => {
  const { source, target, cleanup } = setup();
  try {
    syncSkills(source, target, { kitVersion: '0.4.0' });
    const report = syncSkills(source, target, { kitVersion: '0.4.0' });
    assert.deepEqual(report.added, []);
    assert.deepEqual(report.updated, []);
    assert.deepEqual(report.skipped, []);
    assert.equal(report.unchanged.length, 3);
  } finally {
    cleanup();
  }
});

test('a changed source file updates an installed file the user did not touch', () => {
  const { source, target, cleanup } = setup();
  try {
    syncSkills(source, target, { kitVersion: '0.4.0' });
    writeFileSync(join(source, 'alpha', 'SKILL.md'), 'alpha v2');
    const report = syncSkills(source, target, { kitVersion: '0.4.1' });
    assert.deepEqual(report.updated, ['alpha/SKILL.md']);
    assert.equal(readFileSync(join(target, 'alpha', 'SKILL.md'), 'utf8'), 'alpha v2');
    assert.equal(readManifest(target).kitVersion, '0.4.1');
  } finally {
    cleanup();
  }
});

test('a locally edited installed file is kept and reported, and --force overwrites it', () => {
  const { source, target, cleanup } = setup();
  try {
    syncSkills(source, target, { kitVersion: '0.4.0' });
    writeFileSync(join(target, 'alpha', 'SKILL.md'), 'my local edit');
    writeFileSync(join(source, 'alpha', 'SKILL.md'), 'alpha v2');
    const report = syncSkills(source, target, { kitVersion: '0.4.0' });
    assert.deepEqual(report.skipped, [{ path: 'alpha/SKILL.md', reason: 'modified locally since the last install' }]);
    assert.equal(readFileSync(join(target, 'alpha', 'SKILL.md'), 'utf8'), 'my local edit');
    const again = syncSkills(source, target, { kitVersion: '0.4.0' });
    assert.equal(again.skipped.length, 1, 'the edit is still detected on the next run');
    const forced = syncSkills(source, target, { kitVersion: '0.4.0', force: true });
    assert.deepEqual(forced.updated, ['alpha/SKILL.md']);
    assert.equal(readFileSync(join(target, 'alpha', 'SKILL.md'), 'utf8'), 'alpha v2');
  } finally {
    cleanup();
  }
});

test('an unmanaged skill dir with the same name is skipped whole, and unrelated user skills are never touched', () => {
  const { source, target, cleanup } = setup();
  try {
    mkdirSync(join(target, 'beta'), { recursive: true });
    writeFileSync(join(target, 'beta', 'SKILL.md'), "the user's own beta");
    mkdirSync(join(target, 'my-skill'));
    writeFileSync(join(target, 'my-skill', 'SKILL.md'), 'mine');
    const report = syncSkills(source, target, { kitVersion: '0.4.0' });
    assert.deepEqual(report.skipped, [{ path: 'beta', reason: 'exists and is not managed by frontend-agent-kit' }]);
    assert.equal(readFileSync(join(target, 'beta', 'SKILL.md'), 'utf8'), "the user's own beta");
    assert.equal(readFileSync(join(target, 'my-skill', 'SKILL.md'), 'utf8'), 'mine');
    assert.deepEqual(Object.keys(readManifest(target).skills), ['alpha']);
  } finally {
    cleanup();
  }
});

test('files and skills removed from the source are removed from the target when unmodified', () => {
  const { source, target, cleanup } = setup();
  try {
    syncSkills(source, target, { kitVersion: '0.4.0' });
    rmSync(join(source, 'alpha', 'references'), { recursive: true });
    rmSync(join(source, 'beta'), { recursive: true });
    const report = syncSkills(source, target, { kitVersion: '0.4.0' });
    assert.deepEqual(report.removed.sort(), ['alpha/references/react.md', 'beta/SKILL.md']);
    assert.equal(existsSync(join(target, 'alpha', 'references')), false);
    assert.equal(existsSync(join(target, 'beta')), false);
    assert.deepEqual(Object.keys(readManifest(target).skills), ['alpha']);
  } finally {
    cleanup();
  }
});

test('an unreadable manifest is an error naming the file', () => {
  const { source, target, cleanup } = setup();
  try {
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, MANIFEST_FILE), '{ not json');
    assert.throws(() => syncSkills(source, target, { kitVersion: '0.4.0' }), /\.frontend-agent-kit-manifest\.json/);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=packages/cli`
Expected: FAIL — `Cannot find module '../src/sync-skills.ts'`.

- [ ] **Step 3: Implement `src/sync-skills.ts`**

```ts
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listFilesRecursive, sha256File } from './util.js';

export const MANIFEST_FILE = '.frontend-agent-kit-manifest.json';

export interface SkillsManifest {
  kitVersion: string;
  skills: Record<string, Record<string, string>>;
}

export interface SyncReport {
  targetDir: string;
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: string[];
  skipped: Array<{ path: string; reason: string }>;
}

export function readManifest(targetDir: string): SkillsManifest {
  const manifestPath = path.join(targetDir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) return { kitVersion: '', skills: {} };
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as SkillsManifest;
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.skills !== 'object' || parsed.skills === null) {
      throw new Error('missing "skills" object');
    }
    return parsed;
  } catch (error) {
    throw new Error(`frontend-agent: cannot read ${manifestPath}: ${(error as Error).message}`);
  }
}

function listSourceSkills(sourceDir: string): string[] {
  return readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(sourceDir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

/** Remove empty directories under `dir` (bottom-up), and `dir` itself when it ends up empty. */
function pruneEmptyDirs(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) pruneEmptyDirs(path.join(dir, entry.name));
  }
  if (readdirSync(dir).length === 0) rmdirSync(dir);
}

export function syncSkills(
  sourceDir: string,
  targetDir: string,
  options: { kitVersion: string; force?: boolean }
): SyncReport {
  const force = options.force ?? false;
  const report: SyncReport = { targetDir, added: [], updated: [], removed: [], unchanged: [], skipped: [] };
  mkdirSync(targetDir, { recursive: true });
  const manifest = readManifest(targetDir);
  const nextManifest: SkillsManifest = { kitVersion: options.kitVersion, skills: {} };

  const removeIfUnchanged = (key: string, filePath: string, recordedHash: string) => {
    if (!existsSync(filePath)) return;
    if (force || sha256File(filePath) === recordedHash) {
      rmSync(filePath);
      report.removed.push(key);
    } else {
      report.skipped.push({ path: key, reason: 'modified locally; left in place and no longer managed' });
    }
  };

  const sourceSkills = listSourceSkills(sourceDir);
  for (const skill of sourceSkills) {
    const managed = manifest.skills[skill];
    const targetSkillDir = path.join(targetDir, skill);
    if (!managed && existsSync(targetSkillDir) && !force) {
      report.skipped.push({ path: skill, reason: 'exists and is not managed by frontend-agent-kit' });
      continue;
    }

    const entry: Record<string, string> = {};
    const sourceFiles = listFilesRecursive(path.join(sourceDir, skill));
    for (const rel of sourceFiles) {
      const key = `${skill}/${rel}`;
      const src = path.join(sourceDir, skill, rel);
      const dst = path.join(targetSkillDir, rel);
      const srcHash = sha256File(src);

      if (!existsSync(dst)) {
        mkdirSync(path.dirname(dst), { recursive: true });
        copyFileSync(src, dst);
        report.added.push(key);
        entry[rel] = srcHash;
        continue;
      }
      const dstHash = sha256File(dst);
      if (dstHash === srcHash) {
        report.unchanged.push(key);
        entry[rel] = srcHash;
        continue;
      }
      const recorded = managed?.[rel];
      if (force || (recorded !== undefined && recorded === dstHash)) {
        copyFileSync(src, dst);
        report.updated.push(key);
        entry[rel] = srcHash;
      } else {
        report.skipped.push({ path: key, reason: 'modified locally since the last install' });
        if (recorded !== undefined) entry[rel] = recorded;
      }
    }

    for (const [rel, recordedHash] of Object.entries(managed ?? {})) {
      if (!sourceFiles.includes(rel)) removeIfUnchanged(`${skill}/${rel}`, path.join(targetSkillDir, rel), recordedHash);
    }
    if (existsSync(targetSkillDir)) {
      for (const child of readdirSync(targetSkillDir, { withFileTypes: true })) {
        if (child.isDirectory()) pruneEmptyDirs(path.join(targetSkillDir, child.name));
      }
    }
    nextManifest.skills[skill] = entry;
  }

  for (const [skill, files] of Object.entries(manifest.skills)) {
    if (sourceSkills.includes(skill)) continue;
    const targetSkillDir = path.join(targetDir, skill);
    for (const [rel, recordedHash] of Object.entries(files)) {
      removeIfUnchanged(`${skill}/${rel}`, path.join(targetSkillDir, rel), recordedHash);
    }
    pruneEmptyDirs(targetSkillDir);
  }

  writeFileSync(path.join(targetDir, MANIFEST_FILE), `${JSON.stringify(nextManifest, null, 2)}\n`);
  return report;
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm test --workspace=packages/cli && npm run typecheck --workspace=packages/cli`
Expected: 11 tests passing (4 + 7), no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/sync-skills.ts packages/cli/tests/sync-skills.test.ts
git commit -m "Add manifest-tracked skill sync that never overwrites local edits or unmanaged skills"
```

---

### Task 3: Managed instruction blocks in CLAUDE.md / AGENTS.md

**Files:**
- Create: `packages/cli/src/managed-block.ts`
- Create: `packages/cli/tests/managed-block.test.ts`

**Interfaces:**
- Produces: `BLOCK_START = '<!-- frontend-agent-kit:start -->'`, `BLOCK_END = '<!-- frontend-agent-kit:end -->'`, `type BlockAction = 'created' | 'appended' | 'replaced' | 'unchanged'`, `upsertMarkdownBlock(filePath: string, content: string): BlockAction`, `hasMarkdownBlock(filePath: string): boolean`, and the generic `findManagedBlock(text: string, start: string, end: string, fileLabel: string): { from: number; to: number } | null` (reused by Task 6 for TOML).

- [ ] **Step 1: Write the failing tests**

`packages/cli/tests/managed-block.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertMarkdownBlock, hasMarkdownBlock, BLOCK_START, BLOCK_END } from '../src/managed-block.ts';

function withDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'frontend-agent-block-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('creates the file with only the managed block when it does not exist', () => {
  withDir((dir) => {
    const file = join(dir, 'CLAUDE.md');
    assert.equal(upsertMarkdownBlock(file, '# Kit\n\nDo things.\n'), 'created');
    assert.equal(readFileSync(file, 'utf8'), `${BLOCK_START}\n# Kit\n\nDo things.\n${BLOCK_END}\n`);
    assert.equal(hasMarkdownBlock(file), true);
  });
});

test("appends the block after the user's existing content, keeping it intact", () => {
  withDir((dir) => {
    const file = join(dir, 'AGENTS.md');
    writeFileSync(file, '# My project\n\nUse pnpm.\n\n\n');
    assert.equal(upsertMarkdownBlock(file, 'kit rules'), 'appended');
    assert.equal(readFileSync(file, 'utf8'), `# My project\n\nUse pnpm.\n\n${BLOCK_START}\nkit rules\n${BLOCK_END}\n`);
  });
});

test('replaces only the block in place on re-run, and reports unchanged when identical', () => {
  withDir((dir) => {
    const file = join(dir, 'CLAUDE.md');
    writeFileSync(file, `intro\n\n${BLOCK_START}\nold rules\n${BLOCK_END}\n\noutro\n`);
    assert.equal(upsertMarkdownBlock(file, 'new rules'), 'replaced');
    assert.equal(readFileSync(file, 'utf8'), `intro\n\n${BLOCK_START}\nnew rules\n${BLOCK_END}\n\noutro\n`);
    assert.equal(upsertMarkdownBlock(file, 'new rules'), 'unchanged');
  });
});

test('a lone or reversed marker is an error naming the file, and the file is left untouched', () => {
  withDir((dir) => {
    const file = join(dir, 'CLAUDE.md');
    const broken = `intro\n${BLOCK_START}\nno end marker\n`;
    writeFileSync(file, broken);
    assert.throws(() => upsertMarkdownBlock(file, 'x'), /CLAUDE\.md.*frontend-agent-kit markers/s);
    assert.equal(readFileSync(file, 'utf8'), broken);
    writeFileSync(file, `${BLOCK_END}\n${BLOCK_START}\n`);
    assert.throws(() => upsertMarkdownBlock(file, 'x'), /frontend-agent-kit markers/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=packages/cli`
Expected: FAIL — `Cannot find module '../src/managed-block.ts'`.

- [ ] **Step 3: Implement `src/managed-block.ts`**

```ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const BLOCK_START = '<!-- frontend-agent-kit:start -->';
export const BLOCK_END = '<!-- frontend-agent-kit:end -->';

export type BlockAction = 'created' | 'appended' | 'replaced' | 'unchanged';

/**
 * Locate a managed block delimited by `start`/`end` lines. Returns the span from
 * the start marker through the end marker's trailing newline, or null when neither
 * marker is present. Throws when only one marker is present or they are reversed.
 */
export function findManagedBlock(
  text: string,
  start: string,
  end: string,
  fileLabel: string
): { from: number; to: number } | null {
  const from = text.indexOf(start);
  const endIndex = text.indexOf(end);
  if (from === -1 && endIndex === -1) return null;
  if (from === -1 || endIndex === -1 || endIndex < from) {
    throw new Error(
      `frontend-agent: ${fileLabel} has unbalanced frontend-agent-kit markers ("${start}" / "${end}"); fix or remove them and re-run.`
    );
  }
  let to = endIndex + end.length;
  if (text[to] === '\n') to += 1;
  return { from, to };
}

export function upsertMarkdownBlock(filePath: string, content: string): BlockAction {
  const block = `${BLOCK_START}\n${content.trim()}\n${BLOCK_END}\n`;
  if (!existsSync(filePath)) {
    writeFileSync(filePath, block);
    return 'created';
  }
  const text = readFileSync(filePath, 'utf8');
  const span = findManagedBlock(text, BLOCK_START, BLOCK_END, filePath);
  if (span) {
    const next = text.slice(0, span.from) + block + text.slice(span.to);
    if (next === text) return 'unchanged';
    writeFileSync(filePath, next);
    return 'replaced';
  }
  const head = text.trimEnd();
  writeFileSync(filePath, head ? `${head}\n\n${block}` : block);
  return 'appended';
}

export function hasMarkdownBlock(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    return findManagedBlock(readFileSync(filePath, 'utf8'), BLOCK_START, BLOCK_END, filePath) !== null;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm test --workspace=packages/cli && npm run typecheck --workspace=packages/cli`
Expected: 15 tests passing (11 + 4), no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/managed-block.ts packages/cli/tests/managed-block.test.ts
git commit -m "Add managed instruction blocks that preserve user content in CLAUDE.md/AGENTS.md"
```

---

### Task 4: MCP launch spec and shared verification checks

**Files:**
- Create: `packages/cli/src/mcp-launch.ts`
- Create: `packages/cli/src/checks.ts`
- Create: `packages/cli/tests/checks.test.ts`

**Interfaces:**
- Consumes: `McpConfig`, `CheckResult` (Task 1); `readManifest` (Task 2); `hasMarkdownBlock` (Task 3); `findKitRoot` (Task 1, in tests).
- Produces (`src/mcp-launch.ts`): `SERVER_NAME = 'frontend-agent'`, `FIGMA_MCP_URL = 'https://mcp.figma.com/mcp'`, `interface ServerLaunch { command: string; args: string[]; env: Record<string, string> }`, `kitServerLaunch(config: McpConfig): ServerLaunch`.
- Produces (`src/checks.ts`): `EXPECTED_TOOLS: string[]`, `checkSkills(skillsDir: string): CheckResult`, `checkInstructions(filePath: string): CheckResult`, `checkLaunchConfig(launch: ServerLaunch | null, projectRoot: string, sourceLabel: string): CheckResult`, `probeServer(launch: ServerLaunch, timeoutMs?: number): Promise<CheckResult>`.

- [ ] **Step 1: Implement `src/mcp-launch.ts`** (pure data; exercised by the tests in Step 2)

```ts
import path from 'node:path';
import type { McpConfig } from './types.js';

export const SERVER_NAME = 'frontend-agent';
export const FIGMA_MCP_URL = 'https://mcp.figma.com/mcp';

export interface ServerLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** How a host should start the kit's MCP server for `config.projectRoot` (absolute paths into the kit checkout). */
export function kitServerLaunch(config: McpConfig): ServerLaunch {
  return {
    command: path.join(config.kitRoot, 'node_modules', '.bin', 'tsx'),
    args: [path.join(config.kitRoot, 'packages', 'mcp-server', 'src', 'index.ts')],
    env: { FRONTEND_AGENT_PROJECT_ROOT: config.projectRoot }
  };
}
```

- [ ] **Step 2: Write the failing tests**

`packages/cli/tests/checks.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSkills, checkInstructions, checkLaunchConfig, probeServer, EXPECTED_TOOLS } from '../src/checks.ts';
import { kitServerLaunch } from '../src/mcp-launch.ts';
import { syncSkills } from '../src/sync-skills.ts';
import { upsertMarkdownBlock } from '../src/managed-block.ts';
import { findKitRoot } from '../src/util.ts';

function withDir(fn: (dir: string) => Promise<void> | void) {
  const dir = mkdtempSync(join(tmpdir(), 'frontend-agent-checks-'));
  return Promise.resolve(fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test('checkSkills passes after a sync and fails when a managed file goes missing or nothing is installed', async () => {
  await withDir((dir) => {
    const kitRoot = findKitRoot();
    const target = join(dir, '.claude', 'skills');
    assert.equal(checkSkills(target).ok, false);
    syncSkills(join(kitRoot, 'skills'), target, { kitVersion: '0.4.0' });
    const ok = checkSkills(target);
    assert.equal(ok.ok, true, ok.detail);
    rmSync(join(target, 'figma-to-code', 'SKILL.md'));
    const missing = checkSkills(target);
    assert.equal(missing.ok, false);
    assert.match(missing.detail, /figma-to-code\/SKILL\.md/);
  });
});

test('checkInstructions requires the managed block', async () => {
  await withDir((dir) => {
    const file = join(dir, 'CLAUDE.md');
    assert.equal(checkInstructions(file).ok, false);
    upsertMarkdownBlock(file, 'rules');
    assert.equal(checkInstructions(file).ok, true);
  });
});

test('checkLaunchConfig verifies the entry exists, its command exists and it points at this project', async () => {
  await withDir((dir) => {
    const launch = kitServerLaunch({ kitRoot: findKitRoot(), projectRoot: dir, includeFigma: false });
    assert.equal(checkLaunchConfig(launch, dir, '.mcp.json').ok, true);
    assert.equal(checkLaunchConfig(null, dir, '.mcp.json').ok, false);
    assert.match(checkLaunchConfig({ ...launch, command: '/nonexistent/tsx' }, dir, '.mcp.json').detail, /does not exist/);
    assert.match(checkLaunchConfig({ ...launch, env: { FRONTEND_AGENT_PROJECT_ROOT: '/elsewhere' } }, dir, '.mcp.json').detail, /FRONTEND_AGENT_PROJECT_ROOT/);
  });
});

test('probeServer starts the real kit MCP server and sees all five tools', async () => {
  await withDir(async (dir) => {
    mkdirSync(join(dir, '.frontend-agent'));
    writeFileSync(join(dir, '.frontend-agent', 'config.yml'), 'validationProfile: standard\n');
    const result = await probeServer(kitServerLaunch({ kitRoot: findKitRoot(), projectRoot: dir, includeFigma: false }));
    assert.equal(result.ok, true, result.detail);
    for (const tool of EXPECTED_TOOLS) assert.match(result.detail, new RegExp(tool));
  });
});

test('probeServer reports a command that cannot start, and times out on a server that never answers', async () => {
  const missing = await probeServer({ command: '/nonexistent/binary', args: [], env: {} });
  assert.equal(missing.ok, false);
  assert.match(missing.detail, /could not start/);
  const silent = await probeServer({ command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], env: {} }, 1000);
  assert.equal(silent.ok, false);
  assert.match(silent.detail, /timed out/);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test --workspace=packages/cli`
Expected: FAIL — `Cannot find module '../src/checks.ts'`.

- [ ] **Step 4: Implement `src/checks.ts`**

```ts
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CheckResult } from './types.js';
import type { ServerLaunch } from './mcp-launch.js';
import { MANIFEST_FILE, readManifest } from './sync-skills.js';
import { hasMarkdownBlock } from './managed-block.js';

export const EXPECTED_TOOLS = [
  'capture_screenshot',
  'compare_screenshots',
  'inspect_dom',
  'run_accessibility_audit',
  'run_responsive_suite'
];

export function checkSkills(skillsDir: string): CheckResult {
  if (!existsSync(path.join(skillsDir, MANIFEST_FILE))) {
    return { name: 'skills', ok: false, detail: `no ${MANIFEST_FILE} in ${skillsDir} — run install` };
  }
  let manifest;
  try {
    manifest = readManifest(skillsDir);
  } catch (error) {
    return { name: 'skills', ok: false, detail: (error as Error).message };
  }
  const missing: string[] = [];
  let count = 0;
  for (const [skill, files] of Object.entries(manifest.skills)) {
    for (const rel of Object.keys(files)) {
      count += 1;
      if (!existsSync(path.join(skillsDir, skill, rel))) missing.push(`${skill}/${rel}`);
    }
  }
  if (missing.length > 0) {
    return { name: 'skills', ok: false, detail: `missing managed files: ${missing.join(', ')}` };
  }
  return {
    name: 'skills',
    ok: true,
    detail: `${Object.keys(manifest.skills).length} skills, ${count} files (kit ${manifest.kitVersion}) in ${skillsDir}`
  };
}

export function checkInstructions(filePath: string): CheckResult {
  const ok = hasMarkdownBlock(filePath);
  return {
    name: 'instructions',
    ok,
    detail: ok ? `frontend-agent-kit block present in ${filePath}` : `no frontend-agent-kit block in ${filePath} — run install`
  };
}

export function checkLaunchConfig(launch: ServerLaunch | null, projectRoot: string, sourceLabel: string): CheckResult {
  const name = 'mcp-config';
  if (!launch) return { name, ok: false, detail: `no "frontend-agent" server in ${sourceLabel} — run install` };
  if (!existsSync(launch.command)) {
    return { name, ok: false, detail: `server command ${launch.command} does not exist — run npm install in the kit checkout` };
  }
  const script = launch.args[0];
  if (!script || !existsSync(script)) {
    return { name, ok: false, detail: `server entry ${script ?? '(none)'} does not exist` };
  }
  if (launch.env.FRONTEND_AGENT_PROJECT_ROOT !== projectRoot) {
    return {
      name,
      ok: false,
      detail: `FRONTEND_AGENT_PROJECT_ROOT is "${launch.env.FRONTEND_AGENT_PROJECT_ROOT ?? ''}", expected "${projectRoot}" — re-run install`
    };
  }
  return { name, ok: true, detail: `${sourceLabel} starts ${script} for ${projectRoot}` };
}

export async function probeServer(launch: ServerLaunch, timeoutMs = 20000): Promise<CheckResult> {
  const name = 'mcp-server';
  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    env: { ...getDefaultEnvironment(), ...launch.env },
    stderr: 'pipe'
  });
  const client = new Client({ name: 'frontend-agent-verify', version: '0.4.0' });
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
    });
    const listed = await Promise.race([
      (async () => {
        await client.connect(transport);
        return client.listTools();
      })(),
      timeout
    ]);
    const names = listed.tools.map((tool) => tool.name).sort();
    const missing = EXPECTED_TOOLS.filter((tool) => !names.includes(tool));
    if (missing.length > 0) return { name, ok: false, detail: `server started but is missing tools: ${missing.join(', ')}` };
    return { name, ok: true, detail: `server started; tools: ${names.join(', ')}` };
  } catch (error) {
    const message = (error as Error).message;
    return {
      name,
      ok: false,
      detail: message.startsWith('timed out') ? `server ${message}` : `could not start the MCP server: ${message}`
    };
  } finally {
    if (timer) clearTimeout(timer);
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test --workspace=packages/cli && npm run typecheck --workspace=packages/cli`
Expected: 20 tests passing (15 + 5), no type errors. After the run, `pgrep -af 'packages/mcp-server/src/index.ts'` must show no leftover server process.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/mcp-launch.ts packages/cli/src/checks.ts packages/cli/tests/checks.test.ts
git commit -m "Add MCP launch spec and verification checks, including a live stdio probe of the kit server"
```

---

### Task 5: `ClaudeCodeAdapter`

**Files:**
- Create: `packages/cli/src/adapters/host-adapter.ts`
- Create: `packages/cli/src/adapters/claude.ts`
- Create: `packages/cli/tests/claude-adapter.test.ts`

**Interfaces:**
- Consumes: `AdapterContext`, `McpConfig`, `VerificationResult`, `HostName` (Task 1); `which` (Task 1); `syncSkills`, `SyncReport` (Task 2); `upsertMarkdownBlock`, `BlockAction` (Task 3); `kitServerLaunch`, `SERVER_NAME`, `FIGMA_MCP_URL`, `ServerLaunch` (Task 4); `checkSkills`, `checkInstructions`, `checkLaunchConfig`, `probeServer` (Task 4).
- Produces (`src/adapters/host-adapter.ts`): `interface HostAdapter { readonly name: HostName; readonly supported: boolean; detect(): Promise<boolean>; installSkills(sourceDir: string): Promise<SyncReport>; installInstructions(): Promise<BlockAction>; installMcp(config: McpConfig): Promise<string[]>; verify(): Promise<VerificationResult>; notes(): string[] }`.
- Produces (`src/adapters/claude.ts`): `class ClaudeCodeAdapter implements HostAdapter` with `constructor(ctx: AdapterContext)`, plus read-only `skillsDir`, `instructionsFile`, `mcpFile` getters.

- [ ] **Step 1: Write `src/adapters/host-adapter.ts`**

```ts
import type { HostName, McpConfig, VerificationResult } from '../types.js';
import type { SyncReport } from '../sync-skills.js';
import type { BlockAction } from '../managed-block.js';

export interface HostAdapter {
  readonly name: HostName;
  readonly supported: boolean;
  detect(): Promise<boolean>;
  installSkills(sourceDir: string): Promise<SyncReport>;
  installInstructions(): Promise<BlockAction>;
  installMcp(config: McpConfig): Promise<string[]>;
  verify(): Promise<VerificationResult>;
  /** Host-specific follow-up the user must know about after install (printed by the CLI). */
  notes(): string[];
}
```

- [ ] **Step 2: Write the failing tests**

`packages/cli/tests/claude-adapter.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCodeAdapter } from '../src/adapters/claude.ts';
import { findKitRoot } from '../src/util.ts';
import type { AdapterContext } from '../src/types.ts';

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'frontend-agent-claude-'));
  const projectRoot = join(base, 'project');
  const homeDir = join(base, 'home');
  mkdirSync(projectRoot);
  mkdirSync(homeDir);
  const kitRoot = findKitRoot();
  const ctx: AdapterContext = { projectRoot, kitRoot, kitVersion: '0.4.0', env: { PATH: '' }, homeDir, force: false };
  return { base, projectRoot, homeDir, kitRoot, ctx, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test('detect is true when claude is on PATH or ~/.claude exists, false otherwise', async () => {
  const { homeDir, ctx, cleanup } = setup();
  try {
    assert.equal(await new ClaudeCodeAdapter(ctx).detect(), false);
    mkdirSync(join(homeDir, '.claude'));
    assert.equal(await new ClaudeCodeAdapter(ctx).detect(), true);
  } finally {
    cleanup();
  }
});

test('installSkills and installInstructions target .claude/skills and CLAUDE.md', async () => {
  const { projectRoot, kitRoot, ctx, cleanup } = setup();
  try {
    const adapter = new ClaudeCodeAdapter(ctx);
    const report = await adapter.installSkills(join(kitRoot, 'skills'));
    assert.ok(report.added.includes('figma-to-code/SKILL.md'));
    assert.ok(existsSync(join(projectRoot, '.claude', 'skills', 'visual-validation', 'SKILL.md')));
    assert.equal(await adapter.installInstructions(), 'created');
    assert.match(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8'), /Figma as the design source of truth/);
  } finally {
    cleanup();
  }
});

test('installMcp merges into an existing .mcp.json, keeping other servers and an existing figma entry', async () => {
  const { projectRoot, kitRoot, ctx, cleanup } = setup();
  try {
    writeFileSync(
      join(projectRoot, '.mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'x' }, figma: { type: 'http', url: 'https://custom' } } })
    );
    const actions = await new ClaudeCodeAdapter(ctx).installMcp({ kitRoot, projectRoot, includeFigma: true });
    const config = JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf8'));
    assert.deepEqual(config.mcpServers.other, { command: 'x' });
    assert.equal(config.mcpServers.figma.url, 'https://custom');
    assert.deepEqual(config.mcpServers['frontend-agent'], {
      type: 'stdio',
      command: join(kitRoot, 'node_modules', '.bin', 'tsx'),
      args: [join(kitRoot, 'packages', 'mcp-server', 'src', 'index.ts')],
      env: { FRONTEND_AGENT_PROJECT_ROOT: projectRoot }
    });
    assert.ok(actions.some((a) => /frontend-agent/.test(a)));
    assert.ok(actions.some((a) => /figma.*kept/.test(a)));
  } finally {
    cleanup();
  }
});

test('installMcp adds figma when missing, and refuses to touch an unparseable .mcp.json', async () => {
  const { projectRoot, kitRoot, ctx, cleanup } = setup();
  try {
    await new ClaudeCodeAdapter(ctx).installMcp({ kitRoot, projectRoot, includeFigma: true });
    const config = JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf8'));
    assert.deepEqual(config.mcpServers.figma, { type: 'http', url: 'https://mcp.figma.com/mcp' });
    writeFileSync(join(projectRoot, '.mcp.json'), '{ broken');
    await assert.rejects(
      () => new ClaudeCodeAdapter(ctx).installMcp({ kitRoot, projectRoot, includeFigma: true }),
      /\.mcp\.json/
    );
    assert.equal(readFileSync(join(projectRoot, '.mcp.json'), 'utf8'), '{ broken');
  } finally {
    cleanup();
  }
});

test('verify passes after a full install (including a live server probe) and fails before it', async () => {
  const { projectRoot, kitRoot, ctx, cleanup } = setup();
  try {
    const adapter = new ClaudeCodeAdapter(ctx);
    const before = await adapter.verify();
    assert.equal(before.ok, false);
    await adapter.installSkills(join(kitRoot, 'skills'));
    await adapter.installInstructions();
    await adapter.installMcp({ kitRoot, projectRoot, includeFigma: true });
    const after = await adapter.verify();
    assert.equal(after.ok, true, JSON.stringify(after.checks, null, 2));
    assert.deepEqual(after.checks.map((c) => c.name), ['skills', 'instructions', 'mcp-config', 'mcp-server']);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test --workspace=packages/cli`
Expected: FAIL — `Cannot find module '../src/adapters/claude.ts'`.

- [ ] **Step 4: Implement `src/adapters/claude.ts`**

```ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HostAdapter } from './host-adapter.js';
import type { AdapterContext, McpConfig, VerificationResult } from '../types.js';
import { which } from '../util.js';
import { syncSkills, type SyncReport } from '../sync-skills.js';
import { upsertMarkdownBlock, type BlockAction } from '../managed-block.js';
import { FIGMA_MCP_URL, SERVER_NAME, kitServerLaunch, type ServerLaunch } from '../mcp-launch.js';
import { checkInstructions, checkLaunchConfig, checkSkills, probeServer } from '../checks.js';

type McpJson = { mcpServers?: Record<string, Record<string, unknown>> } & Record<string, unknown>;

export class ClaudeCodeAdapter implements HostAdapter {
  readonly name = 'claude' as const;
  readonly supported = true;

  constructor(private readonly ctx: AdapterContext) {}

  get skillsDir(): string {
    return path.join(this.ctx.projectRoot, '.claude', 'skills');
  }

  get instructionsFile(): string {
    return path.join(this.ctx.projectRoot, 'CLAUDE.md');
  }

  get mcpFile(): string {
    return path.join(this.ctx.projectRoot, '.mcp.json');
  }

  async detect(): Promise<boolean> {
    return which('claude', this.ctx.env) !== null || existsSync(path.join(this.ctx.homeDir, '.claude'));
  }

  async installSkills(sourceDir: string): Promise<SyncReport> {
    return syncSkills(sourceDir, this.skillsDir, { kitVersion: this.ctx.kitVersion, force: this.ctx.force });
  }

  async installInstructions(): Promise<BlockAction> {
    const content = readFileSync(path.join(this.ctx.kitRoot, 'integrations', 'claude', 'CLAUDE.md'), 'utf8');
    return upsertMarkdownBlock(this.instructionsFile, content);
  }

  private readMcpJson(): McpJson {
    if (!existsSync(this.mcpFile)) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.mcpFile, 'utf8'));
    } catch (error) {
      throw new Error(`frontend-agent: cannot parse ${this.mcpFile}: ${(error as Error).message}`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`frontend-agent: ${this.mcpFile} must contain a JSON object`);
    }
    const json = parsed as McpJson;
    if (json.mcpServers !== undefined && (typeof json.mcpServers !== 'object' || json.mcpServers === null || Array.isArray(json.mcpServers))) {
      throw new Error(`frontend-agent: "mcpServers" in ${this.mcpFile} must be an object`);
    }
    return json;
  }

  async installMcp(config: McpConfig): Promise<string[]> {
    const json = this.readMcpJson();
    const servers = { ...(json.mcpServers ?? {}) };
    const launch = kitServerLaunch(config);
    const actions: string[] = [];

    servers[SERVER_NAME] = { type: 'stdio', command: launch.command, args: launch.args, env: launch.env };
    actions.push(`${SERVER_NAME} MCP server registered in ${this.mcpFile}`);

    if (config.includeFigma) {
      if (servers.figma) {
        actions.push(`figma MCP server already configured in ${this.mcpFile} — kept`);
      } else {
        servers.figma = { type: 'http', url: FIGMA_MCP_URL };
        actions.push(`figma MCP server registered in ${this.mcpFile}`);
      }
    }

    writeFileSync(this.mcpFile, `${JSON.stringify({ ...json, mcpServers: servers }, null, 2)}\n`);
    return actions;
  }

  private configuredLaunch(): ServerLaunch | null {
    let json: McpJson;
    try {
      json = this.readMcpJson();
    } catch {
      return null;
    }
    const entry = json.mcpServers?.[SERVER_NAME];
    if (!entry || typeof entry.command !== 'string') return null;
    return {
      command: entry.command,
      args: Array.isArray(entry.args) ? entry.args.map(String) : [],
      env: (entry.env as Record<string, string> | undefined) ?? {}
    };
  }

  async verify(): Promise<VerificationResult> {
    const launch = this.configuredLaunch();
    const configCheck = checkLaunchConfig(launch, this.ctx.projectRoot, this.mcpFile);
    const checks = [
      checkSkills(this.skillsDir),
      checkInstructions(this.instructionsFile),
      configCheck,
      configCheck.ok && launch
        ? await probeServer(launch)
        : { name: 'mcp-server', ok: false, detail: 'skipped: mcp-config check failed' }
    ];
    return { host: this.name, ok: checks.every((check) => check.ok), checks };
  }

  notes(): string[] {
    return [
      'Claude Code asks you to approve project MCP servers from .mcp.json the first time it starts in this project.',
      '.mcp.json holds absolute paths to this kit checkout — keep it out of version control if the repo is shared.',
      'Authenticate the Figma MCP from Claude Code with /mcp when prompted.'
    ];
  }
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test --workspace=packages/cli && npm run typecheck --workspace=packages/cli`
Expected: 25 tests passing (20 + 5), no type errors, and no leftover server process.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/adapters packages/cli/tests/claude-adapter.test.ts
git commit -m "Add ClaudeCodeAdapter: skills, CLAUDE.md block, project .mcp.json, live verify"
```

---

### Task 6: `CodexAdapter`

**Files:**
- Modify: `packages/cli/package.json` (add `smol-toml` via npm)
- Create: `packages/cli/src/adapters/codex.ts`
- Create: `packages/cli/tests/codex-adapter.test.ts`

**Interfaces:**
- Consumes: everything Task 5 consumes, plus `findManagedBlock` (Task 3) and `HostAdapter` (Task 5).
- Produces: `class CodexAdapter implements HostAdapter` with `constructor(ctx: AdapterContext)`, read-only `skillsDir` (`<project>/.agents/skills`), `instructionsFile` (`<project>/AGENTS.md`), `configFile` (`<project>/.codex/config.toml`), `codexHome` (`env.CODEX_HOME` or `<home>/.codex`); `TOML_BLOCK_START = '# >>> frontend-agent-kit (managed block — edits inside are overwritten)'`, `TOML_BLOCK_END = '# <<< frontend-agent-kit'`.

- [ ] **Step 1: Add the dependency**

Run from the worktree root: `npm install smol-toml@^1.9.0 --workspace=packages/cli`

- [ ] **Step 2: Write the failing tests**

`packages/cli/tests/codex-adapter.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { CodexAdapter, TOML_BLOCK_START, TOML_BLOCK_END } from '../src/adapters/codex.ts';
import { findKitRoot } from '../src/util.ts';
import type { AdapterContext } from '../src/types.ts';

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'frontend-agent-codex-'));
  const projectRoot = join(base, 'project');
  const homeDir = join(base, 'home');
  const codexHome = join(base, 'codex-home');
  mkdirSync(projectRoot);
  mkdirSync(homeDir);
  const kitRoot = findKitRoot();
  const ctx: AdapterContext = { projectRoot, kitRoot, kitVersion: '0.4.0', env: { PATH: '', CODEX_HOME: codexHome }, homeDir, force: false };
  return { projectRoot, homeDir, codexHome, kitRoot, ctx, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

function trust(codexHome: string, projectRoot: string) {
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(join(codexHome, 'config.toml'), `[projects."${projectRoot}"]\ntrust_level = "trusted"\n`);
}

test('detect honours CODEX_HOME and PATH', async () => {
  const { codexHome, ctx, cleanup } = setup();
  try {
    assert.equal(await new CodexAdapter(ctx).detect(), false);
    mkdirSync(codexHome);
    assert.equal(await new CodexAdapter(ctx).detect(), true);
  } finally {
    cleanup();
  }
});

test('installSkills and installInstructions target .agents/skills and AGENTS.md', async () => {
  const { projectRoot, kitRoot, ctx, cleanup } = setup();
  try {
    const adapter = new CodexAdapter(ctx);
    await adapter.installSkills(join(kitRoot, 'skills'));
    assert.ok(existsSync(join(projectRoot, '.agents', 'skills', 'figma-to-code', 'SKILL.md')));
    assert.equal(await adapter.installInstructions(), 'created');
    assert.match(readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8'), /figma-to-code/);
  } finally {
    cleanup();
  }
});

test('installMcp writes a managed block to .codex/config.toml, preserving user content and comments, idempotently', async () => {
  const { projectRoot, kitRoot, ctx, cleanup } = setup();
  try {
    mkdirSync(join(projectRoot, '.codex'));
    const userToml = '# my settings\nmodel = "o3"\n\n[mcp_servers.other]\ncommand = "x"\n';
    writeFileSync(join(projectRoot, '.codex', 'config.toml'), userToml);
    const adapter = new CodexAdapter(ctx);
    await adapter.installMcp({ kitRoot, projectRoot, includeFigma: true });
    const first = readFileSync(join(projectRoot, '.codex', 'config.toml'), 'utf8');
    assert.ok(first.startsWith(userToml.trimEnd()));
    assert.ok(first.includes(TOML_BLOCK_START) && first.includes(TOML_BLOCK_END));
    const parsed = parse(first) as any;
    assert.equal(parsed.model, 'o3');
    assert.equal(parsed.mcp_servers.other.command, 'x');
    assert.equal(parsed.mcp_servers['frontend-agent'].command, join(kitRoot, 'node_modules', '.bin', 'tsx'));
    assert.equal(parsed.mcp_servers['frontend-agent'].env.FRONTEND_AGENT_PROJECT_ROOT, projectRoot);
    assert.equal(parsed.mcp_servers.figma.url, 'https://mcp.figma.com/mcp');
    await adapter.installMcp({ kitRoot, projectRoot, includeFigma: true });
    assert.equal(readFileSync(join(projectRoot, '.codex', 'config.toml'), 'utf8'), first);
  } finally {
    cleanup();
  }
});

test('installMcp refuses an unparseable config and a user-defined frontend-agent table, leaving the file untouched', async () => {
  const { projectRoot, kitRoot, ctx, cleanup } = setup();
  try {
    mkdirSync(join(projectRoot, '.codex'));
    const file = join(projectRoot, '.codex', 'config.toml');
    writeFileSync(file, 'model = \n');
    await assert.rejects(() => new CodexAdapter(ctx).installMcp({ kitRoot, projectRoot, includeFigma: true }), /config\.toml/);
    assert.equal(readFileSync(file, 'utf8'), 'model = \n');
    writeFileSync(file, '[mcp_servers.frontend-agent]\ncommand = "mine"\n');
    await assert.rejects(
      () => new CodexAdapter(ctx).installMcp({ kitRoot, projectRoot, includeFigma: false }),
      /already defines \[mcp_servers\.frontend-agent\]/
    );
  } finally {
    cleanup();
  }
});

test('verify fails with an actionable trust message until the project is trusted, then passes', async () => {
  const { projectRoot, codexHome, kitRoot, ctx, cleanup } = setup();
  try {
    const adapter = new CodexAdapter(ctx);
    await adapter.installSkills(join(kitRoot, 'skills'));
    await adapter.installInstructions();
    await adapter.installMcp({ kitRoot, projectRoot, includeFigma: false });
    const untrusted = await adapter.verify();
    assert.equal(untrusted.ok, false);
    const trustCheck = untrusted.checks.find((c) => c.name === 'codex-trust')!;
    assert.equal(trustCheck.ok, false);
    assert.match(trustCheck.detail, /trust/);
    trust(codexHome, projectRoot);
    const trusted = await adapter.verify();
    assert.equal(trusted.ok, true, JSON.stringify(trusted.checks, null, 2));
    assert.deepEqual(trusted.checks.map((c) => c.name), ['skills', 'instructions', 'mcp-config', 'codex-trust', 'mcp-server']);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test --workspace=packages/cli`
Expected: FAIL — `Cannot find module '../src/adapters/codex.ts'`.

- [ ] **Step 4: Implement `src/adapters/codex.ts`**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'smol-toml';
import type { HostAdapter } from './host-adapter.js';
import type { AdapterContext, CheckResult, McpConfig, VerificationResult } from '../types.js';
import { which } from '../util.js';
import { syncSkills, type SyncReport } from '../sync-skills.js';
import { findManagedBlock, upsertMarkdownBlock, type BlockAction } from '../managed-block.js';
import { FIGMA_MCP_URL, SERVER_NAME, kitServerLaunch, type ServerLaunch } from '../mcp-launch.js';
import { checkInstructions, checkLaunchConfig, checkSkills, probeServer } from '../checks.js';

export const TOML_BLOCK_START = '# >>> frontend-agent-kit (managed block — edits inside are overwritten)';
export const TOML_BLOCK_END = '# <<< frontend-agent-kit';

type TomlTable = Record<string, unknown>;

function parseToml(text: string, fileLabel: string): TomlTable {
  try {
    return parse(text) as TomlTable;
  } catch (error) {
    throw new Error(`frontend-agent: cannot parse ${fileLabel}: ${(error as Error).message}`);
  }
}

function serversOf(table: TomlTable): TomlTable {
  const servers = table.mcp_servers;
  return typeof servers === 'object' && servers !== null ? (servers as TomlTable) : {};
}

export class CodexAdapter implements HostAdapter {
  readonly name = 'codex' as const;
  readonly supported = true;

  constructor(private readonly ctx: AdapterContext) {}

  get skillsDir(): string {
    return path.join(this.ctx.projectRoot, '.agents', 'skills');
  }

  get instructionsFile(): string {
    return path.join(this.ctx.projectRoot, 'AGENTS.md');
  }

  get configFile(): string {
    return path.join(this.ctx.projectRoot, '.codex', 'config.toml');
  }

  get codexHome(): string {
    return this.ctx.env.CODEX_HOME || path.join(this.ctx.homeDir, '.codex');
  }

  async detect(): Promise<boolean> {
    return which('codex', this.ctx.env) !== null || existsSync(this.codexHome);
  }

  async installSkills(sourceDir: string): Promise<SyncReport> {
    return syncSkills(sourceDir, this.skillsDir, { kitVersion: this.ctx.kitVersion, force: this.ctx.force });
  }

  async installInstructions(): Promise<BlockAction> {
    const content = readFileSync(path.join(this.ctx.kitRoot, 'integrations', 'codex', 'AGENTS.md'), 'utf8');
    return upsertMarkdownBlock(this.instructionsFile, content);
  }

  async installMcp(config: McpConfig): Promise<string[]> {
    const text = existsSync(this.configFile) ? readFileSync(this.configFile, 'utf8') : '';
    const span = findManagedBlock(text, TOML_BLOCK_START, TOML_BLOCK_END, this.configFile);
    const userText = span ? text.slice(0, span.from) + text.slice(span.to) : text;
    const userServers = serversOf(parseToml(userText, this.configFile));
    if (userServers[SERVER_NAME]) {
      throw new Error(
        `frontend-agent: ${this.configFile} already defines [mcp_servers.${SERVER_NAME}] outside the frontend-agent-kit block; remove it and re-run.`
      );
    }

    const launch = kitServerLaunch(config);
    const servers: TomlTable = { [SERVER_NAME]: { command: launch.command, args: launch.args, env: launch.env } };
    const actions = [`${SERVER_NAME} MCP server registered in ${this.configFile}`];
    if (config.includeFigma) {
      if (userServers.figma) {
        actions.push(`figma MCP server already configured in ${this.configFile} — kept`);
      } else {
        servers.figma = { url: FIGMA_MCP_URL };
        actions.push(`figma MCP server registered in ${this.configFile} (authenticate with: codex mcp login figma)`);
      }
    }

    const block = `${TOML_BLOCK_START}\n${stringify({ mcp_servers: servers }).trim()}\n${TOML_BLOCK_END}\n`;
    const next = span
      ? text.slice(0, span.from) + block + text.slice(span.to)
      : userText.trimEnd()
        ? `${userText.trimEnd()}\n\n${block}`
        : block;
    parseToml(next, this.configFile);
    if (next !== text) {
      mkdirSync(path.dirname(this.configFile), { recursive: true });
      writeFileSync(this.configFile, next);
    }
    return actions;
  }

  private configuredLaunch(): ServerLaunch | null {
    if (!existsSync(this.configFile)) return null;
    let table: TomlTable;
    try {
      table = parseToml(readFileSync(this.configFile, 'utf8'), this.configFile);
    } catch {
      return null;
    }
    const entry = serversOf(table)[SERVER_NAME] as TomlTable | undefined;
    if (!entry || typeof entry.command !== 'string') return null;
    return {
      command: entry.command,
      args: Array.isArray(entry.args) ? entry.args.map(String) : [],
      env: (entry.env as Record<string, string> | undefined) ?? {}
    };
  }

  private checkTrust(): CheckResult {
    const name = 'codex-trust';
    const globalConfig = path.join(this.codexHome, 'config.toml');
    const hint = `Codex only loads ${this.configFile} for trusted projects — start Codex in ${this.ctx.projectRoot} and choose to trust it`;
    if (!existsSync(globalConfig)) return { name, ok: false, detail: hint };
    let table: TomlTable;
    try {
      table = parseToml(readFileSync(globalConfig, 'utf8'), globalConfig);
    } catch (error) {
      return { name, ok: false, detail: (error as Error).message };
    }
    const projects = (table.projects ?? {}) as Record<string, { trust_level?: string }>;
    const ok = projects[this.ctx.projectRoot]?.trust_level === 'trusted';
    return { name, ok, detail: ok ? `${this.ctx.projectRoot} is trusted in ${globalConfig}` : hint };
  }

  async verify(): Promise<VerificationResult> {
    const launch = this.configuredLaunch();
    const configCheck = checkLaunchConfig(launch, this.ctx.projectRoot, this.configFile);
    const checks = [
      checkSkills(this.skillsDir),
      checkInstructions(this.instructionsFile),
      configCheck,
      this.checkTrust(),
      configCheck.ok && launch
        ? await probeServer(launch)
        : { name: 'mcp-server', ok: false, detail: 'skipped: mcp-config check failed' }
    ];
    return { host: this.name, ok: checks.every((check) => check.ok), checks };
  }

  notes(): string[] {
    return [
      `Codex reads ${this.configFile} only for trusted projects — trust ${this.ctx.projectRoot} the first time you start Codex there.`,
      '.codex/config.toml holds absolute paths to this kit checkout — keep it out of version control if the repo is shared.'
    ];
  }
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test --workspace=packages/cli && npm run typecheck --workspace=packages/cli`
Expected: 30 tests passing (25 + 5), no type errors, and no leftover server process.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/package.json package-lock.json packages/cli/src/adapters/codex.ts packages/cli/tests/codex-adapter.test.ts
git commit -m "Add CodexAdapter: skills, AGENTS.md block, project .codex/config.toml block, trust-aware verify"
```

---

### Task 7: Stub adapters, the `frontend-agent` CLI, and docs

**Files:**
- Create: `packages/cli/src/adapters/stub.ts`
- Create: `packages/cli/src/adapters/index.ts`
- Create: `packages/cli/src/cli.ts`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/bin/frontend-agent.mjs`
- Create: `packages/cli/tests/cli.test.ts`
- Modify: `package.json` (root: add a `frontend-agent` script)
- Modify: `README.md`
- Modify: `integrations/claude/CLAUDE.md`, `integrations/codex/AGENTS.md`

**Interfaces:**
- Consumes: `ClaudeCodeAdapter` (Task 5), `CodexAdapter` (Task 6), `HostAdapter` (Task 5), `findKitRoot`, `readKitVersion` (Task 1), `AdapterContext`, `HostName` (Task 1).
- Produces: `class StubAdapter implements HostAdapter` (`constructor(name: 'cursor' | 'vscode')`); `REAL_HOSTS: HostName[] = ['claude', 'codex']`, `ALL_HOSTS: HostName[]`, `createAdapter(name: HostName, ctx: AdapterContext): HostAdapter`; `interface CliIo { stdout: (line: string) => void; stderr: (line: string) => void; env: NodeJS.ProcessEnv; cwd: string; homeDir: string }` and `run(argv: string[], io: CliIo): Promise<number>`.

- [ ] **Step 1: Implement the stub adapter and factory**

`packages/cli/src/adapters/stub.ts`:
```ts
import type { HostAdapter } from './host-adapter.js';
import type { VerificationResult } from '../types.js';
import type { SyncReport } from '../sync-skills.js';
import type { BlockAction } from '../managed-block.js';

/** Spec §6: Cursor and VS Code adapters exist in the interface but have no installation logic yet. */
export class StubAdapter implements HostAdapter {
  readonly supported = false;

  constructor(readonly name: 'cursor' | 'vscode') {}

  private unsupported(): Error {
    return new Error(`frontend-agent: ${this.name} is not supported yet (stub adapter in v0.4 — spec §6).`);
  }

  async detect(): Promise<boolean> {
    return false;
  }

  async installSkills(): Promise<SyncReport> {
    throw this.unsupported();
  }

  async installInstructions(): Promise<BlockAction> {
    throw this.unsupported();
  }

  async installMcp(): Promise<string[]> {
    throw this.unsupported();
  }

  async verify(): Promise<VerificationResult> {
    return { host: this.name, ok: false, checks: [{ name: 'supported', ok: false, detail: 'stub adapter; no installation logic yet' }] };
  }

  notes(): string[] {
    return [];
  }
}
```

`packages/cli/src/adapters/index.ts`:
```ts
import type { HostAdapter } from './host-adapter.js';
import type { AdapterContext, HostName } from '../types.js';
import { ClaudeCodeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { StubAdapter } from './stub.js';

export type { HostAdapter } from './host-adapter.js';

export const REAL_HOSTS: HostName[] = ['claude', 'codex'];
export const ALL_HOSTS: HostName[] = ['claude', 'codex', 'cursor', 'vscode'];

export function createAdapter(name: HostName, ctx: AdapterContext): HostAdapter {
  if (name === 'claude') return new ClaudeCodeAdapter(ctx);
  if (name === 'codex') return new CodexAdapter(ctx);
  return new StubAdapter(name);
}
```

- [ ] **Step 2: Write the failing CLI tests**

`packages/cli/tests/cli.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run, type CliIo } from '../src/cli.ts';
import { findKitRoot } from '../src/util.ts';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'frontend-agent-cli-'));
  const projectRoot = join(base, 'project');
  const homeDir = join(base, 'home');
  mkdirSync(projectRoot);
  mkdirSync(homeDir);
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    env: { PATH: '', CODEX_HOME: join(base, 'codex-home') },
    cwd: projectRoot,
    homeDir
  };
  return { base, projectRoot, homeDir, io, out, err, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test('install claude sets up skills, CLAUDE.md and .mcp.json in the target project; a re-run changes nothing', async () => {
  const { projectRoot, io, out, cleanup } = setup();
  try {
    assert.equal(await run(['install', 'claude', '--project', projectRoot], io), 0);
    assert.ok(existsSync(join(projectRoot, '.claude', 'skills', 'figma-to-code', 'SKILL.md')));
    assert.match(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8'), /frontend-agent-kit:start/);
    const mcp = JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf8'));
    assert.equal(mcp.mcpServers['frontend-agent'].env.FRONTEND_AGENT_PROJECT_ROOT, projectRoot);
    const firstRunOutput = out.join('\n');
    assert.match(firstRunOutput, /added/);
    out.length = 0;
    assert.equal(await run(['install', 'claude', '--project', projectRoot], io), 0);
    assert.match(out.join('\n'), /0 added, 0 updated, 0 removed/);
    assert.match(out.join('\n'), /CLAUDE\.md: unchanged/);
  } finally {
    cleanup();
  }
});

test('install with no host installs every detected host, and fails clearly when none is detected', async () => {
  const { projectRoot, homeDir, io, err, cleanup } = setup();
  try {
    assert.equal(await run(['install', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /no supported host detected/);
    mkdirSync(join(homeDir, '.claude'));
    assert.equal(await run(['install', '--project', projectRoot], io), 0);
    assert.ok(existsSync(join(projectRoot, '.mcp.json')));
    assert.equal(existsSync(join(projectRoot, 'AGENTS.md')), false, 'codex was not detected, so not installed');
  } finally {
    cleanup();
  }
});

test('--all installs both real hosts; --no-figma skips the figma server', async () => {
  const { projectRoot, io, cleanup } = setup();
  try {
    assert.equal(await run(['install', '--all', '--no-figma', '--project', projectRoot], io), 0);
    assert.ok(existsSync(join(projectRoot, '.agents', 'skills', 'figma-to-code', 'SKILL.md')));
    assert.ok(existsSync(join(projectRoot, 'AGENTS.md')));
    assert.doesNotMatch(readFileSync(join(projectRoot, '.codex', 'config.toml'), 'utf8'), /figma/);
    const mcp = JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf8'));
    assert.equal(mcp.mcpServers.figma, undefined);
  } finally {
    cleanup();
  }
});

test('stub hosts, unknown hosts, a missing project dir and the kit checkout itself are rejected with exit 1', async () => {
  const { base, projectRoot, io, err, cleanup } = setup();
  try {
    assert.equal(await run(['install', 'cursor', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /cursor is not supported yet/);
    assert.equal(await run(['install', 'emacs', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /unknown host "emacs"/);
    assert.equal(await run(['install', 'claude', '--project', join(base, 'nope')], io), 1);
    assert.match(err.join('\n'), /does not exist/);
    assert.equal(await run(['install', 'claude', '--project', findKitRoot()], io), 1);
    assert.match(err.join('\n'), /kit checkout itself/);
  } finally {
    cleanup();
  }
});

test('verify exits 0 when every check passes and 1 otherwise, printing each check', async () => {
  const { projectRoot, io, out, cleanup } = setup();
  try {
    assert.equal(await run(['verify', 'claude', '--project', projectRoot], io), 1);
    await run(['install', 'claude', '--project', projectRoot], io);
    out.length = 0;
    assert.equal(await run(['verify', 'claude', '--project', projectRoot], io), 0);
    assert.match(out.join('\n'), /✔ mcp-server/);
    out.length = 0;
    await run(['install', 'codex', '--project', projectRoot], io);
    assert.equal(await run(['verify', 'codex', '--project', projectRoot], io), 1);
    assert.match(out.join('\n'), /✘ codex-trust/);
  } finally {
    cleanup();
  }
});

test('--help and --version print and exit 0; an unknown command exits 1', async () => {
  const { io, out, err, cleanup } = setup();
  try {
    assert.equal(await run(['--version'], io), 0);
    assert.equal(out.at(-1), '0.4.0');
    assert.equal(await run(['--help'], io), 0);
    assert.match(out.join('\n'), /frontend-agent install/);
    assert.equal(await run(['frobnicate'], io), 1);
    assert.match(err.join('\n'), /unknown command "frobnicate"/);
  } finally {
    cleanup();
  }
});

test('the bin script runs the CLI through tsx from any cwd', () => {
  const result = spawnSync(process.execPath, [join(packageRoot, 'bin', 'frontend-agent.mjs'), '--version'], {
    cwd: tmpdir(),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '0.4.0');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test --workspace=packages/cli`
Expected: FAIL — `Cannot find module '../src/cli.ts'`.

- [ ] **Step 4: Implement `src/cli.ts`, `src/index.ts` and the bin**

`packages/cli/src/cli.ts`:
```ts
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ALL_HOSTS, REAL_HOSTS, createAdapter, type HostAdapter } from './adapters/index.js';
import type { AdapterContext, HostName } from './types.js';
import { findKitRoot, readKitVersion } from './util.js';

export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  env: NodeJS.ProcessEnv;
  cwd: string;
  homeDir: string;
}

const HELP = `frontend-agent — install the Frontend Agent Kit into a project

Usage:
  frontend-agent install [claude|codex ...] [--all] [--project <dir>] [--force] [--no-figma]
  frontend-agent verify  [claude|codex ...] [--all] [--project <dir>]
  frontend-agent --help | --version

With no host, install/verify use every detected host (claude, codex).
--project defaults to the current directory. --force overwrites locally edited kit skills.
Cursor and VS Code adapters are stubs in v0.4.`;

function resolveProjectRoot(value: string | undefined, io: CliIo, kitRoot: string): string {
  const projectRoot = path.resolve(io.cwd, value ?? '.');
  if (!existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
    throw new Error(`frontend-agent: project directory "${projectRoot}" does not exist.`);
  }
  if (realpathSync(projectRoot) === realpathSync(kitRoot)) {
    throw new Error('frontend-agent: refusing to install into the kit checkout itself — pass --project <target project>.');
  }
  return projectRoot;
}

async function selectAdapters(positionals: string[], all: boolean, ctx: AdapterContext): Promise<HostAdapter[]> {
  for (const host of positionals) {
    if (!ALL_HOSTS.includes(host as HostName)) {
      throw new Error(`frontend-agent: unknown host "${host}" (expected one of: ${ALL_HOSTS.join(', ')}).`);
    }
  }
  const names: HostName[] = all ? REAL_HOSTS : (positionals as HostName[]);
  if (names.length > 0) return names.map((name) => createAdapter(name, ctx));

  const detected: HostAdapter[] = [];
  for (const name of REAL_HOSTS) {
    const adapter = createAdapter(name, ctx);
    if (await adapter.detect()) detected.push(adapter);
  }
  if (detected.length === 0) {
    throw new Error('frontend-agent: no supported host detected — pass claude or codex explicitly (or --all).');
  }
  return detected;
}

async function install(adapters: HostAdapter[], ctx: AdapterContext, includeFigma: boolean, io: CliIo): Promise<void> {
  for (const adapter of adapters) {
    if (!adapter.supported) {
      throw new Error(`frontend-agent: ${adapter.name} is not supported yet (stub adapter in v0.4 — spec §6).`);
    }
  }
  for (const adapter of adapters) {
    io.stdout(`\n[${adapter.name}] installing into ${ctx.projectRoot}`);
    const report = await adapter.installSkills(path.join(ctx.kitRoot, 'skills'));
    io.stdout(
      `  skills → ${report.targetDir}: ${report.added.length} added, ${report.updated.length} updated, ${report.removed.length} removed, ${report.unchanged.length} unchanged`
    );
    for (const skipped of report.skipped) io.stdout(`  ! skipped ${skipped.path}: ${skipped.reason}`);
    const instructions = await adapter.installInstructions();
    io.stdout(`  ${adapter.name === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'}: ${instructions}`);
    for (const action of await adapter.installMcp({ kitRoot: ctx.kitRoot, projectRoot: ctx.projectRoot, includeFigma })) {
      io.stdout(`  ${action}`);
    }
    for (const note of adapter.notes()) io.stdout(`  note: ${note}`);
  }
  io.stdout(`\nDone. Run "frontend-agent verify${adapters.length === 1 ? ` ${adapters[0].name}` : ''} --project ${ctx.projectRoot}" to check the setup.`);
}

async function verify(adapters: HostAdapter[], io: CliIo): Promise<boolean> {
  let allOk = true;
  for (const adapter of adapters) {
    const result = await adapter.verify();
    io.stdout(`\n[${adapter.name}] ${result.ok ? 'ok' : 'NOT OK'}`);
    for (const check of result.checks) io.stdout(`  ${check.ok ? '✔' : '✘'} ${check.name}: ${check.detail}`);
    allOk &&= result.ok;
  }
  return allOk;
}

export async function run(argv: string[], io: CliIo): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        all: { type: 'boolean', default: false },
        project: { type: 'string' },
        force: { type: 'boolean', default: false },
        'no-figma': { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
        version: { type: 'boolean', default: false }
      }
    });
    if (values.version) {
      io.stdout(readKitVersion());
      return 0;
    }
    const [command, ...hosts] = positionals;
    if (values.help || !command) {
      io.stdout(HELP);
      return values.help ? 0 : 1;
    }
    if (command !== 'install' && command !== 'verify') {
      throw new Error(`frontend-agent: unknown command "${command}" — see --help.`);
    }

    const kitRoot = findKitRoot();
    const ctx: AdapterContext = {
      projectRoot: resolveProjectRoot(values.project, io, kitRoot),
      kitRoot,
      kitVersion: readKitVersion(),
      env: io.env,
      homeDir: io.homeDir,
      force: values.force ?? false
    };
    const adapters = await selectAdapters(hosts, values.all ?? false, ctx);

    if (command === 'install') {
      await install(adapters, ctx, !values['no-figma'], io);
      return 0;
    }
    return (await verify(adapters, io)) ? 0 : 1;
  } catch (error) {
    io.stderr((error as Error).message);
    return 1;
  }
}
```

`packages/cli/src/index.ts`:
```ts
import { homedir } from 'node:os';
import { run } from './cli.js';

const code = await run(process.argv.slice(2), {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  env: process.env,
  cwd: process.cwd(),
  homeDir: homedir()
});
process.exitCode = code;
```

`packages/cli/bin/frontend-agent.mjs`:
```js
#!/usr/bin/env node
// Runs the TypeScript CLI through tsx, resolved relative to this file (works from any cwd).
import { register } from 'tsx/esm/api';

register();
await import('../src/index.ts');
```

Then: `chmod +x packages/cli/bin/frontend-agent.mjs`.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test --workspace=packages/cli && npm run typecheck --workspace=packages/cli`
Expected: 37 tests passing (30 + 7), no type errors, no leftover server process.

- [ ] **Step 6: Root script, integrations text and README**

1. Root `package.json` `scripts`: add `"frontend-agent": "node packages/cli/bin/frontend-agent.mjs"`.
2. `integrations/claude/CLAUDE.md`: change item 4 to `4. Use the frontend-agent MCP (capture_screenshot, inspect_dom, compare_screenshots, run_responsive_suite, run_accessibility_audit) for browser validation and visual diff.`
3. `integrations/codex/AGENTS.md`: change `- Validate implemented UI through the frontend-agent MCP once installed (v0.2+).` to `- Validate implemented UI through the frontend-agent MCP (compare_screenshots, run_responsive_suite, run_accessibility_audit).`
4. `README.md` (read it fully first):
   - In the intro paragraph that starts `The kit's own MCP server ships five tools`, replace the sentence `Not yet included: the CLI installer (v0.4).` with `The \`frontend-agent\` CLI (v0.4) installs all of it into a project.`
   - Insert a new section `## Install into a target project (CLI, v0.4)` **before** `## Install into a target project (manual, v0.1)`, and rename that heading to `## Install into a target project (manual fallback)`. The new section contains:

````markdown
From the kit checkout, once:

```bash
npm install
npx --workspace=packages/mcp-server playwright install chromium
npm link --workspace=packages/cli   # optional: puts `frontend-agent` on your PATH
```

Then, for each project:

```bash
frontend-agent install --project /path/to/project          # every detected host
frontend-agent install claude --project /path/to/project   # or: codex, --all
frontend-agent verify --project /path/to/project
```

(Without `npm link`: `node /path/to/frontend-agent-kit/packages/cli/bin/frontend-agent.mjs install …`, or `npm run frontend-agent -- install …` from the kit root.)

What `install` writes — only inside the target project:

| Host | Skills | Instructions | MCP servers |
|---|---|---|---|
| Claude Code | `.claude/skills/` | `CLAUDE.md` (managed block) | `.mcp.json` (`frontend-agent`, `figma`) |
| Codex | `.agents/skills/` | `AGENTS.md` (managed block) | `.codex/config.toml` (managed block) |
````

   followed by these bullets:
   - Re-running `install` updates the kit's skills and never touches skills it didn't install; a kit skill you edited locally is kept and reported (`--force` overwrites it).
   - Your own content in `CLAUDE.md`/`AGENTS.md`, other MCP servers, and anything outside the managed blocks is preserved. `--no-figma` skips the Figma server.
   - `verify` checks the files and starts the MCP server to confirm the five tools respond. It exits 1 on any failure.
   - Claude Code asks you to approve project MCP servers from `.mcp.json` on first start. Codex loads `.codex/config.toml` only for trusted projects, so trust the project when Codex asks, and `verify` tells you when it isn't trusted yet.
   - `.mcp.json` and `.codex/config.toml` contain absolute paths to your kit checkout. Keep them out of version control in shared repos.
   - Cursor and VS Code adapters are stubs for now.
   - In the section `## Register the kit's own MCP server (v0.2)`, add one sentence at its top: `The CLI above does this for you per project; the manual steps below remain for custom setups.`

- [ ] **Step 7: Final verification**

Run from the worktree root: `npm run validate:skills && npm test --workspace=packages/cli && npm run typecheck --workspace=packages/cli && npm test --workspace=packages/mcp-server`
Expected: skills valid; cli 37 passing; typecheck clean; mcp-server 82 passing.

- [ ] **Step 8: Commit**

```bash
git add packages/cli package.json package-lock.json README.md integrations
git commit -m "Add frontend-agent CLI (install/verify, auto-detect, stubs for Cursor/VS Code) and document v0.4"
```

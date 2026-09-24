# Frontend Agent Kit v0.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the eval suite (18 scenarios with deterministic `expected`/`forbidden` assertions, a Figma MCP mock, fixtures) and an opt-in benchmark that runs Claude Code and Codex headless on the same scenarios and writes a comparative report. Also close the v0.4.1 CLI gaps.

**Architecture:** New workspace package `packages/evals`. Scenario/fixture data lives in `evals/`. `npm test` is offline and free: schema, parsers, grader, mock, workspace, static server and the whole bench loop are tested, the loop with a fake host script. `npm run bench` copies a fixture into a temp dir, installs the kit into it in process (CLI `run`), serves it on `127.0.0.1:<random port>`, starts the host headless with only the kit MCP + Figma mock, parses the transcript into a `RunRecord`, grades it and writes `evals/results/<timestamp>/`.

**Tech Stack:** TypeScript ESM (NodeNext) run through `tsx`, `zod` 3, `@modelcontextprotocol/sdk` (mock server + test client), `playwright` + `pngjs` (one-off reference asset rendering), Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-24-frontend-agent-kit-v0.5-evals-design.md` (and the main spec `2026-09-23-frontend-agent-kit-design.md` §8, §10)

## Global Constraints

- Package `packages/evals` = `@frontend-agent-kit/evals`, version `0.5.0`, same `tsconfig.json` as `packages/cli`. Imports between `src/` files use `.js`; tests import `src/` with `.ts`. Imports from the CLI package use relative paths into `../../cli/src/*.js` (no package exports).
- `packages/cli` version becomes `0.5.0` (it is `readKitVersion()`); tests pinning `'0.4.0'` as the *kit version reported by the CLI* are updated. Tests that pass `kitVersion: '0.4.0'` as arbitrary input stay as they are.
- Scenario counts: base 7, stack 8, profile 3 (= 18). Stack ids: `stack-react`, `stack-nextjs`, `stack-vuejs`, `stack-nuxt`, `stack-angular`, `stack-tailwind`, `stack-php`, `stack-html-css-js` (suffix = `skills/figma-to-code/references/<suffix>.md`).
- Assertion types exactly: `tool_called`, `output_matches`, `file_matches`, `file_exists`. Tool names are `<server>/<tool>`; the parsers also emit `skill/<name>` (a SKILL.md was read/invoked), `reference/<name>` (a `references/<name>.md` was read) and `builtin/<name>`.
- Verdict: `pass` | `fail` | `error`. Timeout, non-zero exit, host missing, unparseable/truncated transcript → `error`. `error` never counts as pass.
- Headless hosts, verified on this machine 2026-09-24 (claude 2.1.281, codex-cli 0.153.4):
  - Claude: `claude -p <prompt> --output-format stream-json --verbose --mcp-config <file> --strict-mcp-config --setting-sources project --allowedTools <csv> --permission-mode acceptEdits [--model m]`. Never `bypassPermissions`.
  - Codex: `codex exec --json --ignore-user-config --sandbox workspace-write --skip-git-repo-check --ephemeral -C <ws> -c mcp_servers.<n>.command=… -c mcp_servers.<n>.args=[…] -c mcp_servers.<n>.env={…} -c mcp_servers.<n>.default_tools_approval_mode="approve" [-m m] <prompt>`, stdin `/dev/null`. Without `default_tools_approval_mode="approve"` MCP calls fail with "requires approval, but approval policy is never".
- Figma mock server name is `figma`; tools `get_metadata`, `get_design_context`, `get_variable_defs`, `get_screenshot`, `download_assets`.
- `evals/results/` is gitignored. The bench never writes outside `os.tmpdir()/fak-bench-*` and the chosen output dir.
- Prompt template variable: `{{baseUrl}}` → `http://127.0.0.1:<port>`.

## Review Focus

1. Host CLI not installed or not logged in → every case for that host is `error` with a readable message, the other host still runs, the report is still written. (Task 8 test "missing binary".)
2. Agent hangs → timeout kills the whole process group, including grandchildren (MCP servers); no orphans. (Task 8 test "timeout kills the process group".)
3. Transcript cut mid-run (killed/crashed) → `error`, never `pass`, even if every assertion happened to be satisfied. (Task 3 + Task 4 tests.)
4. Agent leaves a symlink in the workspace pointing outside (e.g. `/etc/hostname`) → grader never follows it (`file_matches`/`file_exists` ignore symlinks). (Task 4 test.)
5. User appended settings below the managed TOML block and runs `install --all` → preflight fails before *any* host writes. (Task 1 test.)

---

### Task 1: CLI v0.4.1 — preflight dry-runs merge + manifest, dangling in-root symlink, verify compares content

**Files:**
- Modify: `packages/cli/src/adapters/host-adapter.ts`, `packages/cli/src/adapters/claude.ts`, `packages/cli/src/adapters/codex.ts`, `packages/cli/src/cli.ts`, `packages/cli/src/managed-block.ts`, `packages/cli/src/checks.ts`, `packages/cli/src/sync-skills.ts` (export `listSourceSkills`), `packages/cli/package.json` (version `0.5.0`)
- Test: `packages/cli/tests/cli.test.ts`, `packages/cli/tests/managed-block.test.ts`, `packages/cli/tests/checks.test.ts`, `packages/cli/tests/util.test.ts`

**Interfaces:**
- Changes: `HostAdapter.preflight(config: McpConfig): Promise<void>`; `checkSkills(skillsDir: string, sourceDir: string): CheckResult`.
- Produces: `export function listSourceSkills(sourceDir: string): string[]` from `sync-skills.ts`.

- [ ] **Step 1: Create the branch**

```bash
cd /home/andre/frontend-agent-kit && git checkout -b feature/v0.5
```

- [ ] **Step 2: Write the failing tests**

Append to `packages/cli/tests/cli.test.ts` (it already imports `run`, `setup`, `existsSync`, `mkdirSync`, `writeFileSync`, `readFileSync`, `join`; add `appendFileSync` to its `node:fs` import):

```ts
test('preflight fails closed on a settings line appended below the managed TOML block (merge check), before claude writes anything', async () => {
  const { projectRoot, io, err, cleanup } = setup();
  try {
    assert.equal(await run(['install', 'codex', '--project', projectRoot, '--no-figma'], io), 0);
    appendFileSync(join(projectRoot, '.codex', 'config.toml'), 'EXTRA_SETTING = "x"\n');
    assert.equal(await run(['install', '--all', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /^\[codex\] .*would merge into it/m);
    assert.equal(existsSync(join(projectRoot, 'CLAUDE.md')), false, 'CLAUDE.md not created');
    assert.equal(existsSync(join(projectRoot, '.claude', 'skills')), false, 'claude skills not installed');
  } finally {
    cleanup();
  }
});

test('preflight fails closed on a corrupt skills manifest of a later host', async () => {
  const { projectRoot, io, err, cleanup } = setup();
  try {
    mkdirSync(join(projectRoot, '.agents', 'skills'), { recursive: true });
    writeFileSync(join(projectRoot, '.agents', 'skills', '.frontend-agent-kit-manifest.json'), '{');
    assert.equal(await run(['install', '--all', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /^\[codex\] .*corrupt or was tampered with/m);
    assert.equal(existsSync(join(projectRoot, 'CLAUDE.md')), false, 'CLAUDE.md not created');
  } finally {
    cleanup();
  }
});
```

In `packages/cli/tests/managed-block.test.ts`, replace the whole test `'dangling CLAUDE.md → outside/new.md throws …'` with:

```ts
test('dangling link to a file outside the root is refused; to a missing in-root file it is written through', () => {
  withDir((dir) => {
    withDir((outsideDir) => {
      const outsideFile = join(outsideDir, 'new.md');
      const symlink = join(dir, 'CLAUDE.md');
      symlinkSync(outsideFile, symlink);
      assert.throws(() => upsertMarkdownBlock(symlink, 'x', dir), /dangling symbolic link/);
      assert(!existsSync(outsideFile));
    });

    const link = join(dir, 'AGENTS.md');
    const missingTarget = join(dir, 'CLAUDE-shared.md');
    symlinkSync(missingTarget, link);
    assert.equal(upsertMarkdownBlock(link, 'shared rules', dir), 'created');
    assert.match(readFileSync(missingTarget, 'utf8'), /shared rules/);
  });
});

test('dangling link whose target is itself a dangling link is refused', () => {
  withDir((dir) => {
    symlinkSync(join(dir, 'nowhere.md'), join(dir, 'middle.md'));
    symlinkSync(join(dir, 'middle.md'), join(dir, 'AGENTS.md'));
    assert.throws(() => upsertMarkdownBlock(join(dir, 'AGENTS.md'), 'x', dir), /dangling symbolic link/);
    assert(!existsSync(join(dir, 'nowhere.md')));
  });
});
```

In `packages/cli/tests/checks.test.ts`, change the first test's calls `checkSkills(target)` → `checkSkills(target, join(kitRoot, 'skills'))` (three places), and append:

```ts
test('checkSkills reports kit files newer than the installed copy, and accepts local edits with a note', async () => {
  await withDir((dir) => {
    const source = join(dir, 'kit-skills');
    mkdirSync(join(source, 'demo'), { recursive: true });
    writeFileSync(join(source, 'demo', 'SKILL.md'), 'v1\n');
    const target = join(dir, 'installed');
    syncSkills(source, target, { kitVersion: '0.5.0' });
    assert.equal(checkSkills(target, source).ok, true);

    writeFileSync(join(source, 'demo', 'SKILL.md'), 'v2\n');
    const outdated = checkSkills(target, source);
    assert.equal(outdated.ok, false);
    assert.match(outdated.detail, /outdated.*demo\/SKILL\.md.*run install/);

    writeFileSync(join(source, 'demo', 'extra.md'), 'new file\n');
    assert.match(checkSkills(target, source).detail, /demo\/extra\.md/);
    rmSync(join(source, 'demo', 'extra.md'));

    writeFileSync(join(target, 'demo', 'SKILL.md'), 'my edit\n');
    const edited = checkSkills(target, source);
    assert.equal(edited.ok, true, edited.detail);
    assert.match(edited.detail, /locally edited.*demo\/SKILL\.md/);
  });
});
```

In `packages/cli/tests/util.test.ts` change `assert.equal(readKitVersion(), '0.4.0')` → `'0.5.0'`; in `packages/cli/tests/cli.test.ts` change the two version assertions (`out.at(-1)` and `result.stdout.trim()`) from `'0.4.0'` to `'0.5.0'`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd packages/cli && npm test 2>&1 | tail -30`
Expected: FAIL — the merge/manifest preflight tests (claude files get created), the dangling in-root test (throws), the checkSkills tests (signature/outdated), the version tests.

- [ ] **Step 4: Implement**

`packages/cli/package.json`: `"version": "0.5.0"`.

`packages/cli/src/adapters/host-adapter.ts` — change the preflight line:

```ts
  /** Validate everything this host will touch (including a dry run of the config merge), without writing anything. Fail closed. */
  preflight(config: McpConfig): Promise<void>;
```

`packages/cli/src/cli.ts` — in `install()`, the preflight loop becomes:

```ts
  const mcpConfig = { kitRoot: ctx.kitRoot, projectRoot: ctx.projectRoot, includeFigma };
  for (const adapter of adapters) {
    await withHostPrefix(adapter, () => adapter.preflight(mcpConfig));
  }
```

and the later `adapter.installMcp({ kitRoot: ctx.kitRoot, projectRoot: ctx.projectRoot, includeFigma })` becomes `adapter.installMcp(mcpConfig)`.

`packages/cli/src/sync-skills.ts` — `function listSourceSkills` → `export function listSourceSkills`.

`packages/cli/src/adapters/claude.ts` — import `readManifest` from `'../sync-skills.js'` (add to the existing import), and:

```ts
  async preflight(_config: McpConfig): Promise<void> {
    assertRealDirInsideRoot(this.skillsDir, this.ctx.projectRoot);
    readManifest(this.skillsDir);
    preflightMarkdownFile(this.instructionsFile, this.ctx.projectRoot);
    assertInsideRoot(this.mcpFile, this.ctx.projectRoot);
    this.readMcpJson();
  }
```

and in `verify()`: `checkSkills(this.skillsDir, path.join(this.ctx.kitRoot, 'skills'))`.

`packages/cli/src/adapters/codex.ts` — import `readManifest` from `'../sync-skills.js'`. Replace `preflight()` and `installMcp()` with the following (the body of `planMcp` is the old `installMcp` minus the write):

```ts
  async preflight(config: McpConfig): Promise<void> {
    assertRealDirInsideRoot(this.skillsDir, this.ctx.projectRoot);
    readManifest(this.skillsDir);
    preflightMarkdownFile(this.instructionsFile, this.ctx.projectRoot);
    this.planMcp(config);
  }

  /** Compute the next config.toml text and validate it (parse + merge check) without writing. */
  private planMcp(config: McpConfig): { text: string; next: string; actions: string[] } {
    assertRealDirInsideRoot(path.dirname(this.configFile), this.ctx.projectRoot);
    if (existsSync(path.dirname(this.configFile))) assertInsideRoot(this.configFile, this.ctx.projectRoot);
    const text = existsSync(this.configFile) ? readFileSync(this.configFile, 'utf8') : '';
    const span = findManagedBlock(text, TOML_BLOCK_START, TOML_BLOCK_END_VARIANTS, this.configFile);
    const userText = span ? text.slice(0, span.from) + text.slice(span.to) : text;
    const userServers = this.validateUserServers(userText);

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

    let nextTable: TomlTable;
    try {
      nextTable = parse(next) as TomlTable;
    } catch (error) {
      throw new Error(
        `frontend-agent: cannot add the frontend-agent-kit block to ${this.configFile} (does it define mcp_servers as an inline table?): ${(error as Error).message}`
      );
    }
    // The block is placed textually, but TOML lets settings *below* it merge into the same table
    // (e.g. a key-value pair after the block lands in [mcp_servers.frontend-agent.env]). Catch that by
    // re-parsing the whole file and checking the servers we just wrote came through unchanged.
    const nextServers = serversOf(nextTable);
    // smol-toml's parsed values aren't plain Objects/Arrays (different prototypes), so compare
    // through a JSON round-trip rather than isDeepStrictEqual directly on the parser's output.
    const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
    const wroteCleanly =
      isDeepStrictEqual(plain(nextServers[SERVER_NAME]), plain(servers[SERVER_NAME])) &&
      (!servers.figma || isDeepStrictEqual(plain(nextServers.figma), plain(servers.figma)));
    if (!wroteCleanly) {
      throw new Error(
        `frontend-agent: settings were added below the frontend-agent-kit block in ${this.configFile} and would merge into it; move them above the block and re-run.`
      );
    }
    return { text, next, actions };
  }

  async installMcp(config: McpConfig): Promise<string[]> {
    const { text, next, actions } = this.planMcp(config);
    if (next !== text) {
      mkdirSync(path.dirname(this.configFile), { recursive: true });
      assertInsideRoot(this.configFile, this.ctx.projectRoot);
      writeFileSync(this.configFile, next);
    }
    return actions;
  }
```

and in `verify()`: `checkSkills(this.skillsDir, path.join(this.ctx.kitRoot, 'skills'))`.

`packages/cli/src/managed-block.ts` — in `assertInsideRoot`, replace the symlink branch body (`const linkTarget = …` through the closing of its `catch`) with:

```ts
    const linkTarget = readlinkSync(filePath);
    const resolvedTarget = resolve(dirname(filePath), linkTarget);
    try {
      realPath = realpathSync(resolvedTarget);
    } catch (err) {
      if ((err as any)?.code !== 'ENOENT') throw err;
      // Dangling link. Writing through it creates the target — acceptable only when the target is
      // a plain missing file (not another link) whose directory already exists inside the root,
      // e.g. AGENTS.md → CLAUDE.md before CLAUDE.md exists.
      let targetIsLink = false;
      try {
        targetIsLink = lstatSync(resolvedTarget).isSymbolicLink();
      } catch {
        // target missing — expected for a dangling link
      }
      let realDir: string | null = null;
      if (!targetIsLink) {
        try {
          realDir = realpathSync(dirname(resolvedTarget));
        } catch {
          realDir = null;
        }
      }
      const relDir = realDir === null ? null : relative(realRoot, realDir);
      if (relDir === null || relDir === '..' || relDir.startsWith('..' + sep) || isAbsolute(relDir)) {
        throw new Error(
          `frontend-agent: ${filePath} is a dangling symbolic link to ${resolvedTarget}; refusing to write through it.`
        );
      }
      realPath = join(realDir as string, basename(resolvedTarget));
    }
```

Update the doc comment above `assertInsideRoot` to: "Rejects symlinks resolving outside the root and dangling links, except a dangling link to a missing plain file inside the root (writing creates it). In-project symlinks (e.g., CLAUDE.md → AGENTS.md) are allowed."

`packages/cli/src/checks.ts` — import `sha256File` from `'./util.js'` and `listFilesRecursive` too, `listSourceSkills` from `'./sync-skills.js'` is **not** needed. Replace `checkSkills` with:

```ts
export function checkSkills(skillsDir: string, sourceDir: string): CheckResult {
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
  const outdated: string[] = [];
  const edited: string[] = [];
  let count = 0;
  for (const [skill, files] of Object.entries(manifest.skills)) {
    for (const [rel, recorded] of Object.entries(files)) {
      count += 1;
      const installed = path.join(skillsDir, skill, rel);
      if (!existsSync(installed)) {
        missing.push(`${skill}/${rel}`);
        continue;
      }
      const installedHash = sha256File(installed);
      const source = path.join(sourceDir, skill, rel);
      const sourceHash = existsSync(source) ? sha256File(source) : null;
      if (installedHash !== recorded) edited.push(`${skill}/${rel}`);
      else if (sourceHash !== installedHash) outdated.push(`${skill}/${rel}`);
    }
    // Files the kit added to a managed skill since the last install.
    const sourceSkillDir = path.join(sourceDir, skill);
    if (existsSync(sourceSkillDir)) {
      for (const rel of listFilesRecursive(sourceSkillDir)) {
        if (!(rel in files)) outdated.push(`${skill}/${rel}`);
      }
    }
  }
  if (missing.length > 0) {
    return { name: 'skills', ok: false, detail: `missing managed files: ${missing.join(', ')}` };
  }
  if (outdated.length > 0) {
    return { name: 'skills', ok: false, detail: `outdated vs the kit: ${outdated.join(', ')} — run install` };
  }
  const note = edited.length > 0 ? `; locally edited (kept by design): ${edited.join(', ')}` : '';
  return {
    name: 'skills',
    ok: true,
    detail: `${Object.keys(manifest.skills).length} skills, ${count} files (kit ${manifest.kitVersion}) in ${skillsDir}${note}`
  };
}
```

`listFilesRecursive` returns paths with the OS separator; manifest keys use `/`. On Linux they coincide; normalize anyway: `for (const rel of listFilesRecursive(sourceSkillDir).map((p) => p.split(path.sep).join('/')))`.

- [ ] **Step 5: Run tests and typecheck**

Run: `cd packages/cli && npm test 2>&1 | tail -8 && npx tsc --noEmit`
Expected: all pass (previous 75 + 4 new), typecheck clean. If an existing claude/codex adapter test calls `adapter.preflight()` with no argument, pass `{ kitRoot, projectRoot, includeFigma: true }`.

- [ ] **Step 6: Commit**

```bash
git add packages/cli && git commit -m "CLI 0.5.0: preflight dry-runs the TOML merge and manifest, dangling in-root instruction links, verify compares installed skills with the kit"
```

---

### Task 2: `packages/evals` scaffold, schema and loader

**Files:**
- Create: `packages/evals/package.json`, `packages/evals/tsconfig.json`, `packages/evals/src/schema.ts`, `packages/evals/src/load.ts`, `packages/evals/src/types.ts`
- Modify: root `package.json` (scripts), `.gitignore`
- Test: `packages/evals/tests/schema.test.ts`

**Interfaces:**
- Produces (`schema.ts`): `CATEGORIES`, `HOSTS`, `type Category`, `type HostId`, `AssertionSchema`, `type Assertion`, `ScenarioSchema`, `type Scenario`, `FigmaFixtureSchema`, `type FigmaFixture`.
- Produces (`load.ts`): `interface EvalsLayout { evalsDir; scenariosDir; fixturesDir; figmaDir }`, `evalsLayout(evalsDir: string): EvalsLayout`, `loadFigmaFixture(file: string): FigmaFixture`, `loadScenarios(layout: EvalsLayout): Scenario[]`.
- Produces (`types.ts`): `ToolCall { tool: string; args: Record<string, unknown>; ok: boolean }`, `Usage { inputTokens?: number; outputTokens?: number; costUsd?: number }`, `ParsedTranscript { toolCalls: ToolCall[]; finalText: string; usage?: Usage; model?: string; error?: string }`, `RunRecord extends ParsedTranscript { host: HostId; durationMs: number; exitCode: number | null; timedOut: boolean; stderrTail: string }`.

- [ ] **Step 1: Package files**

`packages/evals/package.json`:
```json
{
  "name": "@frontend-agent-kit/evals",
  "version": "0.5.0",
  "private": true,
  "type": "module",
  "bin": { "frontend-agent-bench": "bin/bench.mjs" },
  "scripts": {
    "test": "node --import tsx --test tests/*.test.ts",
    "typecheck": "tsc --noEmit",
    "render-figma-assets": "tsx scripts/render-figma-assets.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "tsx": "^4.19.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/pngjs": "^6.0.5",
    "playwright": "^1.47.0",
    "pngjs": "^7.0.0",
    "typescript": "^5.6.0"
  }
}
```

`packages/evals/tsconfig.json`: copy of `packages/cli/tsconfig.json` with `"include": ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.ts"]`.

Root `package.json` scripts, add:
```json
    "test": "npm test --workspaces --if-present",
    "bench": "node packages/evals/bin/bench.mjs",
    "evals:validate": "node packages/evals/bin/bench.mjs --validate"
```

`.gitignore`, add line `evals/results/`.

Run: `npm install` (root). Expected: links `node_modules/@frontend-agent-kit/evals`.

- [ ] **Step 2: Write the failing test** — `packages/evals/tests/schema.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScenarioSchema, AssertionSchema } from '../src/schema.ts';
import { evalsLayout, loadScenarios } from '../src/load.ts';

const base = {
  id: 'demo', category: 'base', title: 'Demo', fixture: 'app', figma: 'design', prompt: 'do it',
  expected: [{ type: 'file_exists', path: 'index.html' }]
};

test('a minimal scenario parses with defaults', () => {
  const s = ScenarioSchema.parse(base);
  assert.equal(s.timeoutSec, 900);
  assert.deepEqual(s.forbidden, []);
});

test('assertions reject path traversal, absolute paths, bad regex, g flag and malformed tool names', () => {
  const bad = [
    { type: 'file_exists', path: '../etc/passwd' },
    { type: 'file_exists', path: '/etc/passwd' },
    { type: 'file_matches', glob: 'a//b', pattern: 'x' },
    { type: 'file_matches', glob: '**/*.html', pattern: '(' },
    { type: 'output_matches', pattern: 'x', flags: 'g' },
    { type: 'output_matches', pattern: 'x'.repeat(301) },
    { type: 'tool_called', tool: 'no-slash' },
    { type: 'tool_called', tool: 'a/b', extra: 1 }
  ];
  for (const a of bad) assert.equal(AssertionSchema.safeParse(a).success, false, JSON.stringify(a));
  assert.equal(AssertionSchema.safeParse({ type: 'tool_called', tool: 'figma/get_design_context', args: { nodeId: '^1[:-]2$' } }).success, true);
});

test('loadScenarios reports every problem at once: id/file mismatch, missing fixture, missing figma, duplicate id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fak-evals-schema-'));
  try {
    const layout = evalsLayout(dir);
    mkdirSync(layout.scenariosDir, { recursive: true });
    mkdirSync(join(layout.fixturesDir, 'app'), { recursive: true });
    mkdirSync(layout.figmaDir, { recursive: true });
    writeFileSync(join(layout.figmaDir, 'design.json'), JSON.stringify({ fileKey: 'K', metadata: '<page/>', variables: {}, nodes: { '1:2': { name: 'Frame', designContext: 'x', screenshot: 'assets/missing.png' } } }));
    writeFileSync(join(layout.scenariosDir, 'demo.json'), JSON.stringify(base));
    writeFileSync(join(layout.scenariosDir, 'other.json'), JSON.stringify({ ...base, fixture: 'nope', figma: 'nope' }));
    assert.throws(() => loadScenarios(layout), (error: Error) => {
      assert.match(error.message, /design\.json: .*assets\/missing\.png does not exist/);
      assert.match(error.message, /other\.json: id "demo" must match the file name/);
      assert.match(error.message, /other\.json: fixture "nope" not found/);
      assert.match(error.message, /other\.json: figma "nope" not found/);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd packages/evals && npm test`
Expected: FAIL — cannot find `../src/schema.ts`.

- [ ] **Step 4: Implement**

`packages/evals/src/schema.ts`:
```ts
import { z } from 'zod';

export const CATEGORIES = ['base', 'stack', 'profile'] as const;
export const HOSTS = ['claude', 'codex'] as const;
export type Category = (typeof CATEGORIES)[number];
export type HostId = (typeof HOSTS)[number];

const NAME = /^[a-z0-9][a-z0-9-]*$/;
export const MAX_PATTERN_LENGTH = 300;

function isValidRegex(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

const relPath = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (p) => !p.startsWith('/') && !p.includes('\\') && !p.split('/').some((s) => s === '..' || s === ''),
    'must be a relative, "/"-separated path without ".." or empty segments'
  );
const flags = z.string().regex(/^[imsu]*$/, 'only the i, m, s and u flags are allowed').optional();
const pattern = z.string().min(1).max(MAX_PATTERN_LENGTH).refine(isValidRegex, 'invalid regular expression');
const description = z.string().max(200).optional();

export const AssertionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('tool_called'),
      tool: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'tool must be "<server>/<tool>"'),
      args: z.record(pattern).optional(),
      description
    })
    .strict(),
  z.object({ type: z.literal('output_matches'), pattern, flags, description }).strict(),
  z.object({ type: z.literal('file_matches'), glob: relPath, pattern, flags, description }).strict(),
  z.object({ type: z.literal('file_exists'), path: relPath, description }).strict()
]);
export type Assertion = z.infer<typeof AssertionSchema>;

export const ScenarioSchema = z
  .object({
    id: z.string().regex(NAME),
    category: z.enum(CATEGORIES),
    title: z.string().min(1).max(120),
    fixture: z.string().regex(NAME),
    figma: z.string().regex(NAME),
    profile: z.enum(['pixel-perfect', 'standard', 'relaxed']).optional(),
    prompt: z.string().min(1).max(4000),
    timeoutSec: z.number().int().min(60).max(3600).default(900),
    expected: z.array(AssertionSchema).min(1),
    forbidden: z.array(AssertionSchema).default([])
  })
  .strict();
export type Scenario = z.infer<typeof ScenarioSchema>;

const FigmaNodeSchema = z
  .object({
    name: z.string().min(1),
    designContext: z.string().optional(),
    tooLarge: z.boolean().optional(),
    metadata: z.string().optional(),
    screenshot: relPath.optional(),
    assets: z.record(z.string().regex(/^[A-Za-z0-9._-]+$/), relPath).optional()
  })
  .strict();

export const FigmaFixtureSchema = z
  .object({
    fileKey: z.string().min(1),
    metadata: z.string().min(1),
    variables: z.record(z.string()),
    nodes: z.record(z.string().regex(/^\d+:\d+$/), FigmaNodeSchema)
  })
  .strict();
export type FigmaFixture = z.infer<typeof FigmaFixtureSchema>;
```

`packages/evals/src/types.ts`:
```ts
import type { HostId } from './schema.js';

export interface ToolCall {
  /** "<server>/<tool>", "skill/<name>", "reference/<name>" or "builtin/<name>". */
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface ParsedTranscript {
  toolCalls: ToolCall[];
  finalText: string;
  usage?: Usage;
  model?: string;
  /** Set when the transcript shows the run did not finish cleanly. */
  error?: string;
}

export interface RunRecord extends ParsedTranscript {
  host: HostId;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
  stderrTail: string;
}
```

`packages/evals/src/load.ts`:
```ts
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ZodError } from 'zod';
import { FigmaFixtureSchema, ScenarioSchema, type FigmaFixture, type Scenario } from './schema.js';

export interface EvalsLayout {
  evalsDir: string;
  scenariosDir: string;
  fixturesDir: string;
  figmaDir: string;
}

export function evalsLayout(evalsDir: string): EvalsLayout {
  return {
    evalsDir,
    scenariosDir: path.join(evalsDir, 'scenarios'),
    fixturesDir: path.join(evalsDir, 'fixtures'),
    figmaDir: path.join(evalsDir, 'figma')
  };
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${path.basename(file)}: invalid JSON: ${(error as Error).message}`);
  }
}

function formatZod(file: string, error: ZodError): string {
  return error.issues.map((issue) => `${path.basename(file)}: ${issue.path.join('.') || '(root)'}: ${issue.message}`).join('\n- ');
}

export function loadFigmaFixture(file: string): FigmaFixture {
  const parsed = FigmaFixtureSchema.safeParse(readJson(file));
  if (!parsed.success) throw new Error(formatZod(file, parsed.error));
  const dir = path.dirname(file);
  for (const [id, node] of Object.entries(parsed.data.nodes)) {
    const refs = [node.screenshot, ...Object.values(node.assets ?? {})].filter((ref): ref is string => !!ref);
    for (const ref of refs) {
      if (!existsSync(path.join(dir, ref))) {
        throw new Error(`${path.basename(file)}: node ${id}: ${ref} does not exist`);
      }
    }
  }
  return parsed.data;
}

export function loadScenarios(layout: EvalsLayout): Scenario[] {
  const errors: string[] = [];
  const scenarios: Scenario[] = [];
  const seen = new Set<string>();
  const figmaOk = new Map<string, boolean>();
  const files = readdirSync(layout.scenariosDir).filter((name) => name.endsWith('.json')).sort();

  for (const name of files) {
    const file = path.join(layout.scenariosDir, name);
    let raw: unknown;
    try {
      raw = readJson(file);
    } catch (error) {
      errors.push((error as Error).message);
      continue;
    }
    const parsed = ScenarioSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(formatZod(file, parsed.error));
      continue;
    }
    const scenario = parsed.data;
    if (scenario.id !== name.replace(/\.json$/, '')) errors.push(`${name}: id "${scenario.id}" must match the file name`);
    if (seen.has(scenario.id)) errors.push(`${name}: duplicate id "${scenario.id}"`);
    seen.add(scenario.id);
    const fixtureDir = path.join(layout.fixturesDir, scenario.fixture);
    if (!existsSync(fixtureDir) || !statSync(fixtureDir).isDirectory()) {
      errors.push(`${name}: fixture "${scenario.fixture}" not found in ${layout.fixturesDir}`);
    }
    const figmaFile = path.join(layout.figmaDir, `${scenario.figma}.json`);
    if (!existsSync(figmaFile)) {
      errors.push(`${name}: figma "${scenario.figma}" not found in ${layout.figmaDir}`);
    } else if (!figmaOk.has(scenario.figma)) {
      try {
        loadFigmaFixture(figmaFile);
        figmaOk.set(scenario.figma, true);
      } catch (error) {
        figmaOk.set(scenario.figma, false);
        errors.push((error as Error).message);
      }
    }
    scenarios.push(scenario);
  }
  if (errors.length > 0) throw new Error(`invalid eval scenarios:\n- ${errors.join('\n- ')}`);
  return scenarios;
}
```

- [ ] **Step 5: Run tests**

Run: `cd packages/evals && npm test && npx tsc --noEmit`
Expected: 3 tests pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore packages/evals && git commit -m "evals: package scaffold, scenario/assertion/figma schemas and loader"
```

---

### Task 3: Transcript parsers (Claude stream-json, Codex exec --json)

**Files:**
- Create: `packages/evals/src/transcript/skill-reads.ts`, `packages/evals/src/transcript/claude.ts`, `packages/evals/src/transcript/codex.ts`
- Create: `packages/evals/tests/data/claude-sample.jsonl`, `packages/evals/tests/data/codex-sample.jsonl`
- Test: `packages/evals/tests/transcript.test.ts`

**Interfaces:**
- Consumes: `ToolCall`, `ParsedTranscript` (Task 2).
- Produces: `parseClaudeTranscript(text: string): ParsedTranscript`, `parseCodexTranscript(text: string): ParsedTranscript`, `skillReadsIn(text: string): ToolCall[]`.

- [ ] **Step 1: Sample transcripts** (shapes recorded from real runs on 2026-09-24, ids/paths shortened)

`packages/evals/tests/data/claude-sample.jsonl`:
```
{"type":"system","subtype":"init","model":"claude-opus-5-5","mcp_servers":[{"name":"frontend-agent","status":"connected"}]}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Skill","input":{"skill":"figma-to-code"}}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t2","name":"Read","input":{"file_path":"/tmp/fak-bench-x/.claude/skills/figma-to-code/references/react.md"}}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t3","name":"ToolSearch","input":{"query":"select:mcp__figma__get_design_context"}}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t4","name":"mcp__figma__get_design_context","input":{"nodeId":"1:2"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t4","content":"ok"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t5","name":"mcp__frontend-agent__inspect_dom","input":{"url":"file:///nonexistent","selector":"body"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t5","is_error":true,"content":"host not allowed"}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"Done."}]}}
{"type":"result","subtype":"success","is_error":false,"result":"Implemented. VEREDITO: PASS","duration_ms":5936,"total_cost_usd":0.06,"usage":{"input_tokens":6,"cache_creation_input_tokens":100,"cache_read_input_tokens":1000,"output_tokens":42}}
```

`packages/evals/tests/data/codex-sample.jsonl`:
```
{"type":"thread.started","thread_id":"01a0"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Reading the skill."}}
{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"bash -lc \"sed -n '1,200p' .agents/skills/figma-to-code/SKILL.md\"","aggregated_output":"...","exit_code":0,"status":"completed"}}
{"type":"item.started","item":{"id":"item_2","type":"mcp_tool_call","server":"figma","tool":"get_design_context","arguments":{"nodeId":"1:2"},"result":null,"error":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_2","type":"mcp_tool_call","server":"figma","tool":"get_design_context","arguments":{"nodeId":"1:2"},"result":{"content":[]},"error":null,"status":"completed"}}
{"type":"item.completed","item":{"id":"item_3","type":"mcp_tool_call","server":"frontend-agent","tool":"inspect_dom","arguments":{"selector":"body","url":"file:///nonexistent"},"result":null,"error":{"message":"MCP tool call requires approval, but approval policy is never"},"status":"failed"}}
{"type":"item.completed","item":{"id":"item_4","type":"file_change","changes":[{"path":"pages/pricing.html","kind":"add"}],"status":"completed"}}
{"type":"item.completed","item":{"id":"item_5","type":"agent_message","text":"DONE\nVEREDITO: FAIL"}}
{"type":"turn.completed","usage":{"input_tokens":41896,"cached_input_tokens":39040,"output_tokens":115,"reasoning_output_tokens":10}}
```

- [ ] **Step 2: Write the failing test** — `packages/evals/tests/transcript.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseClaudeTranscript } from '../src/transcript/claude.ts';
import { parseCodexTranscript } from '../src/transcript/codex.ts';

const data = (name: string) => readFileSync(new URL(`./data/${name}`, import.meta.url), 'utf8');
const tools = (calls: { tool: string }[]) => calls.map((c) => c.tool);

test('claude: MCP names normalized, Skill and reference reads detected, errors marked, result/usage read', () => {
  const t = parseClaudeTranscript(data('claude-sample.jsonl'));
  assert.equal(t.error, undefined);
  assert.equal(t.model, 'claude-opus-5-5');
  assert.deepEqual(tools(t.toolCalls), [
    'skill/figma-to-code',
    'builtin/Read',
    'reference/react',
    'builtin/ToolSearch',
    'figma/get_design_context',
    'frontend-agent/inspect_dom'
  ]);
  assert.deepEqual(t.toolCalls[4].args, { nodeId: '1:2' });
  assert.equal(t.toolCalls[4].ok, true);
  assert.equal(t.toolCalls[5].ok, false);
  assert.equal(t.finalText, 'Implemented. VEREDITO: PASS');
  assert.deepEqual(t.usage, { inputTokens: 1106, outputTokens: 42, costUsd: 0.06 });
});

test('claude: a transcript without a result event (killed) is an error', () => {
  const lines = data('claude-sample.jsonl').trim().split('\n');
  const t = parseClaudeTranscript(lines.slice(0, -1).join('\n'));
  assert.match(t.error ?? '', /no result event/);
});

test('claude: a truncated last line is an error, and an error result is an error', () => {
  const lines = data('claude-sample.jsonl').trim().split('\n');
  assert.match(parseClaudeTranscript([...lines.slice(0, 3), '{"type":"assis'].join('\n')).error ?? '', /line 4 is not JSON/);
  const failed = lines.slice(0, -1).concat('{"type":"result","subtype":"error_max_turns","is_error":true,"result":""}');
  assert.match(parseClaudeTranscript(failed.join('\n')).error ?? '', /error_max_turns/);
});

test('codex: MCP calls from completed items only, shell skill reads, final message, usage', () => {
  const t = parseCodexTranscript(data('codex-sample.jsonl'));
  assert.equal(t.error, undefined);
  assert.deepEqual(tools(t.toolCalls), [
    'builtin/shell',
    'skill/figma-to-code',
    'figma/get_design_context',
    'frontend-agent/inspect_dom',
    'builtin/file_change'
  ]);
  assert.equal(t.toolCalls[2].ok, true);
  assert.equal(t.toolCalls[3].ok, false);
  assert.equal(t.finalText, 'DONE\nVEREDITO: FAIL');
  assert.deepEqual(t.usage, { inputTokens: 41896, outputTokens: 125 });
});

test('codex: missing turn.completed, turn.failed and error events are errors', () => {
  const lines = data('codex-sample.jsonl').trim().split('\n');
  assert.match(parseCodexTranscript(lines.slice(0, -1).join('\n')).error ?? '', /no turn\.completed/);
  assert.match(parseCodexTranscript(lines.slice(0, -1).concat('{"type":"turn.failed","error":{"message":"quota"}}').join('\n')).error ?? '', /quota/);
  assert.match(parseCodexTranscript('{"type":"error","message":"not logged in"}').error ?? '', /not logged in/);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd packages/evals && npm test`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

`packages/evals/src/transcript/skill-reads.ts`:
```ts
import type { ToolCall } from '../types.js';

// A kit skill file read through a host's file tool or a shell command, e.g.
// "/tmp/ws/.claude/skills/figma-to-code/SKILL.md" or "sed -n '1,200p' .agents/skills/x/references/react.md".
const SKILL_FILE = /(?:^|[\/\s'"=])\.(?:claude|agents)\/skills\/([A-Za-z0-9._-]+)\/(?:SKILL\.md|references\/([A-Za-z0-9._-]+)\.md)/g;

export function skillReadsIn(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const match of text.matchAll(SKILL_FILE)) {
    const tool = match[2] ? `reference/${match[2]}` : `skill/${match[1]}`;
    calls.push({ tool, args: {}, ok: true });
  }
  return calls;
}
```

`packages/evals/src/transcript/claude.ts`:
```ts
import type { ParsedTranscript, ToolCall, Usage } from '../types.js';
import { skillReadsIn } from './skill-reads.js';

const isObject = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value);
const SKILL_NAME = /^[A-Za-z0-9._-]+$/;

function toolCallsFor(name: string, input: Record<string, unknown>): ToolCall[] {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return [{ tool: `${mcp[1]}/${mcp[2]}`, args: input, ok: true }];
  if (name === 'Skill') {
    const skill = String(input.skill ?? input.command ?? '').split(':').pop() ?? '';
    return SKILL_NAME.test(skill) ? [{ tool: `skill/${skill}`, args: input, ok: true }] : [];
  }
  const calls: ToolCall[] = [{ tool: `builtin/${name}`, args: input, ok: true }];
  if (name === 'Read' && typeof input.file_path === 'string') calls.push(...skillReadsIn(input.file_path));
  return calls;
}

export function parseClaudeTranscript(text: string): ParsedTranscript {
  const toolCalls: ToolCall[] = [];
  const byId = new Map<string, ToolCall[]>();
  let finalText = '';
  let usage: Usage | undefined;
  let model: string | undefined;
  let error: string | undefined;
  let sawResult = false;

  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  for (const [index, line] of lines.entries()) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return { toolCalls, finalText, usage, model, error: `claude transcript line ${index + 1} is not JSON (truncated?)` };
    }
    if (!isObject(event)) continue;
    if (event.type === 'system' && event.subtype === 'init' && typeof event.model === 'string') model = event.model;
    const content = event.message?.content;
    if (event.type === 'assistant' && Array.isArray(content)) {
      for (const block of content) {
        if (!isObject(block) || block.type !== 'tool_use' || typeof block.name !== 'string') continue;
        const calls = toolCallsFor(block.name, isObject(block.input) ? block.input : {});
        toolCalls.push(...calls);
        if (typeof block.id === 'string') byId.set(block.id, calls);
      }
    }
    if (event.type === 'user' && Array.isArray(content)) {
      for (const block of content) {
        if (isObject(block) && block.type === 'tool_result' && block.is_error === true) {
          for (const call of byId.get(String(block.tool_use_id)) ?? []) call.ok = false;
        }
      }
    }
    if (event.type === 'result') {
      sawResult = true;
      finalText = typeof event.result === 'string' ? event.result : '';
      const u = isObject(event.usage) ? event.usage : {};
      const input = [u.input_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens]
        .filter((n): n is number => typeof n === 'number')
        .reduce((a, b) => a + b, 0);
      usage = {
        inputTokens: input,
        outputTokens: typeof u.output_tokens === 'number' ? u.output_tokens : undefined,
        costUsd: typeof event.total_cost_usd === 'number' ? event.total_cost_usd : undefined
      };
      if (event.is_error === true || event.subtype !== 'success') error = `claude finished with ${event.subtype ?? 'an error'}`;
    }
  }
  if (!sawResult) error ??= 'claude transcript has no result event (killed or truncated)';
  return { toolCalls, finalText, usage, model, error };
}
```

`packages/evals/src/transcript/codex.ts`:
```ts
import type { ParsedTranscript, ToolCall, Usage } from '../types.js';
import { skillReadsIn } from './skill-reads.js';

const isObject = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseCodexTranscript(text: string): ParsedTranscript {
  const toolCalls: ToolCall[] = [];
  let finalText = '';
  let usage: Usage | undefined;
  let error: string | undefined;
  let completed = false;

  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  for (const [index, line] of lines.entries()) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return { toolCalls, finalText, usage, error: `codex transcript line ${index + 1} is not JSON (truncated?)` };
    }
    if (!isObject(event)) continue;
    if (event.type === 'item.completed' && isObject(event.item)) {
      const item = event.item;
      if (item.type === 'mcp_tool_call' && typeof item.server === 'string' && typeof item.tool === 'string') {
        toolCalls.push({
          tool: `${item.server}/${item.tool}`,
          args: isObject(item.arguments) ? item.arguments : {},
          ok: item.status === 'completed' && !item.error
        });
      } else if (item.type === 'command_execution') {
        const command = typeof item.command === 'string' ? item.command : '';
        toolCalls.push({ tool: 'builtin/shell', args: { command }, ok: item.exit_code === 0 });
        toolCalls.push(...skillReadsIn(command));
      } else if (item.type === 'file_change') {
        toolCalls.push({ tool: 'builtin/file_change', args: { changes: item.changes }, ok: item.status === 'completed' });
      } else if (item.type === 'agent_message' && typeof item.text === 'string') {
        finalText = item.text;
      }
    } else if (event.type === 'turn.completed') {
      completed = true;
      const u = isObject(event.usage) ? event.usage : {};
      const out = [u.output_tokens, u.reasoning_output_tokens].filter((n): n is number => typeof n === 'number');
      usage = {
        inputTokens: typeof u.input_tokens === 'number' ? u.input_tokens : undefined,
        outputTokens: out.length ? out.reduce((a, b) => a + b, 0) : undefined
      };
    } else if (event.type === 'turn.failed') {
      error = `codex turn failed: ${event.error?.message ?? 'unknown error'}`;
    } else if (event.type === 'error') {
      error = `codex error: ${event.message ?? 'unknown error'}`;
    }
  }
  if (!completed) error ??= 'codex transcript has no turn.completed event (killed or truncated)';
  return { toolCalls, finalText, usage, error };
}
```

- [ ] **Step 5: Run tests**

Run: `cd packages/evals && npm test && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/evals && git commit -m "evals: Claude/Codex transcript parsers with normalized tool names and truncation detection"
```

---

### Task 4: Grader

**Files:**
- Create: `packages/evals/src/grade.ts`
- Test: `packages/evals/tests/grade.test.ts`

**Interfaces:**
- Consumes: `Scenario`, `Assertion` (Task 2), `RunRecord` (Task 2).
- Produces: `globToRegExp(glob: string): RegExp`, `listWorkspaceFiles(root: string): string[]`, `interface AssertionResult { assertion: Assertion; satisfied: boolean; detail: string }`, `type Verdict = 'pass' | 'fail' | 'error'`, `interface GradeResult { verdict: Verdict; expected: AssertionResult[]; forbidden: AssertionResult[]; error?: string }`, `grade(scenario: Scenario, record: RunRecord, workspaceDir: string): GradeResult`.

- [ ] **Step 1: Write the failing test** — `packages/evals/tests/grade.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { grade, globToRegExp, listWorkspaceFiles } from '../src/grade.ts';
import { ScenarioSchema } from '../src/schema.ts';
import type { RunRecord } from '../src/types.ts';

function record(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    host: 'claude', durationMs: 1, exitCode: 0, timedOut: false, stderrTail: '',
    toolCalls: [{ tool: 'figma/get_design_context', args: { nodeId: '1:2' }, ok: true }],
    finalText: 'All good. VEREDITO: PASS',
    ...overrides
  };
}

function scenario(expected: unknown[], forbidden: unknown[] = []) {
  return ScenarioSchema.parse({ id: 's', category: 'base', title: 'S', fixture: 'f', figma: 'g', prompt: 'p', expected, forbidden });
}

function withWs(fn: (ws: string) => void) {
  const ws = mkdtempSync(join(tmpdir(), 'fak-grade-'));
  try {
    fn(ws);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
}

test('globToRegExp supports **, *, ? and {a,b}', () => {
  assert.ok(globToRegExp('src/**/PricingCard.{tsx,jsx}').test('src/components/PricingCard.tsx'));
  assert.ok(globToRegExp('src/**/PricingCard.{tsx,jsx}').test('src/PricingCard.jsx'));
  assert.ok(!globToRegExp('src/*.ts').test('src/a/b.ts'));
  assert.ok(globToRegExp('**/*pricing*').test('pages/pricing.html'));
  assert.ok(globToRegExp('a?.css').test('ab.css'));
});

test('pass when all expected hold and no forbidden does; fail otherwise, with details', () => {
  withWs((ws) => {
    mkdirSync(join(ws, 'pages'));
    writeFileSync(join(ws, 'pages', 'pricing.html'), '<link href="../styles/tokens.css">');
    const s = scenario(
      [
        { type: 'tool_called', tool: 'figma/get_design_context', args: { nodeId: '^1[:-]2$' } },
        { type: 'output_matches', pattern: 'veredito:\\s*pass', flags: 'i' },
        { type: 'file_matches', glob: 'pages/*.html', pattern: 'tokens\\.css' },
        { type: 'file_exists', path: 'pages/pricing.html' }
      ],
      [{ type: 'file_matches', glob: 'pages/*.html', pattern: '#4F46E5' }]
    );
    assert.equal(grade(s, record(), ws).verdict, 'pass');

    writeFileSync(join(ws, 'pages', 'pricing.html'), '<style>a{color:#4F46E5}</style>');
    const failed = grade(s, record({ toolCalls: [] }), ws);
    assert.equal(failed.verdict, 'fail');
    assert.equal(failed.expected[0].satisfied, false);
    assert.equal(failed.expected[2].satisfied, false);
    assert.match(failed.expected[2].detail, /1 file\(s\) matched the glob, none matched the pattern/);
    assert.equal(failed.forbidden[0].satisfied, true);
    assert.match(failed.forbidden[0].detail, /pages\/pricing\.html/);
  });
});

test('timeout, non-zero exit and a transcript error are "error" even when every assertion holds', () => {
  withWs((ws) => {
    const s = scenario([{ type: 'output_matches', pattern: 'PASS' }]);
    assert.equal(grade(s, record({ timedOut: true, error: 'no result event' }), ws).verdict, 'error');
    assert.match(grade(s, record({ timedOut: true }), ws).error ?? '', /timed out after 900s/);
    assert.match(grade(s, record({ exitCode: 3 }), ws).error ?? '', /exited with code 3/);
    assert.match(grade(s, record({ error: 'claude transcript has no result event' }), ws).error ?? '', /no result event/);
  });
});

test('symlinks in the workspace are never followed and kit/host dirs are ignored', () => {
  withWs((ws) => {
    const outside = mkdtempSync(join(tmpdir(), 'fak-grade-outside-'));
    try {
      writeFileSync(join(outside, 'secret.html'), 'SECRET');
      symlinkSync(join(outside, 'secret.html'), join(ws, 'leak.html'));
      symlinkSync(outside, join(ws, 'linked-dir'));
      mkdirSync(join(ws, '.claude', 'skills'), { recursive: true });
      writeFileSync(join(ws, '.claude', 'skills', 'x.html'), 'SECRET');
      assert.deepEqual(listWorkspaceFiles(ws), []);
      const s = scenario([
        { type: 'file_matches', glob: '**/*.html', pattern: 'SECRET' },
        { type: 'file_exists', path: 'leak.html' }
      ]);
      const result = grade(s, record(), ws);
      assert.equal(result.expected[0].satisfied, false);
      assert.equal(result.expected[1].satisfied, false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/evals && npm test`
Expected: FAIL — `../src/grade.ts` not found.

- [ ] **Step 3: Implement** — `packages/evals/src/grade.ts`

```ts
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Assertion, Scenario } from './schema.js';
import type { RunRecord, ToolCall } from './types.js';

/** Directories written by the kit install / hosts, never part of what the agent produced. */
export const IGNORED_DIRS = new Set(['node_modules', '.git', '.claude', '.agents', '.codex', '.frontend-agent']);
const MAX_FILE_BYTES = 1_000_000;

export interface AssertionResult {
  assertion: Assertion;
  satisfied: boolean;
  detail: string;
}

export type Verdict = 'pass' | 'fail' | 'error';

export interface GradeResult {
  verdict: Verdict;
  expected: AssertionResult[];
  forbidden: AssertionResult[];
  error?: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Minimal glob: "**" (any depth), "*" and "?" (within a segment), "{a,b}" (literal alternatives). */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) throw new Error(`unclosed "{" in glob "${glob}"`);
      re += `(?:${glob.slice(i + 1, end).split(',').map(escapeRe).join('|')})`;
      i = end;
    } else {
      re += escapeRe(c);
    }
  }
  return new RegExp(`^${re}$`);
}

/** Regular files under `root` as "/"-separated relative paths. Symlinks are skipped, never followed. */
export function listWorkspaceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) walk(path.join(dir, entry.name), childRel);
      } else if (entry.isFile()) {
        out.push(childRel);
      }
    }
  };
  walk(root, '');
  return out.sort();
}

function argsMatch(call: ToolCall, args: Record<string, string> | undefined): boolean {
  if (!args) return true;
  return Object.entries(args).every(([key, pattern]) => {
    const value = call.args[key];
    const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
    return new RegExp(pattern).test(text);
  });
}

function evaluate(assertion: Assertion, record: RunRecord, workspaceDir: string, files: () => string[]): AssertionResult {
  switch (assertion.type) {
    case 'tool_called': {
      const hits = record.toolCalls.filter((call) => call.tool === assertion.tool && argsMatch(call, assertion.args));
      return { assertion, satisfied: hits.length > 0, detail: `${hits.length} matching call(s) of ${assertion.tool}` };
    }
    case 'output_matches': {
      const satisfied = new RegExp(assertion.pattern, assertion.flags).test(record.finalText);
      return { assertion, satisfied, detail: satisfied ? 'final answer matched' : 'final answer did not match' };
    }
    case 'file_matches': {
      const globRe = globToRegExp(assertion.glob);
      const pattern = new RegExp(assertion.pattern, assertion.flags);
      const candidates = files().filter((file) => globRe.test(file));
      const hit = candidates.find((file) => {
        const full = path.join(workspaceDir, file);
        return lstatSync(full).size <= MAX_FILE_BYTES && pattern.test(readFileSync(full, 'utf8'));
      });
      return {
        assertion,
        satisfied: hit !== undefined,
        detail: hit ? `matched in ${hit}` : `${candidates.length} file(s) matched the glob, none matched the pattern`
      };
    }
    case 'file_exists': {
      let satisfied = false;
      try {
        const stat = lstatSync(path.join(workspaceDir, assertion.path));
        satisfied = stat.isFile() || stat.isDirectory();
      } catch {
        satisfied = false;
      }
      return { assertion, satisfied, detail: satisfied ? `${assertion.path} exists` : `${assertion.path} does not exist (or is a symlink)` };
    }
  }
}

export function grade(scenario: Scenario, record: RunRecord, workspaceDir: string): GradeResult {
  let cached: string[] | undefined;
  const files = () => (cached ??= listWorkspaceFiles(workspaceDir));
  const expected = scenario.expected.map((a) => evaluate(a, record, workspaceDir, files));
  const forbidden = scenario.forbidden.map((a) => evaluate(a, record, workspaceDir, files));
  const hostError = record.timedOut
    ? `timed out after ${scenario.timeoutSec}s`
    : record.exitCode !== 0
      ? `host exited with code ${record.exitCode}${record.error ? ` (${record.error})` : ''}`
      : record.error;
  if (hostError) return { verdict: 'error', expected, forbidden, error: hostError };
  const ok = expected.every((r) => r.satisfied) && forbidden.every((r) => !r.satisfied);
  return { verdict: ok ? 'pass' : 'fail', expected, forbidden };
}
```

Note the timeout test builds the record with a 900 s default scenario; bench (Task 8) passes the real timeout into the scenario it grades.

- [ ] **Step 4: Run tests**

Run: `cd packages/evals && npm test && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/evals && git commit -m "evals: deterministic grader (tool_called, output_matches, file_matches, file_exists) that never follows symlinks"
```

---

### Task 5: Figma MCP mock

**Files:**
- Create: `packages/evals/src/figma-mock/server.ts`, `packages/evals/src/figma-mock/main.ts`
- Create: `packages/evals/tests/data/figma/mini.json`, `packages/evals/tests/data/figma/assets/frame.png`, `packages/evals/tests/data/figma/assets/logo.png`
- Test: `packages/evals/tests/figma-mock.test.ts`

**Interfaces:**
- Consumes: `loadFigmaFixture`, `FigmaFixture` (Task 2).
- Produces: `createFigmaMock(fixture: FigmaFixture, fixtureDir: string, outputRoot: string): McpServer`, `normalizeNodeId(id: string): string`; entry `src/figma-mock/main.ts` reads env `FIGMA_MOCK_FIXTURE` (absolute JSON path) and `FIGMA_MOCK_OUTPUT_ROOT` (workspace).

- [ ] **Step 1: Test data**

Create the two PNGs (1×1 px) once:
```bash
cd packages/evals && mkdir -p tests/data/figma/assets && node -e "
const { PNG } = require('pngjs'); const fs = require('fs');
for (const f of ['frame', 'logo']) { const p = new PNG({ width: 1, height: 1 }); p.data.fill(255); fs.writeFileSync('tests/data/figma/assets/' + f + '.png', PNG.sync.write(p)); }"
```

`packages/evals/tests/data/figma/mini.json`:
```json
{
  "fileKey": "MINI01",
  "metadata": "<canvas id=\"0:1\" name=\"Page 1\"><frame id=\"1:2\" name=\"Frame\" /><frame id=\"9:9\" name=\"Huge\" /></canvas>",
  "variables": { "color/primary": "#4F46E5" },
  "nodes": {
    "1:2": { "name": "Frame", "designContext": "<div class=\"frame\">Hello</div>", "screenshot": "assets/frame.png", "assets": { "logo.png": "assets/logo.png" } },
    "9:9": { "name": "Huge", "tooLarge": true }
  }
}
```

- [ ] **Step 2: Write the failing test** — `packages/evals/tests/figma-mock.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const pkg = join(here, '..');
const tsx = join(pkg, '..', '..', 'node_modules', '.bin', 'tsx');

async function withMock(fn: (client: Client, ws: string) => Promise<void>) {
  const ws = mkdtempSync(join(tmpdir(), 'fak-figma-'));
  const transport = new StdioClientTransport({
    command: tsx,
    args: [join(pkg, 'src', 'figma-mock', 'main.ts')],
    env: { ...getDefaultEnvironment(), FIGMA_MOCK_FIXTURE: join(here, 'data', 'figma', 'mini.json'), FIGMA_MOCK_OUTPUT_ROOT: ws }
  });
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(transport);
  try {
    await fn(client, ws);
  } finally {
    await client.close();
    rmSync(ws, { recursive: true, force: true });
  }
}

const textOf = (r: any) => r.content.map((c: any) => c.text ?? '').join('');

test('lists the Figma tool names the skills use', async () => {
  await withMock(async (client) => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['download_assets', 'get_design_context', 'get_metadata', 'get_screenshot', 'get_variable_defs']);
  });
});

test('serves recorded data; accepts URL-style node ids; errors on unknown and too-large nodes', async () => {
  await withMock(async (client) => {
    assert.match(textOf(await client.callTool({ name: 'get_metadata', arguments: {} })), /Page 1/);
    assert.match(textOf(await client.callTool({ name: 'get_design_context', arguments: { nodeId: '1-2' } })), /class="frame"/);
    assert.match(textOf(await client.callTool({ name: 'get_variable_defs', arguments: { nodeId: '1:2' } })), /#4F46E5/);
    const shot: any = await client.callTool({ name: 'get_screenshot', arguments: { nodeId: '1:2' } });
    assert.equal(shot.content[0].type, 'image');
    assert.equal(shot.content[0].mimeType, 'image/png');
    const unknown: any = await client.callTool({ name: 'get_design_context', arguments: { nodeId: '5:5' } });
    assert.equal(unknown.isError, true);
    assert.match(textOf(unknown), /not found/);
    const huge: any = await client.callTool({ name: 'get_design_context', arguments: { nodeId: '9:9' } });
    assert.equal(huge.isError, true);
    assert.match(textOf(huge), /too large.*get_metadata/);
  });
});

test('download_assets writes inside the workspace only', async () => {
  await withMock(async (client, ws) => {
    const ok: any = await client.callTool({ name: 'download_assets', arguments: { nodeId: '1:2', outputDir: 'assets/figma' } });
    assert.notEqual(ok.isError, true, textOf(ok));
    assert.ok(existsSync(join(ws, 'assets', 'figma', 'logo.png')));
    for (const outputDir of ['../escape', '/tmp/abs']) {
      const bad: any = await client.callTool({ name: 'download_assets', arguments: { nodeId: '1:2', outputDir } });
      assert.equal(bad.isError, true, outputDir);
    }
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd packages/evals && npm test`
Expected: FAIL (server entry missing → connection closed).

- [ ] **Step 4: Implement**

`packages/evals/src/figma-mock/server.ts`:
```ts
import { copyFileSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { FigmaFixture } from '../schema.js';

/** Figma URLs use "1-2", the API uses "1:2". */
export function normalizeNodeId(id: string): string {
  return id.trim().replace(/-/g, ':');
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function createFigmaMock(fixture: FigmaFixture, fixtureDir: string, outputRoot: string): McpServer {
  const server = new McpServer({ name: 'figma', version: '0.5.0' });
  const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
  const fail = (t: string) => ({ content: [{ type: 'text' as const, text: t }], isError: true });
  const node = (id: string) => fixture.nodes[normalizeNodeId(id)];
  const unknown = (id: string) => fail(`Node ${id} not found in file ${fixture.fileKey}. Use get_metadata to list the nodes.`);
  const common = {
    fileKey: z.string().optional(),
    clientLanguages: z.string().optional(),
    clientFrameworks: z.string().optional()
  };

  server.registerTool(
    'get_metadata',
    {
      description: 'XML outline of a Figma node (or of the current page when nodeId is omitted): ids, names, types, positions and sizes. Use it first on large files.',
      inputSchema: { ...common, nodeId: z.string().optional() }
    },
    async ({ nodeId }) => {
      if (!nodeId) return text(fixture.metadata);
      const n = node(nodeId);
      if (!n) return unknown(nodeId);
      return text(n.metadata ?? `<frame id="${normalizeNodeId(nodeId)}" name="${n.name}" />`);
    }
  );

  server.registerTool(
    'get_design_context',
    { description: 'Design context (reference UI code, layout, styles, tokens) for a Figma node.', inputSchema: { ...common, nodeId: z.string() } },
    async ({ nodeId }) => {
      const n = node(nodeId);
      if (!n) return unknown(nodeId);
      if (n.tooLarge || !n.designContext) {
        return fail(`The design context for node ${nodeId} ("${n.name}") is too large. Call get_metadata first and request design context for specific child nodes.`);
      }
      return text(n.designContext);
    }
  );

  server.registerTool(
    'get_variable_defs',
    { description: 'Variables (design tokens) used by a Figma node.', inputSchema: { ...common, nodeId: z.string().optional() } },
    async () => text(JSON.stringify(fixture.variables, null, 2))
  );

  server.registerTool(
    'get_screenshot',
    { description: 'PNG screenshot of a Figma node.', inputSchema: { ...common, nodeId: z.string() } },
    async ({ nodeId }) => {
      const n = node(nodeId);
      if (!n) return unknown(nodeId);
      if (!n.screenshot) return fail(`No screenshot available for node ${nodeId}.`);
      const data = readFileSync(path.join(fixtureDir, n.screenshot)).toString('base64');
      return { content: [{ type: 'image' as const, data, mimeType: 'image/png' }] };
    }
  );

  server.registerTool(
    'download_assets',
    {
      description: 'Download the image assets of a Figma node into a directory of the project (path relative to the project root).',
      inputSchema: { ...common, nodeId: z.string(), outputDir: z.string().min(1) }
    },
    async ({ nodeId, outputDir }) => {
      const n = node(nodeId);
      if (!n) return unknown(nodeId);
      const assets = Object.entries(n.assets ?? {});
      if (assets.length === 0) return fail(`Node ${nodeId} has no image assets.`);
      if (path.isAbsolute(outputDir)) return fail('outputDir must be a path relative to the project root.');
      const dest = path.resolve(outputRoot, outputDir);
      if (!isInside(outputRoot, dest)) return fail('outputDir must stay inside the project root.');
      mkdirSync(dest, { recursive: true });
      const realDest = realpathSync(dest);
      if (!isInside(outputRoot, realDest)) return fail('outputDir resolves outside the project root.');
      const written: string[] = [];
      for (const [fileName, src] of assets) {
        const target = path.join(realDest, fileName);
        try {
          if (lstatSync(target).isSymbolicLink()) return fail(`${path.relative(outputRoot, target)} is a symbolic link; refusing to write through it.`);
        } catch {
          // does not exist yet
        }
        copyFileSync(path.join(fixtureDir, src), target);
        written.push(path.relative(outputRoot, target));
      }
      return text(`Downloaded ${written.length} asset(s):\n${written.join('\n')}`);
    }
  );

  return server;
}
```

`packages/evals/src/figma-mock/main.ts`:
```ts
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadFigmaFixture } from '../load.js';
import { createFigmaMock } from './server.js';

const fixturePath = process.env.FIGMA_MOCK_FIXTURE;
const outputRoot = process.env.FIGMA_MOCK_OUTPUT_ROOT;
if (!fixturePath || !outputRoot) {
  process.stderr.write('figma-mock: FIGMA_MOCK_FIXTURE and FIGMA_MOCK_OUTPUT_ROOT are required\n');
  process.exit(1);
}
let server;
try {
  server = createFigmaMock(loadFigmaFixture(fixturePath), path.dirname(fixturePath), realpathSync(outputRoot));
} catch (error) {
  process.stderr.write(`figma-mock: ${(error as Error).message}\n`);
  process.exit(1);
}
await server.connect(new StdioServerTransport());
```

- [ ] **Step 5: Run tests**

Run: `cd packages/evals && npm test && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/evals && git commit -m "evals: Figma MCP mock serving recorded design data, workspace-confined download_assets"
```

---

### Task 6: Workspace copy and static server

**Files:**
- Create: `packages/evals/src/workspace.ts`, `packages/evals/src/static-server.ts`
- Test: `packages/evals/tests/workspace.test.ts`

**Interfaces:**
- Produces: `WORKSPACE_PREFIX = 'fak-bench-'`, `createWorkspace(fixtureDir: string, options?: { maxBytes?: number }): string` (realpath of the new dir), `removeWorkspace(dir: string): void`, `startStaticServer(rootDir: string): Promise<{ origin: string; close(): Promise<void> }>`.

- [ ] **Step 1: Write the failing test** — `packages/evals/tests/workspace.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspace, removeWorkspace } from '../src/workspace.ts';
import { startStaticServer } from '../src/static-server.ts';

function withFixture(fn: (fixture: string) => Promise<void> | void) {
  const fixture = mkdtempSync(join(tmpdir(), 'fak-fixture-'));
  return Promise.resolve(fn(fixture)).finally(() => rmSync(fixture, { recursive: true, force: true }));
}

test('copies the fixture into a fresh fak-bench-* dir and removes it', async () => {
  await withFixture((fixture) => {
    mkdirSync(join(fixture, 'pages'));
    writeFileSync(join(fixture, 'pages', 'a.html'), 'A');
    const ws = createWorkspace(fixture);
    assert.match(ws, /fak-bench-/);
    assert.equal(readFileSync(join(ws, 'pages', 'a.html'), 'utf8'), 'A');
    removeWorkspace(ws);
    assert.equal(existsSync(ws), false);
  });
});

test('refuses fixtures with symlinks or over the size limit; removeWorkspace refuses foreign dirs', async () => {
  await withFixture((fixture) => {
    symlinkSync('/etc/hostname', join(fixture, 'link'));
    assert.throws(() => createWorkspace(fixture), /symbolic link: link/);
  });
  await withFixture((fixture) => {
    writeFileSync(join(fixture, 'big.bin'), Buffer.alloc(2048));
    assert.throws(() => createWorkspace(fixture, { maxBytes: 1024 }), /larger than 1024 bytes/);
  });
  assert.throws(() => removeWorkspace('/home'), /refusing to remove/);
});

test('static server serves files on 127.0.0.1, index.html for dirs, 404/403 otherwise', async () => {
  await withFixture(async (root) => {
    writeFileSync(join(root, 'index.html'), '<h1>home</h1>');
    mkdirSync(join(root, 'pages'));
    writeFileSync(join(root, 'pages', 'p.css'), 'a{}');
    const outside = mkdtempSync(join(tmpdir(), 'fak-outside-'));
    writeFileSync(join(outside, 'secret.txt'), 'SECRET');
    symlinkSync(join(outside, 'secret.txt'), join(root, 'leak.txt'));
    const server = await startStaticServer(root);
    try {
      assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
      const home = await fetch(`${server.origin}/`);
      assert.equal(home.status, 200);
      assert.match(await home.text(), /home/);
      const css = await fetch(`${server.origin}/pages/p.css`);
      assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');
      assert.equal((await fetch(`${server.origin}/missing.html`)).status, 404);
      assert.equal((await fetch(`${server.origin}/leak.txt`)).status, 403);
      assert.equal((await fetch(`${server.origin}/%2e%2e/%2e%2e/etc/hostname`)).status, 403);
      assert.equal((await fetch(`${server.origin}/`, { method: 'POST' })).status, 405);
    } finally {
      await server.close();
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/evals && npm test`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`packages/evals/src/workspace.ts`:
```ts
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const WORKSPACE_PREFIX = 'fak-bench-';
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

/** Copy `fixtureDir` into a fresh temp dir. Symlinks and special files are refused, never followed. */
export function createWorkspace(fixtureDir: string, options: { maxBytes?: number } = {}): string {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const ws = realpathSync(mkdtempSync(path.join(tmpdir(), WORKSPACE_PREFIX)));
  let total = 0;
  const copy = (src: string, dst: string, rel: string) => {
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const from = path.join(src, entry.name);
      const to = path.join(dst, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`fixture ${fixtureDir} contains a symbolic link: ${childRel}`);
      if (entry.isDirectory()) {
        mkdirSync(to);
        copy(from, to, childRel);
      } else if (entry.isFile()) {
        total += lstatSync(from).size;
        if (total > maxBytes) throw new Error(`fixture ${fixtureDir} is larger than ${maxBytes} bytes`);
        copyFileSync(from, to);
      } else {
        throw new Error(`fixture ${fixtureDir} contains a special file: ${childRel}`);
      }
    }
  };
  try {
    copy(fixtureDir, ws, '');
  } catch (error) {
    rmSync(ws, { recursive: true, force: true });
    throw error;
  }
  return ws;
}

export function removeWorkspace(dir: string): void {
  const resolved = path.resolve(dir);
  const root = realpathSync(tmpdir());
  if (path.dirname(resolved) !== root || !path.basename(resolved).startsWith(WORKSPACE_PREFIX)) {
    throw new Error(`refusing to remove ${dir}: not a bench workspace`);
  }
  rmSync(resolved, { recursive: true, force: true });
}
```

`packages/evals/src/static-server.ts`:
```ts
import { createServer } from 'node:http';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

export async function startStaticServer(rootDir: string): Promise<{ origin: string; close(): Promise<void> }> {
  const root = realpathSync(rootDir);
  const server = createServer((req, res) => {
    const send = (status: number, body: string) => {
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(body);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'method not allowed');
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
    } catch {
      return send(400, 'bad request');
    }
    let file = path.resolve(root, `.${pathname}`);
    let real: string;
    try {
      real = realpathSync(file);
      if (statSync(real).isDirectory()) {
        file = path.join(real, 'index.html');
        real = realpathSync(file);
      }
    } catch {
      const rel = path.relative(root, file);
      return rel.startsWith('..') || path.isAbsolute(rel) ? send(403, 'forbidden') : send(404, 'not found');
    }
    const rel = path.relative(root, real);
    if (rel.startsWith('..') || path.isAbsolute(rel) || real !== file) return send(403, 'forbidden');
    res.writeHead(200, { 'content-type': TYPES[path.extname(real).toLowerCase()] ?? 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(real));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}
```

`real !== file` rejects any path that went through a symlink (the resolved path must equal the literal path; `root` itself is already a realpath).

- [ ] **Step 4: Run tests**

Run: `cd packages/evals && npm test && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/evals && git commit -m "evals: symlink-refusing workspace copy and a 127.0.0.1 static server"
```

---

### Task 7: Host command builders and process runner

**Files:**
- Create: `packages/evals/src/hosts.ts`, `packages/evals/src/process.ts`
- Create: `packages/evals/tests/data/fake-hang.mjs`
- Test: `packages/evals/tests/hosts.test.ts`

**Interfaces:**
- Consumes: `HostId` (Task 2).
- Produces (`hosts.ts`): `interface McpServerSpec { name: string; command: string; args: string[]; env: Record<string, string> }`, `interface HostBinary { command: string; prefixArgs: string[] }`, `interface HostRunSpec { command: string; args: string[]; cwd: string }`, `CLAUDE_BASE_TOOLS: string[]`, `buildClaudeRun(opts: { workspace: string; prompt: string; servers: McpServerSpec[]; mcpConfigPath: string; binary: HostBinary; model?: string }): HostRunSpec` (also writes the MCP config file), `buildCodexRun(opts: { workspace: string; prompt: string; servers: McpServerSpec[]; binary: HostBinary; model?: string }): HostRunSpec`, `tomlValue(value: string | string[] | Record<string, string>): string`.
- Produces (`process.ts`): `interface ProcessResult { exitCode: number | null; timedOut: boolean; stdout: string; stderrTail: string; spawnError?: string; durationMs: number }`, `runProcess(spec: HostRunSpec, timeoutMs: number, transcriptPath: string): Promise<ProcessResult>`, `killAllActive(): void`.

- [ ] **Step 1: Fake hanging host** — `packages/evals/tests/data/fake-hang.mjs`

```js
// Emits one line, starts a grandchild that records its pid, then both hang.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
process.stdout.write('{"type":"system","subtype":"init"}\n');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
writeFileSync(process.env.FAKE_PID_FILE, String(child.pid));
setInterval(() => {}, 1000);
```

- [ ] **Step 2: Write the failing test** — `packages/evals/tests/hosts.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClaudeRun, buildCodexRun, tomlValue, type McpServerSpec } from '../src/hosts.ts';
import { runProcess } from '../src/process.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const servers: McpServerSpec[] = [
  { name: 'frontend-agent', command: '/kit/node_modules/.bin/tsx', args: ['/kit/mcp.ts'], env: { FRONTEND_AGENT_PROJECT_ROOT: '/tmp/ws' } },
  { name: 'figma', command: '/kit/node_modules/.bin/tsx', args: ['/kit/figma.ts'], env: { FIGMA_MOCK_FIXTURE: '/kit/f "q".json' } }
];

test('claude: strict MCP config file, project settings only, allowlisted tools, never bypassPermissions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fak-hosts-'));
  try {
    const cfg = join(dir, 'claude-mcp.json');
    const spec = buildClaudeRun({ workspace: '/tmp/ws', prompt: 'do it', servers, mcpConfigPath: cfg, binary: { command: 'claude', prefixArgs: [] }, model: 'opus' });
    assert.equal(spec.cwd, '/tmp/ws');
    assert.deepEqual(spec.args.slice(0, 2), ['-p', 'do it']);
    const at = (flag: string) => spec.args[spec.args.indexOf(flag) + 1];
    assert.equal(at('--output-format'), 'stream-json');
    assert.equal(at('--mcp-config'), cfg);
    assert.ok(spec.args.includes('--strict-mcp-config'));
    assert.equal(at('--setting-sources'), 'project');
    assert.equal(at('--permission-mode'), 'acceptEdits');
    assert.equal(at('--model'), 'opus');
    assert.deepEqual(at('--allowedTools').split(','), ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Skill', 'ToolSearch', 'mcp__frontend-agent', 'mcp__figma']);
    assert.ok(!spec.args.join(' ').includes('bypass'));
    const written = JSON.parse(readFileSync(cfg, 'utf8'));
    assert.deepEqual(Object.keys(written.mcpServers), ['frontend-agent', 'figma']);
    assert.equal(written.mcpServers.figma.type, 'stdio');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('codex: MCP servers via -c with auto-approval, user config ignored, workspace-write sandbox, prompt last', () => {
  const spec = buildCodexRun({ workspace: '/tmp/ws', prompt: 'do it', servers, binary: { command: 'codex', prefixArgs: [] } });
  const joined = spec.args.join('\n');
  for (const flag of ['exec', '--json', '--ignore-user-config', '--skip-git-repo-check', '--ephemeral']) assert.ok(spec.args.includes(flag), flag);
  assert.equal(spec.args[spec.args.indexOf('--sandbox') + 1], 'workspace-write');
  assert.equal(spec.args[spec.args.indexOf('-C') + 1], '/tmp/ws');
  assert.match(joined, /^mcp_servers\.figma\.command="\/kit\/node_modules\/\.bin\/tsx"$/m);
  assert.match(joined, /^mcp_servers\.figma\.args=\["\/kit\/figma\.ts"\]$/m);
  assert.match(joined, /^mcp_servers\.figma\.env=\{FIGMA_MOCK_FIXTURE="\/kit\/f \\"q\\"\.json"\}$/m);
  assert.match(joined, /^mcp_servers\.frontend-agent\.default_tools_approval_mode="approve"$/m);
  assert.equal(spec.args.at(-1), 'do it');
});

test('tomlValue rejects keys that are not bare TOML keys', () => {
  assert.throws(() => tomlValue({ 'bad key': 'x' }), /not a bare TOML key/);
});

test('runProcess: timeout kills the whole process group, including grandchildren', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fak-proc-'));
  const pidFile = join(dir, 'pid');
  process.env.FAKE_PID_FILE = pidFile;
  try {
    const result = await runProcess({ command: process.execPath, args: [join(here, 'data', 'fake-hang.mjs')], cwd: dir }, 1500, join(dir, 't.jsonl'));
    assert.equal(result.timedOut, true);
    assert.match(readFileSync(join(dir, 't.jsonl'), 'utf8'), /"init"/);
    const grandchild = Number(readFileSync(pidFile, 'utf8'));
    await new Promise((r) => setTimeout(r, 300));
    assert.throws(() => process.kill(grandchild, 0), /ESRCH/);
  } finally {
    delete process.env.FAKE_PID_FILE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcess: a missing binary is a spawnError, not a crash', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fak-proc-'));
  try {
    const result = await runProcess({ command: join(dir, 'no-such-host'), args: [], cwd: dir }, 5000, join(dir, 't.jsonl'));
    assert.match(result.spawnError ?? '', /not found|ENOENT/);
    assert.equal(existsSync(join(dir, 't.jsonl')), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd packages/evals && npm test`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement**

`packages/evals/src/hosts.ts`:
```ts
import { writeFileSync } from 'node:fs';

export interface McpServerSpec {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface HostBinary {
  command: string;
  /** Prepended to the host arguments (lets tests run a Node script as a fake host). */
  prefixArgs: string[];
}

export interface HostRunSpec {
  command: string;
  args: string[];
  cwd: string;
}

/** Claude built-in tools the benchmark allows. No Bash: the kit's MCP covers validation. */
export const CLAUDE_BASE_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Skill', 'ToolSearch'];
const BARE_KEY = /^[A-Za-z0-9_-]+$/;

export function buildClaudeRun(opts: {
  workspace: string;
  prompt: string;
  servers: McpServerSpec[];
  mcpConfigPath: string;
  binary: HostBinary;
  model?: string;
}): HostRunSpec {
  const mcpServers = Object.fromEntries(
    opts.servers.map((s) => [s.name, { type: 'stdio', command: s.command, args: s.args, env: s.env }])
  );
  writeFileSync(opts.mcpConfigPath, `${JSON.stringify({ mcpServers }, null, 2)}\n`);
  const allowed = [...CLAUDE_BASE_TOOLS, ...opts.servers.map((s) => `mcp__${s.name}`)];
  return {
    command: opts.binary.command,
    cwd: opts.workspace,
    args: [
      ...opts.binary.prefixArgs,
      '-p',
      opts.prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--mcp-config',
      opts.mcpConfigPath,
      '--strict-mcp-config',
      '--setting-sources',
      'project',
      '--permission-mode',
      'acceptEdits',
      ...(opts.model ? ['--model', opts.model] : []),
      '--allowedTools',
      allowed.join(',')
    ]
  };
}

export function tomlValue(value: string | string[] | Record<string, string>): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => JSON.stringify(v)).join(',')}]`;
  return `{${Object.entries(value)
    .map(([key, v]) => {
      if (!BARE_KEY.test(key)) throw new Error(`"${key}" is not a bare TOML key`);
      return `${key}=${JSON.stringify(v)}`;
    })
    .join(',')}}`;
}

export function buildCodexRun(opts: {
  workspace: string;
  prompt: string;
  servers: McpServerSpec[];
  binary: HostBinary;
  model?: string;
}): HostRunSpec {
  const config: string[] = [];
  for (const s of opts.servers) {
    if (!BARE_KEY.test(s.name)) throw new Error(`"${s.name}" is not a bare TOML key`);
    const key = `mcp_servers.${s.name}`;
    config.push('-c', `${key}.command=${tomlValue(s.command)}`);
    config.push('-c', `${key}.args=${tomlValue(s.args)}`);
    config.push('-c', `${key}.env=${tomlValue(s.env)}`);
    config.push('-c', `${key}.default_tools_approval_mode="approve"`);
  }
  return {
    command: opts.binary.command,
    cwd: opts.workspace,
    args: [
      ...opts.binary.prefixArgs,
      'exec',
      '--json',
      '--ignore-user-config',
      '--sandbox',
      'workspace-write',
      '--skip-git-repo-check',
      '--ephemeral',
      '-C',
      opts.workspace,
      ...config,
      ...(opts.model ? ['-m', opts.model] : []),
      opts.prompt
    ]
  };
}
```

JSON string escaping is valid TOML basic-string escaping for everything `JSON.stringify` emits (`\"`, `\\`, `\n`, `\uXXXX`).

`--allowedTools` is variadic in Claude's CLI, so it goes last and the prompt goes right after `-p`.

`packages/evals/src/process.ts`:
```ts
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import type { HostRunSpec } from './hosts.js';

export interface ProcessResult {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderrTail: string;
  spawnError?: string;
  durationMs: number;
}

const active = new Set<ChildProcess>();
const KILL_GRACE_MS = 3000;

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // group already gone
  }
}

/** Kill every running host process group (used on SIGINT). */
export function killAllActive(): void {
  for (const child of active) killGroup(child, 'SIGKILL');
}

/** Run a host in its own process group; stdout is streamed to `transcriptPath` and returned. */
export function runProcess(spec: HostRunSpec, timeoutMs: number, transcriptPath: string): Promise<ProcessResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const transcript = createWriteStream(transcriptPath);
    let stdout = '';
    let stderrTail = '';
    let timedOut = false;
    let spawnError: string | undefined;
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });
    active.add(child);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      transcript.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-4000);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child, 'SIGTERM');
      setTimeout(() => killGroup(child, 'SIGKILL'), KILL_GRACE_MS).unref();
    }, timeoutMs);
    child.on('error', (error: NodeJS.ErrnoException) => {
      spawnError = error.code === 'ENOENT' ? `host command not found: ${spec.command}` : error.message;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      active.delete(child);
      // The host may exit before its children (e.g. MCP servers); make sure none survive.
      killGroup(child, 'SIGKILL');
      transcript.end(() =>
        resolve({ exitCode: spawnError ? null : code, timedOut, stdout, stderrTail, spawnError, durationMs: Date.now() - started })
      );
    });
  });
}
```

- [ ] **Step 5: Run tests**

Run: `cd packages/evals && npm test && npx tsc --noEmit`
Expected: all pass. (The timeout test takes ~2 s.)

- [ ] **Step 6: Commit** — risk point: request a focused review of `process.ts` and `hosts.ts` before continuing (unsupervised agents, kill semantics, permissions).

```bash
git add packages/evals && git commit -m "evals: headless Claude/Codex command builders and a process-group runner with timeout kill"
```

---

### Task 8: Bench orchestration, report and bin

**Files:**
- Create: `packages/evals/src/bench.ts`, `packages/evals/src/report.ts`, `packages/evals/src/cli.ts`, `packages/evals/bin/bench.mjs`
- Create: `packages/evals/tests/data/fake-claude.mjs`, `packages/evals/tests/data/bench-evals/scenarios/fake-simple.json`, `packages/evals/tests/data/bench-evals/fixtures/tiny/index.html`, `packages/evals/tests/data/bench-evals/figma/tiny.json`
- Test: `packages/evals/tests/bench.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–7; CLI `run` from `../../cli/src/cli.js` (signature `run(argv: string[], io: CliIo): Promise<number>`), `kitServerLaunch` from `../../cli/src/mcp-launch.js`, `findKitRoot`, `readKitVersion` from `../../cli/src/util.js`.
- Produces (`bench.ts`): `interface BenchOptions { kitRoot: string; evalsDir: string; hosts: HostId[]; scenarioIds?: string[]; categories?: Category[]; outDir: string; keep?: boolean; binaries?: Partial<Record<HostId, HostBinary>>; models?: Partial<Record<HostId, string>>; timeoutMsOverride?: number; log?: (line: string) => void }`, `interface CaseResult { scenarioId: string; category: Category; host: HostId; verdict: Verdict; grade: GradeResult; durationMs: number; usage?: Usage; model?: string; transcriptPath: string; workspace?: string }`, `selectScenarios(all: Scenario[], ids?: string[], categories?: Category[]): Scenario[]`, `runBench(opts: BenchOptions): Promise<CaseResult[]>`.
- Produces (`report.ts`): `interface BenchMeta { startedAt: string; finishedAt: string; kitVersion: string; hosts: HostId[]; models: Partial<Record<HostId, string>> }`, `interface HostSummary { total: number; pass: number; fail: number; error: number; passRate: number }`, `interface Summary { meta: BenchMeta; byHost: Record<string, HostSummary>; byHostCategory: Record<string, Record<string, HostSummary>>; cases: CaseResult[] }`, `summarize(results: CaseResult[], meta: BenchMeta): Summary`, `renderMarkdown(summary: Summary): string`, `writeReport(outDir: string, results: CaseResult[], meta: BenchMeta): { summaryPath: string; reportPath: string }`.
- Produces (`cli.ts`): `runBenchCli(argv: string[], io: { stdout(l: string): void; stderr(l: string): void; cwd: string }): Promise<number>`.

- [ ] **Step 1: Test data**

`packages/evals/tests/data/bench-evals/fixtures/tiny/index.html`:
```html
<!doctype html><title>tiny</title><h1>tiny</h1>
```

`packages/evals/tests/data/bench-evals/figma/tiny.json`:
```json
{ "fileKey": "TINY01", "metadata": "<canvas id=\"0:1\"><frame id=\"1:2\" name=\"Tiny\" /></canvas>", "variables": {}, "nodes": { "1:2": { "name": "Tiny", "designContext": "<h1>Tiny</h1>" } } }
```

`packages/evals/tests/data/bench-evals/scenarios/fake-simple.json`:
```json
{
  "id": "fake-simple",
  "category": "base",
  "title": "Fake host writes a page",
  "fixture": "tiny",
  "figma": "tiny",
  "profile": "standard",
  "prompt": "Implement the page. App at {{baseUrl}}.",
  "timeoutSec": 60,
  "expected": [
    { "type": "tool_called", "tool": "figma/get_design_context" },
    { "type": "file_matches", "glob": "pages/*.html", "pattern": "http://127\\.0\\.0\\.1:\\d+" },
    { "type": "output_matches", "pattern": "VEREDITO:\\s*PASS" }
  ],
  "forbidden": [{ "type": "file_exists", "path": "forbidden.txt" }]
}
```

`packages/evals/tests/data/fake-claude.mjs` — verifies the wiring it receives, then behaves like a successful Claude run:
```js
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const fail = (msg) => { process.stderr.write(`fake-claude: ${msg}\n`); process.exit(2); };
const at = (flag) => args[args.indexOf(flag) + 1];
if (!args.includes('--strict-mcp-config')) fail('missing --strict-mcp-config');
const config = JSON.parse(readFileSync(at('--mcp-config'), 'utf8'));
if (!config.mcpServers['frontend-agent'] || !config.mcpServers.figma) fail('servers missing from MCP config');
if (config.mcpServers['frontend-agent'].env.FRONTEND_AGENT_PROJECT_ROOT !== process.cwd()) fail('project root is not the workspace');
if (!existsSync('.claude/skills') || !existsSync('CLAUDE.md')) fail('kit not installed into the workspace');
if (readFileSync('.frontend-agent/config.yml', 'utf8').trim() !== 'validationProfile: standard') fail('profile config not written');
const prompt = args[args.indexOf('-p') + 1];
const baseUrl = /http:\/\/127\.0\.0\.1:\d+/.exec(prompt)?.[0] ?? fail('no baseUrl in prompt');
const home = await fetch(`${baseUrl}/`);
if (!(await home.text()).includes('tiny')) fail('static server does not serve the workspace');
mkdirSync('pages', { recursive: true });
writeFileSync('pages/tiny.html', `<a href="${baseUrl}/">home</a>`);
const lines = [
  { type: 'system', subtype: 'init', model: 'fake-model' },
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__figma__get_design_context', input: { nodeId: '1:2' } }] } },
  { type: 'result', subtype: 'success', is_error: false, result: 'Done. VEREDITO: PASS', total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 5 } }
];
for (const line of lines) process.stdout.write(`${JSON.stringify(line)}\n`);
```

- [ ] **Step 2: Write the failing test** — `packages/evals/tests/bench.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBench, selectScenarios } from '../src/bench.ts';
import { writeReport } from '../src/report.ts';
import { findKitRoot } from '../../cli/src/util.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const evalsDir = join(here, 'data', 'bench-evals');
const fakeClaude = { command: process.execPath, prefixArgs: [join(here, 'data', 'fake-claude.mjs')] };

function withOut(fn: (out: string) => Promise<void>) {
  const out = mkdtempSync(join(tmpdir(), 'fak-bench-out-'));
  return fn(out).finally(() => rmSync(out, { recursive: true, force: true }));
}

const benchWorkspaces = () => readdirSync(tmpdir()).filter((n) => n.startsWith('fak-bench-') && !n.startsWith('fak-bench-out-'));

test('end to end with a fake Claude: install, serve, run, grade pass, clean up, report', async () => {
  await withOut(async (out) => {
    const before = new Set(benchWorkspaces());
    const results = await runBench({ kitRoot: findKitRoot(), evalsDir, hosts: ['claude'], outDir: out, binaries: { claude: fakeClaude } });
    assert.equal(results.length, 1);
    const [r] = results;
    assert.equal(r.verdict, 'pass', JSON.stringify(r.grade, null, 2));
    assert.equal(r.model, 'fake-model');
    assert.deepEqual(r.usage, { inputTokens: 10, outputTokens: 5, costUsd: 0.01 });
    assert.ok(existsSync(r.transcriptPath));
    assert.deepEqual(benchWorkspaces().filter((n) => !before.has(n)), [], 'workspace removed');

    const { summaryPath, reportPath } = writeReport(out, results, {
      startedAt: 'a', finishedAt: 'b', kitVersion: '0.5.0', hosts: ['claude'], models: {}
    });
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    assert.deepEqual(summary.byHost.claude, { total: 1, pass: 1, fail: 0, error: 0, passRate: 1 });
    assert.match(readFileSync(reportPath, 'utf8'), /\| fake-simple \| base \| pass \|/);
  });
});

test('a missing host binary is an error per case; the other host still runs; --keep keeps the workspace', async () => {
  await withOut(async (out) => {
    const results = await runBench({
      kitRoot: findKitRoot(),
      evalsDir,
      hosts: ['claude', 'codex'],
      outDir: out,
      keep: true,
      binaries: { claude: fakeClaude, codex: { command: join(out, 'no-codex'), prefixArgs: [] } }
    });
    const byHost = Object.fromEntries(results.map((r) => [r.host, r]));
    assert.equal(byHost.claude.verdict, 'pass');
    assert.equal(byHost.codex.verdict, 'error');
    assert.match(byHost.codex.grade.error ?? '', /host command not found/);
    for (const r of results) {
      assert.ok(r.workspace && existsSync(r.workspace));
      rmSync(r.workspace!, { recursive: true, force: true });
    }
  });
});

test('timeout override makes a hanging host an error', async () => {
  await withOut(async (out) => {
    process.env.FAKE_PID_FILE = join(out, 'pid');
    try {
      const results = await runBench({
        kitRoot: findKitRoot(),
        evalsDir,
        hosts: ['claude'],
        outDir: out,
        timeoutMsOverride: 1500,
        binaries: { claude: { command: process.execPath, prefixArgs: [join(here, 'data', 'fake-hang.mjs')] } }
      });
      assert.equal(results[0].verdict, 'error');
      assert.match(results[0].grade.error ?? '', /timed out/);
    } finally {
      delete process.env.FAKE_PID_FILE;
    }
  });
});

test('selectScenarios filters by id and category and rejects unknown ids', () => {
  const all = [
    { id: 'a', category: 'base' },
    { id: 'b', category: 'stack' }
  ] as any;
  assert.deepEqual(selectScenarios(all, undefined, ['stack']).map((s: any) => s.id), ['b']);
  assert.deepEqual(selectScenarios(all, ['a']).map((s: any) => s.id), ['a']);
  assert.throws(() => selectScenarios(all, ['zzz']), /unknown scenario "zzz"/);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd packages/evals && npm test`
Expected: FAIL — `../src/bench.ts` not found.

- [ ] **Step 4: Implement**

`packages/evals/src/bench.ts`:
```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { run as runCli } from '../../cli/src/cli.js';
import { kitServerLaunch } from '../../cli/src/mcp-launch.js';
import { evalsLayout, loadScenarios } from './load.js';
import { grade, type GradeResult, type Verdict } from './grade.js';
import { buildClaudeRun, buildCodexRun, type HostBinary, type McpServerSpec } from './hosts.js';
import { runProcess } from './process.js';
import { createWorkspace, removeWorkspace } from './workspace.js';
import { startStaticServer } from './static-server.js';
import { parseClaudeTranscript } from './transcript/claude.js';
import { parseCodexTranscript } from './transcript/codex.js';
import type { Category, HostId, Scenario } from './schema.js';
import type { RunRecord, Usage } from './types.js';

export interface BenchOptions {
  kitRoot: string;
  evalsDir: string;
  hosts: HostId[];
  scenarioIds?: string[];
  categories?: Category[];
  outDir: string;
  keep?: boolean;
  binaries?: Partial<Record<HostId, HostBinary>>;
  models?: Partial<Record<HostId, string>>;
  timeoutMsOverride?: number;
  log?: (line: string) => void;
}

export interface CaseResult {
  scenarioId: string;
  category: Category;
  host: HostId;
  verdict: Verdict;
  grade: GradeResult;
  durationMs: number;
  usage?: Usage;
  model?: string;
  transcriptPath: string;
  workspace?: string;
}

export function selectScenarios(all: Scenario[], ids?: string[], categories?: Category[]): Scenario[] {
  for (const id of ids ?? []) {
    if (!all.some((s) => s.id === id)) throw new Error(`unknown scenario "${id}"`);
  }
  return all.filter((s) => (!ids?.length || ids.includes(s.id)) && (!categories?.length || categories.includes(s.category)));
}

function errorResult(scenario: Scenario, host: HostId, message: string, transcriptPath: string, workspace?: string): CaseResult {
  return {
    scenarioId: scenario.id,
    category: scenario.category,
    host,
    verdict: 'error',
    grade: { verdict: 'error', expected: [], forbidden: [], error: message },
    durationMs: 0,
    transcriptPath,
    workspace
  };
}

async function runCase(opts: BenchOptions, scenario: Scenario, host: HostId): Promise<CaseResult> {
  const layout = evalsLayout(opts.evalsDir);
  const transcriptDir = path.join(opts.outDir, 'transcripts', host);
  mkdirSync(transcriptDir, { recursive: true });
  const transcriptPath = path.join(transcriptDir, `${scenario.id}.jsonl`);
  const ws = createWorkspace(path.join(layout.fixturesDir, scenario.fixture));
  const server = await startStaticServer(ws);
  try {
    if (scenario.profile) {
      mkdirSync(path.join(ws, '.frontend-agent'), { recursive: true });
      writeFileSync(path.join(ws, '.frontend-agent', 'config.yml'), `validationProfile: ${scenario.profile}\n`);
    }
    const installErr: string[] = [];
    const code = await runCli(['install', host, '--project', ws, '--no-figma'], {
      stdout: () => {},
      stderr: (line) => installErr.push(line),
      env: process.env,
      cwd: ws,
      homeDir: process.env.HOME ?? ws
    });
    if (code !== 0) return errorResult(scenario, host, `kit install failed: ${installErr.join(' ')}`, transcriptPath, opts.keep ? ws : undefined);

    const tsx = path.join(opts.kitRoot, 'node_modules', '.bin', 'tsx');
    const kit = kitServerLaunch({ kitRoot: opts.kitRoot, projectRoot: ws, includeFigma: false });
    const servers: McpServerSpec[] = [
      { name: 'frontend-agent', command: kit.command, args: kit.args, env: kit.env },
      {
        name: 'figma',
        command: tsx,
        args: [path.join(opts.kitRoot, 'packages', 'evals', 'src', 'figma-mock', 'main.ts')],
        env: { FIGMA_MOCK_FIXTURE: path.join(layout.figmaDir, `${scenario.figma}.json`), FIGMA_MOCK_OUTPUT_ROOT: ws }
      }
    ];
    const prompt = scenario.prompt.replaceAll('{{baseUrl}}', server.origin);
    const binary = opts.binaries?.[host] ?? { command: host, prefixArgs: [] };
    const model = opts.models?.[host];
    const spec =
      host === 'claude'
        ? buildClaudeRun({ workspace: ws, prompt, servers, mcpConfigPath: path.join(transcriptDir, `${scenario.id}.mcp.json`), binary, model })
        : buildCodexRun({ workspace: ws, prompt, servers, binary, model });

    const proc = await runProcess(spec, opts.timeoutMsOverride ?? scenario.timeoutSec * 1000, transcriptPath);
    const parsed = host === 'claude' ? parseClaudeTranscript(proc.stdout) : parseCodexTranscript(proc.stdout);
    const record: RunRecord = {
      ...parsed,
      error: proc.spawnError ?? parsed.error,
      host,
      durationMs: proc.durationMs,
      exitCode: proc.spawnError ? 0 : proc.exitCode,
      timedOut: proc.timedOut,
      stderrTail: proc.stderrTail
    };
    const result = grade(scenario, record, ws);
    if (result.verdict === 'error' && proc.stderrTail.trim()) result.error += ` — stderr: ${proc.stderrTail.trim().slice(-500)}`;
    return {
      scenarioId: scenario.id,
      category: scenario.category,
      host,
      verdict: result.verdict,
      grade: result,
      durationMs: proc.durationMs,
      usage: parsed.usage,
      model: parsed.model ?? model,
      transcriptPath,
      workspace: opts.keep ? ws : undefined
    };
  } finally {
    await server.close();
    if (!opts.keep) removeWorkspace(ws);
  }
}

export async function runBench(opts: BenchOptions): Promise<CaseResult[]> {
  const log = opts.log ?? (() => {});
  const scenarios = selectScenarios(loadScenarios(evalsLayout(opts.evalsDir)), opts.scenarioIds, opts.categories);
  const results: CaseResult[] = [];
  for (const scenario of scenarios) {
    for (const host of opts.hosts) {
      log(`[${host}] ${scenario.id} …`);
      let result: CaseResult;
      try {
        result = await runCase(opts, scenario, host);
      } catch (error) {
        result = errorResult(scenario, host, (error as Error).message, '');
      }
      log(`[${host}] ${scenario.id}: ${result.verdict}${result.grade.error ? ` (${result.grade.error})` : ''}`);
      results.push(result);
    }
  }
  return results;
}
```

`exitCode: proc.spawnError ? 0 : proc.exitCode` lets `grade` report the spawn error message itself (through `record.error`) instead of "exited with code null".

`packages/evals/src/report.ts`:
```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CaseResult } from './bench.js';
import type { HostId } from './schema.js';

export interface BenchMeta {
  startedAt: string;
  finishedAt: string;
  kitVersion: string;
  hosts: HostId[];
  models: Partial<Record<HostId, string>>;
}

export interface HostSummary {
  total: number;
  pass: number;
  fail: number;
  error: number;
  passRate: number;
}

export interface Summary {
  meta: BenchMeta;
  byHost: Record<string, HostSummary>;
  byHostCategory: Record<string, Record<string, HostSummary>>;
  cases: CaseResult[];
}

function tally(cases: CaseResult[]): HostSummary {
  const count = (v: string) => cases.filter((c) => c.verdict === v).length;
  const total = cases.length;
  const pass = count('pass');
  return { total, pass, fail: count('fail'), error: count('error'), passRate: total ? Math.round((pass / total) * 1000) / 1000 : 0 };
}

export function summarize(results: CaseResult[], meta: BenchMeta): Summary {
  const byHost: Record<string, HostSummary> = {};
  const byHostCategory: Record<string, Record<string, HostSummary>> = {};
  for (const host of meta.hosts) {
    const mine = results.filter((r) => r.host === host);
    byHost[host] = tally(mine);
    byHostCategory[host] = {};
    for (const category of [...new Set(mine.map((r) => r.category))]) {
      byHostCategory[host][category] = tally(mine.filter((r) => r.category === category));
    }
  }
  return { meta, byHost, byHostCategory, cases: results };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function renderMarkdown(summary: Summary): string {
  const { meta } = summary;
  const lines = [
    `# Frontend Agent Kit — benchmark`,
    '',
    `Kit ${meta.kitVersion} · ${meta.startedAt} → ${meta.finishedAt}`,
    '',
    '## Pass rate por host',
    '',
    '| Host | Modelo | Pass | Fail | Error | Pass rate |',
    '|------|--------|------|------|-------|-----------|'
  ];
  for (const host of meta.hosts) {
    const s = summary.byHost[host];
    const model = meta.models[host] ?? summary.cases.find((c) => c.host === host && c.model)?.model ?? '—';
    lines.push(`| ${host} | ${model} | ${s.pass} | ${s.fail} | ${s.error} | ${pct(s.passRate)} |`);
  }
  lines.push('', '## Por categoria', '', '| Host | Categoria | Pass | Total | Pass rate |', '|------|-----------|------|-------|-----------|');
  for (const host of meta.hosts) {
    for (const [category, s] of Object.entries(summary.byHostCategory[host])) {
      lines.push(`| ${host} | ${category} | ${s.pass} | ${s.total} | ${pct(s.passRate)} |`);
    }
  }
  lines.push('', '## Cenários', '', '| Cenário | Categoria | ' + meta.hosts.join(' | ') + ' |', '|---|---|' + meta.hosts.map(() => '---').join('|') + '|');
  for (const id of [...new Set(summary.cases.map((c) => c.scenarioId))]) {
    const cases = summary.cases.filter((c) => c.scenarioId === id);
    lines.push(`| ${id} | ${cases[0].category} | ${meta.hosts.map((h) => cases.find((c) => c.host === h)?.verdict ?? '—').join(' | ')} |`);
  }
  lines.push('', '## Falhas e erros', '');
  for (const c of summary.cases.filter((c) => c.verdict !== 'pass')) {
    lines.push(`### ${c.scenarioId} — ${c.host}: ${c.verdict}`, '');
    if (c.grade.error) lines.push(`- erro: ${c.grade.error}`);
    for (const r of c.grade.expected.filter((r) => !r.satisfied)) lines.push(`- expected não satisfeito: \`${JSON.stringify(r.assertion)}\` — ${r.detail}`);
    for (const r of c.grade.forbidden.filter((r) => r.satisfied)) lines.push(`- forbidden satisfeito: \`${JSON.stringify(r.assertion)}\` — ${r.detail}`);
    lines.push(`- duração: ${Math.round(c.durationMs / 1000)}s${c.usage?.costUsd !== undefined ? ` · custo: $${c.usage.costUsd.toFixed(3)}` : ''}${c.usage?.inputTokens !== undefined ? ` · tokens in/out: ${c.usage.inputTokens}/${c.usage.outputTokens ?? '?'}` : ''}`, '');
  }
  return `${lines.join('\n')}\n`;
}

export function writeReport(outDir: string, results: CaseResult[], meta: BenchMeta): { summaryPath: string; reportPath: string } {
  mkdirSync(outDir, { recursive: true });
  const summary = summarize(results, meta);
  const summaryPath = path.join(outDir, 'summary.json');
  const reportPath = path.join(outDir, 'report.md');
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(reportPath, renderMarkdown(summary));
  return { summaryPath, reportPath };
}
```

`packages/evals/src/cli.ts`:
```ts
import path from 'node:path';
import { parseArgs } from 'node:util';
import { findKitRoot, readKitVersion } from '../../cli/src/util.js';
import { runBench } from './bench.js';
import { evalsLayout, loadScenarios } from './load.js';
import { writeReport } from './report.js';
import { CATEGORIES, HOSTS, type Category, type HostId } from './schema.js';

const HELP = `frontend-agent-bench — run the eval scenarios against real hosts (costs tokens)

Usage:
  npm run bench -- [--host claude|codex|all] [--scenario <id> ...] [--category base|stack|profile ...]
                   [--model-claude <m>] [--model-codex <m>] [--out <dir>] [--keep]
  npm run bench -- --list        list scenarios
  npm run bench -- --validate    validate the scenario catalog only (free)`;

export async function runBenchCli(argv: string[], io: { stdout(l: string): void; stderr(l: string): void; cwd: string }): Promise<number> {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        host: { type: 'string', multiple: true },
        scenario: { type: 'string', multiple: true },
        category: { type: 'string', multiple: true },
        'model-claude': { type: 'string' },
        'model-codex': { type: 'string' },
        out: { type: 'string' },
        keep: { type: 'boolean', default: false },
        list: { type: 'boolean', default: false },
        validate: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false }
      }
    });
    if (values.help) {
      io.stdout(HELP);
      return 0;
    }
    const kitRoot = findKitRoot();
    const evalsDir = path.join(kitRoot, 'evals');
    const scenarios = loadScenarios(evalsLayout(evalsDir));
    if (values.validate) {
      io.stdout(`ok: ${scenarios.length} scenarios`);
      return 0;
    }
    if (values.list) {
      for (const s of scenarios) io.stdout(`${s.id.padEnd(28)} ${s.category.padEnd(8)} ${s.title}`);
      return 0;
    }
    const hostArgs = values.host ?? ['all'];
    const hosts: HostId[] = hostArgs.includes('all') ? [...HOSTS] : (hostArgs as HostId[]);
    for (const h of hosts) if (!HOSTS.includes(h)) throw new Error(`unknown host "${h}"`);
    const categories = (values.category ?? []) as Category[];
    for (const c of categories) if (!CATEGORIES.includes(c)) throw new Error(`unknown category "${c}"`);
    const startedAt = new Date().toISOString();
    const outDir = values.out ? path.resolve(io.cwd, values.out) : path.join(evalsDir, 'results', startedAt.replace(/[:.]/g, '-'));
    const models: Partial<Record<HostId, string>> = {};
    if (values['model-claude']) models.claude = values['model-claude'];
    if (values['model-codex']) models.codex = values['model-codex'];

    const results = await runBench({
      kitRoot,
      evalsDir,
      hosts,
      scenarioIds: values.scenario,
      categories,
      outDir,
      keep: values.keep,
      models,
      log: io.stdout
    });
    const { reportPath } = writeReport(outDir, results, { startedAt, finishedAt: new Date().toISOString(), kitVersion: readKitVersion(), hosts, models });
    io.stdout(`\nreport: ${reportPath}`);
    return 0;
  } catch (error) {
    io.stderr(`frontend-agent-bench: ${(error as Error).message}`);
    return 1;
  }
}
```

`packages/evals/bin/bench.mjs`:
```js
#!/usr/bin/env node
// Runs the TypeScript bench through tsx, resolved relative to this file (works from any cwd).
import { register } from 'tsx/esm/api';

register();
const { runBenchCli } = await import('../src/cli.ts');
const { killAllActive } = await import('../src/process.ts');
process.on('SIGINT', () => {
  killAllActive();
  process.exit(130);
});
process.exitCode = await runBenchCli(process.argv.slice(2), {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  cwd: process.env.INIT_CWD ?? process.cwd()
});
```

- [ ] **Step 5: Run tests**

Run: `cd packages/evals && npm test && npx tsc --noEmit`
Expected: all pass. If `tsc` complains about the cross-package `.js` imports, it is resolving `../../cli/src/*.ts` through NodeNext — confirm with `npx tsc --noEmit --traceResolution | grep cli/src | head` and keep the relative imports.

- [ ] **Step 6: Commit** — risk point: review with Task 7.

```bash
git add packages/evals && git commit -m "evals: bench orchestration (install, serve, run, grade), markdown/JSON report and frontend-agent-bench bin"
```

---

### Task 9: Eval content — reference designs, Figma data, fixtures, 18 scenarios

**Files:**
- Create: `packages/evals/scripts/render-figma-assets.ts`
- Create: `evals/figma/src/{pricing,hero-motion,checkout,landing}.html`, `evals/figma/assets/*.png` (generated), `evals/figma/{pricing,motion,large-file,asset}.json`
- Create: `evals/fixtures/{vanilla-app,vanilla-validate,react-app,nextjs-app,vue-app,nuxt-app,angular-app,tailwind-app,php-app}/…`
- Create: `evals/scenarios/*.json` (18), `evals/README.md`
- Test: `packages/evals/tests/catalog.test.ts`

**Interfaces:**
- Consumes: `loadScenarios`, `evalsLayout`, `createWorkspace`, `removeWorkspace`, `findKitRoot`.

- [ ] **Step 1: Write the failing catalog test** — `packages/evals/tests/catalog.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { evalsLayout, loadScenarios } from '../src/load.ts';
import { createWorkspace, removeWorkspace } from '../src/workspace.ts';
import { findKitRoot } from '../../cli/src/util.ts';

const kitRoot = findKitRoot();
const layout = evalsLayout(join(kitRoot, 'evals'));

test('the catalog loads: 7 base, 8 stack, 3 profile', () => {
  const scenarios = loadScenarios(layout);
  const count = (c: string) => scenarios.filter((s) => s.category === c).length;
  assert.deepEqual([count('base'), count('stack'), count('profile')], [7, 8, 3]);
});

test('every stack scenario maps to a figma-to-code reference and asserts it was read', () => {
  const refs = readdirSync(join(kitRoot, 'skills', 'figma-to-code', 'references')).map((f) => f.replace(/\.md$/, ''));
  const stacks = loadScenarios(layout).filter((s) => s.category === 'stack');
  assert.deepEqual(stacks.map((s) => s.id.replace(/^stack-/, '')).sort(), refs.sort());
  for (const s of stacks) {
    const stack = s.id.replace(/^stack-/, '');
    assert.ok(s.expected.some((a) => a.type === 'tool_called' && a.tool === `reference/${stack}`), s.id);
  }
});

test('the three profile scenarios cover each validationProfile and demand an explicit verdict line', () => {
  const profiles = loadScenarios(layout).filter((s) => s.category === 'profile');
  assert.deepEqual(profiles.map((s) => s.profile).sort(), ['pixel-perfect', 'relaxed', 'standard']);
  for (const s of profiles) assert.match(s.prompt, /VEREDITO: PASS/);
});

test('every fixture copies cleanly (no symlinks) and every prompt that needs the app uses {{baseUrl}}', () => {
  const scenarios = loadScenarios(layout);
  for (const fixture of new Set(scenarios.map((s) => s.fixture))) {
    const ws = createWorkspace(join(layout.fixturesDir, fixture));
    removeWorkspace(ws);
  }
  for (const s of scenarios.filter((s) => s.category !== 'stack')) assert.match(s.prompt, /\{\{baseUrl\}\}/, s.id);
});

test('reference screenshots were rendered', () => {
  for (const png of ['pricing-desktop.png', 'pricing-mobile.png', 'pricing-card.png', 'hero-motion.png', 'checkout.png', 'landing.png', 'hero.png']) {
    assert.ok(existsSync(join(layout.figmaDir, 'assets', png)), png);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/evals && npm test 2>&1 | grep -E "^not ok|ENOENT" | head`
Expected: FAIL — `evals/scenarios` does not exist.

- [ ] **Step 3: Reference designs** (the "Figma truth"; never copied into a workspace)

`evals/figma/src/pricing.html`:
```html
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Planos</title>
<style>
:root{--color-primary:#4F46E5;--color-primary-contrast:#FFFFFF;--color-bg:#F8FAFC;--color-surface:#FFFFFF;--color-text:#0F172A;--color-muted:#64748B;--color-border:#E2E8F0;--radius-md:12px;--space-2:8px;--space-4:16px;--space-6:24px;--space-10:40px;--font-title:40px}
*{box-sizing:border-box}
body{margin:0;font-family:Arial,Helvetica,sans-serif;font-size:16px;background:var(--color-bg);color:var(--color-text)}
main{max-width:1120px;margin:0 auto;padding:var(--space-10) var(--space-6)}
h1{font-size:var(--font-title);margin:0 0 var(--space-2)}
.lead{color:var(--color-muted);margin:0 0 var(--space-10)}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-6)}
.card{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-6)}
.card h2{margin:0 0 var(--space-2);font-size:20px}
.price{font-size:32px;font-weight:700;margin:0 0 var(--space-4)}
.card ul{padding-left:20px;margin:0 0 var(--space-6);color:var(--color-muted)}
.btn{display:inline-block;padding:12px 20px;border-radius:8px;font-weight:700;text-decoration:none;border:0}
.btn--primary{background:var(--color-primary);color:var(--color-primary-contrast)}
@media (max-width:767px){.grid{grid-template-columns:1fr}h1{font-size:32px}main{padding:var(--space-6) var(--space-4)}}
</style>
</head>
<body>
<main>
  <h1>Planos</h1>
  <p class="lead">Escolha o plano ideal para o seu time.</p>
  <div class="grid">
    <article class="card"><h2>Starter</h2><p class="price">R$ 0</p><ul><li>1 projeto</li><li>Suporte por e-mail</li></ul><a class="btn btn--primary" href="#">Começar</a></article>
    <article class="card"><h2>Pro</h2><p class="price">R$ 49</p><ul><li>10 projetos</li><li>Suporte prioritário</li></ul><a class="btn btn--primary" href="#">Assinar Pro</a></article>
    <article class="card"><h2>Team</h2><p class="price">R$ 99</p><ul><li>Projetos ilimitados</li><li>SSO</li></ul><a class="btn btn--primary" href="#">Falar com vendas</a></article>
  </div>
</main>
</body>
</html>
```

`evals/figma/src/hero-motion.html`:
```html
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Hero</title>
<style>
body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#0F172A;color:#FFFFFF}
.hero{max-width:1120px;margin:0 auto;padding:120px 24px;text-align:center}
.hero h1{font-size:56px;margin:0 0 16px}
.hero p{font-size:20px;color:#CBD5E1;margin:0 0 32px}
.btn{display:inline-block;padding:14px 24px;border-radius:8px;font-weight:700;background:#4F46E5;color:#FFFFFF;text-decoration:none}
</style>
</head>
<body>
<section class="hero"><h1>Crie mais rápido</h1><p>Do Figma ao código sem retrabalho.</p><a class="btn" href="#">Começar agora</a></section>
</body>
</html>
```

`evals/figma/src/checkout.html`:
```html
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Checkout</title>
<style>
body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#F8FAFC;color:#0F172A}
main{max-width:960px;margin:0 auto;padding:40px 24px;display:grid;grid-template-columns:2fr 1fr;gap:24px}
h1{grid-column:1/-1;font-size:32px;margin:0}
form,.summary{background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;padding:24px}
label{display:block;font-weight:700;margin:0 0 8px}
input{display:block;width:100%;box-sizing:border-box;padding:12px;border:1px solid #CBD5E1;border-radius:8px;margin:0 0 16px;font-size:16px}
.btn{display:block;width:100%;padding:14px;border:0;border-radius:8px;background:#4F46E5;color:#FFFFFF;font-weight:700;font-size:16px}
.summary p{display:flex;justify-content:space-between;margin:0 0 12px}
</style>
</head>
<body>
<main>
  <h1>Checkout</h1>
  <form><label for="name">Nome</label><input id="name"><label for="email">E-mail</label><input id="email" type="email"><label for="card">Cartão</label><input id="card"><button class="btn" type="submit">Pagar R$ 49</button></form>
  <aside class="summary"><p><span>Plano Pro</span><strong>R$ 49</strong></p><p><span>Total</span><strong>R$ 49</strong></p></aside>
</main>
</body>
</html>
```

`evals/figma/src/landing.html` (the image is the generated `hero.png`):
```html
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Landing</title>
<style>
body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#FFFFFF;color:#0F172A}
.hero{max-width:1120px;margin:0 auto;padding:64px 24px;display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}
.hero h1{font-size:48px;margin:0 0 16px}
.hero p{font-size:18px;color:#64748B;margin:0 0 24px}
.hero img{width:100%;height:auto;border-radius:12px;display:block}
.btn{display:inline-block;padding:14px 24px;border-radius:8px;font-weight:700;background:#4F46E5;color:#FFFFFF;text-decoration:none}
</style>
</head>
<body>
<section class="hero"><div><h1>Bem-vindo à Acme</h1><p>Ferramentas simples para times que entregam.</p><a class="btn" href="#">Criar conta</a></div><img src="../assets/hero.png" alt="Pessoas colaborando em frente a um painel"></section>
</body>
</html>
```

- [ ] **Step 4: Render script** — `packages/evals/scripts/render-figma-assets.ts`

```ts
// One-off: renders evals/figma/src/*.html into the reference PNGs the Figma mock serves.
// Run: npm run render-figma-assets --workspace=packages/evals
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { findKitRoot } from '../../cli/src/util.ts';

const figmaDir = path.join(findKitRoot(), 'evals', 'figma');
const assets = path.join(figmaDir, 'assets');
mkdirSync(assets, { recursive: true });

// hero.png: a deterministic 1200×800 gradient standing in for a photo asset.
const hero = new PNG({ width: 1200, height: 800 });
for (let y = 0; y < hero.height; y++) {
  for (let x = 0; x < hero.width; x++) {
    const i = (y * hero.width + x) * 4;
    hero.data[i] = 79 + Math.round((x / hero.width) * 100);
    hero.data[i + 1] = 70 + Math.round((y / hero.height) * 120);
    hero.data[i + 2] = 229;
    hero.data[i + 3] = 255;
  }
}
writeFileSync(path.join(assets, 'hero.png'), PNG.sync.write(hero));

const jobs = [
  { html: 'pricing.html', out: 'pricing-desktop.png', width: 1440, height: 900 },
  { html: 'pricing.html', out: 'pricing-mobile.png', width: 390, height: 844, fullPage: true },
  { html: 'pricing.html', out: 'pricing-card.png', width: 1440, height: 900, selector: '.card:nth-of-type(2)' },
  { html: 'hero-motion.html', out: 'hero-motion.png', width: 1440, height: 900 },
  { html: 'checkout.html', out: 'checkout.png', width: 1440, height: 900 },
  { html: 'landing.html', out: 'landing.png', width: 1440, height: 900 }
];

const browser = await chromium.launch();
try {
  for (const job of jobs) {
    const page = await browser.newPage({ viewport: { width: job.width, height: job.height } });
    await page.goto(pathToFileURL(path.join(figmaDir, 'src', job.html)).href);
    const file = path.join(assets, job.out);
    if (job.selector) await page.locator(job.selector).screenshot({ path: file });
    else await page.screenshot({ path: file, fullPage: job.fullPage ?? false });
    await page.close();
    console.log(`rendered ${job.out}`);
  }
} finally {
  await browser.close();
}
```

Run: `npm run render-figma-assets --workspace=packages/evals`
Expected: 6 "rendered …" lines; 7 PNGs in `evals/figma/assets/`.

- [ ] **Step 5: Figma data**

`evals/figma/pricing.json`:
```json
{
  "fileKey": "PRICING01",
  "metadata": "<canvas id=\"0:1\" name=\"Pricing\"><frame id=\"1:2\" name=\"Pricing\" x=\"0\" y=\"0\" width=\"1440\" height=\"900\"><frame id=\"1:10\" name=\"PricingCard\" width=\"357\" height=\"262\" /><instance id=\"1:11\" name=\"Button/Primary\" /></frame><frame id=\"1:50\" name=\"Pricing / Mobile\" x=\"1600\" y=\"0\" width=\"390\" height=\"1200\" /></canvas>",
  "variables": {
    "color/primary": "#4F46E5",
    "color/primary-contrast": "#FFFFFF",
    "color/bg": "#F8FAFC",
    "color/surface": "#FFFFFF",
    "color/text": "#0F172A",
    "color/muted": "#64748B",
    "color/border": "#E2E8F0",
    "radius/md": "12",
    "space/2": "8",
    "space/4": "16",
    "space/6": "24",
    "space/10": "40",
    "font/title": "40",
    "font/family": "Arial"
  },
  "nodes": {
    "1:2": {
      "name": "Pricing",
      "screenshot": "assets/pricing-desktop.png",
      "designContext": "Frame \"Pricing\" (1440×900, fill color/bg).\nContainer: max-width 1120, centered, padding space/10 (top/bottom) space/6 (sides).\n- Title \"Planos\": Arial Bold font/title (40px), color/text, margin-bottom space/2.\n- Lead \"Escolha o plano ideal para o seu time.\": 16px, color/muted, margin-bottom space/10.\n- Grid of 3 PricingCard instances (1:10), 3 equal columns, gap space/6.\nPricingCard contents (in order): Starter / R$ 0 / [1 projeto, Suporte por e-mail] / button \"Começar\"; Pro / R$ 49 / [10 projetos, Suporte prioritário] / \"Assinar Pro\"; Team / R$ 99 / [Projetos ilimitados, SSO] / \"Falar com vendas\".\nButtons are instances of the Button/Primary component (1:11).\n\nReference code:\n<main class=\"pricing\"><h1>Planos</h1><p class=\"lead\">Escolha o plano ideal para o seu time.</p><div class=\"grid\">{PricingCard × 3}</div></main>"
    },
    "1:10": {
      "name": "PricingCard",
      "screenshot": "assets/pricing-card.png",
      "designContext": "Component \"PricingCard\" (357×262).\nFill color/surface, 1px stroke color/border, radius radius/md (12), padding space/6 (24).\n- Plan name: Arial Bold 20px, color/text, margin-bottom space/2.\n- Price: Arial Bold 32px, margin-bottom space/4.\n- Feature list: bulleted, 16px, color/muted, left padding 20, margin-bottom space/6.\n- CTA: instance of Button/Primary (1:11).\nProps: name (text), price (text), features (list of text), ctaLabel (text).\nExample instance: name \"Pro\", price \"R$ 49\", features [\"10 projetos\", \"Suporte prioritário\"], ctaLabel \"Assinar Pro\".\n\nReference code:\n<article class=\"card\"><h2>{name}</h2><p class=\"price\">{price}</p><ul>{features}</ul><a class=\"btn btn--primary\">{ctaLabel}</a></article>"
    },
    "1:11": {
      "name": "Button/Primary",
      "designContext": "Component \"Button/Primary\": padding 12×20, radius 8, fill color/primary, text color/primary-contrast Arial Bold 16px. Code Connect: maps to the project's existing primary button component."
    },
    "1:50": {
      "name": "Pricing / Mobile",
      "screenshot": "assets/pricing-mobile.png",
      "designContext": "Frame \"Pricing / Mobile\" (390 wide). Same content as Pricing (1:2) with: container padding space/6 (top/bottom) space/4 (sides); title 32px; the 3 PricingCards stacked in a single column, gap space/6; no horizontal scroll."
    }
  }
}
```

`evals/figma/motion.json`:
```json
{
  "fileKey": "MOTION01",
  "metadata": "<canvas id=\"0:1\" name=\"Home\"><frame id=\"5:1\" name=\"Hero\" width=\"1440\" height=\"900\" /></canvas>",
  "variables": { "color/primary": "#4F46E5", "color/hero-bg": "#0F172A", "color/hero-muted": "#CBD5E1", "motion/duration-enter": "200ms", "motion/easing-enter": "ease-out" },
  "nodes": {
    "5:1": {
      "name": "Hero",
      "screenshot": "assets/hero-motion.png",
      "designContext": "Frame \"Hero\": fill color/hero-bg, centered text, padding 120 vertical.\n- Title \"Crie mais rápido\": Arial Bold 56px, white.\n- Subtitle \"Do Figma ao código sem retrabalho.\": 20px, color/hero-muted.\n- CTA \"Começar agora\": fill color/primary, white bold text, padding 14×24, radius 8.\n\nPrototype / motion (Smart Animate on page load):\n- Title and subtitle: opacity 0→1 and translateY 8px→0, duration motion/duration-enter (200ms), easing motion/easing-enter (ease-out).\n- CTA: same animation with a 50ms delay.\n- Accessibility note from the designer: when the user prefers reduced motion, show everything immediately with no animation."
    }
  }
}
```

`evals/figma/large-file.json`:
```json
{
  "fileKey": "LARGE01",
  "metadata": "<canvas id=\"0:1\" name=\"App — all screens\"><frame id=\"10:1\" name=\"Home\" /><frame id=\"10:2\" name=\"Search\" /><frame id=\"10:3\" name=\"Product\" /><frame id=\"10:4\" name=\"Cart\" /><frame id=\"12:34\" name=\"Checkout\" width=\"1440\" height=\"900\" /><frame id=\"10:6\" name=\"Order confirmed\" /><frame id=\"10:7\" name=\"Account\" /><frame id=\"10:8\" name=\"Orders\" /><frame id=\"10:9\" name=\"Settings\" /><frame id=\"10:10\" name=\"Help\" /><frame id=\"10:11\" name=\"Login\" /><frame id=\"10:12\" name=\"Sign up\" /><frame id=\"10:13\" name=\"Password reset\" /><frame id=\"10:14\" name=\"Empty states\" /><frame id=\"10:15\" name=\"Error states\" /><frame id=\"10:16\" name=\"Components\" /></canvas>",
  "variables": { "color/primary": "#4F46E5", "color/bg": "#F8FAFC", "color/surface": "#FFFFFF", "color/text": "#0F172A", "color/border": "#E2E8F0", "color/input-border": "#CBD5E1", "radius/md": "12" },
  "nodes": {
    "0:1": { "name": "App — all screens", "tooLarge": true },
    "12:34": {
      "name": "Checkout",
      "screenshot": "assets/checkout.png",
      "metadata": "<frame id=\"12:34\" name=\"Checkout\" width=\"1440\" height=\"900\"><text name=\"Title\" /><frame name=\"Form\"><instance name=\"Input/Nome\" /><instance name=\"Input/E-mail\" /><instance name=\"Input/Cartão\" /><instance name=\"Button/Primary\" /></frame><frame name=\"Summary\" /></frame>",
      "designContext": "Frame \"Checkout\" (1440×900, fill color/bg). Container max-width 960, padding 40×24, 2-column grid (2fr 1fr), gap 24.\n- Title \"Checkout\" spanning both columns, Arial Bold 32px.\n- Form card (fill color/surface, 1px color/border, radius/md, padding 24): labeled inputs Nome, E-mail (type email), Cartão — label bold, margin-bottom 8; input padding 12, 1px color/input-border, radius 8, margin-bottom 16; full-width primary button \"Pagar R$ 49\".\n- Summary card (same card style): rows \"Plano Pro — R$ 49\" and \"Total — R$ 49\", label left and bold value right."
    }
  }
}
```

`evals/figma/asset.json`:
```json
{
  "fileKey": "ASSET01",
  "metadata": "<canvas id=\"0:1\" name=\"Marketing\"><frame id=\"7:1\" name=\"Landing hero\" width=\"1440\" height=\"900\"><rectangle id=\"7:2\" name=\"hero-image\" width=\"524\" height=\"349\" fills=\"IMAGE\" /></frame></canvas>",
  "variables": { "color/primary": "#4F46E5", "color/text": "#0F172A", "color/muted": "#64748B" },
  "nodes": {
    "7:1": {
      "name": "Landing hero",
      "screenshot": "assets/landing.png",
      "assets": { "hero.png": "assets/hero.png" },
      "designContext": "Frame \"Landing hero\": container max-width 1120, padding 64×24, 2 columns, gap 48, vertically centered.\n- Left: title \"Bem-vindo à Acme\" (Arial Bold 48px, color/text), text \"Ferramentas simples para times que entregam.\" (18px, color/muted), primary button \"Criar conta\".\n- Right: image fill \"hero.png\" (node 7:2, rounded 12, full column width). This is a real image asset of the file — download it with download_assets; alt text: \"Pessoas colaborando em frente a um painel\"."
    }
  }
}
```

- [ ] **Step 6: Fixtures**

`evals/fixtures/vanilla-app/README.md`:
```md
# Acme site (HTML/CSS/JS)

- Design tokens: `styles/tokens.css` (CSS custom properties). Always use them.
- Reusable components: `components/*.css` (`.btn`, `.btn--primary`, `.card`).
- Pages live in `pages/`; each page links the tokens, base styles and the components it uses.
```

`evals/fixtures/vanilla-app/styles/tokens.css`:
```css
:root {
  --color-primary: #4F46E5;
  --color-primary-contrast: #FFFFFF;
  --color-bg: #F8FAFC;
  --color-surface: #FFFFFF;
  --color-text: #0F172A;
  --color-muted: #64748B;
  --color-border: #E2E8F0;
  --radius-md: 12px;
  --space-2: 8px;
  --space-4: 16px;
  --space-6: 24px;
  --space-10: 40px;
  --font-title: 40px;
}
```

`evals/fixtures/vanilla-app/styles/base.css`:
```css
* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 16px; background: var(--color-bg); color: var(--color-text); }
```

`evals/fixtures/vanilla-app/components/button.css`:
```css
.btn { display: inline-block; padding: 12px 20px; border-radius: 8px; font-weight: 700; text-decoration: none; border: 0; cursor: pointer; }
.btn--primary { background: var(--color-primary); color: var(--color-primary-contrast); }
.btn:focus-visible { outline: 3px solid var(--color-text); outline-offset: 2px; }
```

`evals/fixtures/vanilla-app/components/card.css`:
```css
.card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-6); }
```

`evals/fixtures/vanilla-app/index.html`:
```html
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Acme</title>
<link rel="stylesheet" href="styles/tokens.css">
<link rel="stylesheet" href="styles/base.css">
<link rel="stylesheet" href="components/button.css">
<link rel="stylesheet" href="components/card.css">
</head>
<body>
<main style="max-width:1120px;margin:0 auto;padding:var(--space-10) var(--space-6)">
  <h1>Acme</h1>
  <div class="card"><p>Bem-vindo.</p><a class="btn btn--primary" href="pages/about.html">Sobre nós</a></div>
</main>
</body>
</html>
```

`evals/fixtures/vanilla-app/pages/about.html`:
```html
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sobre — Acme</title>
<link rel="stylesheet" href="../styles/tokens.css">
<link rel="stylesheet" href="../styles/base.css">
<link rel="stylesheet" href="../components/button.css">
<link rel="stylesheet" href="../components/card.css">
</head>
<body>
<main style="max-width:1120px;margin:0 auto;padding:var(--space-10) var(--space-6)">
  <h1>Sobre</h1>
  <div class="card"><p>Fazemos ferramentas.</p><a class="btn btn--primary" href="../index.html">Início</a></div>
</main>
</body>
</html>
```

`evals/fixtures/vanilla-validate/` — `styles/tokens.css` identical to `vanilla-app/styles/tokens.css`; `index.html`:
```html
<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Acme</title></head><body><a href="pages/pricing.html">Planos</a></body></html>
```
`pages/pricing.html` = the full content of `evals/figma/src/pricing.html` with exactly two deliberate differences: the `<style>` block replaced by `<link rel="stylesheet" href="../styles/tokens.css">` plus a `<style>` holding every rule of the reference except `:root`, and in that `<style>` `.card{…padding:var(--space-6)}` → `padding:28px` (spacing +4px) and `.card h2{…font-size:20px}` → `font-size:21px` (font +1px). Tolerances (spec §7): pixel-perfect 0/0 → FAIL; standard spacing 2, font 1 → FAIL (spacing); relaxed spacing 6, font 2 → PASS.

`evals/fixtures/react-app/package.json`:
```json
{ "name": "acme-react", "private": true, "type": "module", "scripts": { "dev": "vite", "build": "tsc && vite build" }, "dependencies": { "react": "^18.3.0", "react-dom": "^18.3.0" }, "devDependencies": { "@types/react": "^18.3.0", "typescript": "^5.6.0", "vite": "^5.4.0" } }
```
`evals/fixtures/react-app/src/components/Button.tsx`:
```tsx
import type { AnchorHTMLAttributes } from 'react';

type ButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: 'primary' | 'secondary' };

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return <a className={`btn btn--${variant} ${className}`.trim()} {...props} />;
}
```
`evals/fixtures/react-app/src/styles/tokens.css`: same content as `vanilla-app/styles/tokens.css`.
`evals/fixtures/react-app/src/App.tsx`:
```tsx
import { Button } from './components/Button';
import './styles/tokens.css';

export default function App() {
  return (
    <main>
      <h1>Acme</h1>
      <Button href="/about">Sobre</Button>
    </main>
  );
}
```

`evals/fixtures/nextjs-app/package.json`:
```json
{ "name": "acme-next", "private": true, "scripts": { "dev": "next dev", "build": "next build" }, "dependencies": { "next": "^15.0.0", "react": "^19.0.0", "react-dom": "^19.0.0" }, "devDependencies": { "typescript": "^5.6.0", "@types/react": "^19.0.0" } }
```
`evals/fixtures/nextjs-app/components/ui/Button.tsx`:
```tsx
import Link from 'next/link';
import type { ReactNode } from 'react';

export function Button({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="btn btn--primary">
      {children}
    </Link>
  );
}
```
`evals/fixtures/nextjs-app/app/globals.css`: the tokens (`:root{…}` from `vanilla-app/styles/tokens.css`) followed by the `.btn`/`.btn--primary` rules from `vanilla-app/components/button.css`.
`evals/fixtures/nextjs-app/app/layout.tsx`:
```tsx
import './globals.css';
import type { ReactNode } from 'react';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
```
`evals/fixtures/nextjs-app/app/page.tsx`:
```tsx
import { Button } from '@/components/ui/Button';

export default function Home() {
  return (
    <main>
      <h1>Acme</h1>
      <Button href="/about">Sobre</Button>
    </main>
  );
}
```
`evals/fixtures/nextjs-app/tsconfig.json`:
```json
{ "compilerOptions": { "strict": true, "jsx": "preserve", "baseUrl": ".", "paths": { "@/*": ["./*"] } } }
```

`evals/fixtures/vue-app/package.json`:
```json
{ "name": "acme-vue", "private": true, "type": "module", "scripts": { "dev": "vite" }, "dependencies": { "vue": "^3.5.0" }, "devDependencies": { "@vitejs/plugin-vue": "^5.1.0", "typescript": "^5.6.0", "vite": "^5.4.0" } }
```
`evals/fixtures/vue-app/src/components/BaseButton.vue`:
```vue
<script setup lang="ts">
defineProps<{ href: string; variant?: 'primary' | 'secondary' }>();
</script>

<template>
  <a :href="href" :class="['btn', `btn--${variant ?? 'primary'}`]"><slot /></a>
</template>
```
`evals/fixtures/vue-app/src/App.vue`:
```vue
<script setup lang="ts">
import BaseButton from './components/BaseButton.vue';
import './styles/tokens.css';
</script>

<template>
  <main>
    <h1>Acme</h1>
    <BaseButton href="/about">Sobre</BaseButton>
  </main>
</template>
```
`evals/fixtures/vue-app/src/styles/tokens.css`: same as `vanilla-app/styles/tokens.css`.

`evals/fixtures/nuxt-app/package.json`:
```json
{ "name": "acme-nuxt", "private": true, "scripts": { "dev": "nuxt dev" }, "dependencies": { "nuxt": "^3.13.0", "vue": "^3.5.0" } }
```
`evals/fixtures/nuxt-app/nuxt.config.ts`:
```ts
export default defineNuxtConfig({ css: ['~/assets/css/tokens.css'] });
```
`evals/fixtures/nuxt-app/components/BaseButton.vue`: same content as the Vue `BaseButton.vue`.
`evals/fixtures/nuxt-app/pages/index.vue`:
```vue
<template>
  <main>
    <h1>Acme</h1>
    <BaseButton href="/about">Sobre</BaseButton>
  </main>
</template>
```
`evals/fixtures/nuxt-app/assets/css/tokens.css`: same as `vanilla-app/styles/tokens.css`.

`evals/fixtures/angular-app/package.json`:
```json
{ "name": "acme-angular", "private": true, "scripts": { "start": "ng serve" }, "dependencies": { "@angular/common": "^18.2.0", "@angular/core": "^18.2.0", "@angular/platform-browser": "^18.2.0" }, "devDependencies": { "@angular/cli": "^18.2.0", "typescript": "^5.5.0" } }
```
`evals/fixtures/angular-app/angular.json`:
```json
{ "version": 1, "projects": { "acme": { "projectType": "application", "root": "", "sourceRoot": "src", "architect": { "build": { "builder": "@angular-devkit/build-angular:application", "options": { "browser": "src/main.ts", "styles": ["src/styles.css"] } } } } } }
```
`evals/fixtures/angular-app/src/app/shared/button/button.component.ts`:
```ts
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-button',
  standalone: true,
  template: `<a [attr.href]="href" class="btn btn--primary"><ng-content /></a>`
})
export class ButtonComponent {
  @Input({ required: true }) href!: string;
}
```
`evals/fixtures/angular-app/src/app/app.component.ts`:
```ts
import { Component } from '@angular/core';
import { ButtonComponent } from './shared/button/button.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ButtonComponent],
  template: `<main><h1>Acme</h1><app-button href="/about">Sobre</app-button></main>`
})
export class AppComponent {}
```
`evals/fixtures/angular-app/src/styles.css`: tokens + button rules (as in `nextjs-app/app/globals.css`).

`evals/fixtures/tailwind-app/package.json`:
```json
{ "name": "acme-tailwind", "private": true, "scripts": { "build:css": "tailwindcss -i src/input.css -o dist/output.css" }, "devDependencies": { "tailwindcss": "^3.4.0" } }
```
`evals/fixtures/tailwind-app/tailwind.config.js`:
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.html'],
  theme: {
    extend: {
      colors: { primary: '#4F46E5', surface: '#FFFFFF', muted: '#64748B', border: '#E2E8F0', ink: '#0F172A' },
      borderRadius: { md: '12px' }
    }
  }
};
```
`evals/fixtures/tailwind-app/src/input.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```
`evals/fixtures/tailwind-app/src/index.html`:
```html
<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Acme</title><link rel="stylesheet" href="../dist/output.css"></head>
<body class="bg-slate-50 text-ink">
<main class="mx-auto max-w-5xl px-6 py-10">
  <h1 class="text-4xl font-bold">Acme</h1>
  <a class="mt-4 inline-block rounded-lg bg-primary px-5 py-3 font-bold text-white" href="about.html">Sobre</a>
</main>
</body>
</html>
```

`evals/fixtures/php-app/composer.json`:
```json
{ "name": "acme/site", "type": "project", "require": { "php": ">=8.1" } }
```
`evals/fixtures/php-app/templates/partials/button.php`:
```php
<?php
/** @var string $label */
/** @var string $href */
?>
<a class="btn btn--primary" href="<?= htmlspecialchars($href, ENT_QUOTES) ?>"><?= htmlspecialchars($label, ENT_QUOTES) ?></a>
```
`evals/fixtures/php-app/templates/layout.php`:
```php
<?php /** @var string $content */ ?>
<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Acme</title><link rel="stylesheet" href="/css/tokens.css"></head>
<body><?= $content /* already-rendered HTML from a template */ ?></body>
</html>
```
`evals/fixtures/php-app/public/index.php`:
```php
<?php
function render(string $template, array $vars = []): string {
    extract($vars);
    ob_start();
    include __DIR__ . '/../templates/' . $template;
    return ob_get_clean();
}
$label = 'Sobre';
$href = '/about.php';
$content = '<main><h1>Acme</h1>' . render('partials/button.php', compact('label', 'href')) . '</main>';
echo render('layout.php', compact('content'));
```
`evals/fixtures/php-app/public/css/tokens.css`: tokens + button rules.

- [ ] **Step 7: Scenarios** — one file per scenario in `evals/scenarios/`, named `<id>.json`.

Common prompt tail for base/profile scenarios (append verbatim where the scenario says "+ TAIL"):
` Siga o workflow das skills do kit (Figma como fonte de verdade, reuso do que já existe, validação com as tools do frontend-agent). O projeto é servido em {{baseUrl}}. Termine com um resumo do que fez e das diferenças conhecidas.`

`base-simple-screen.json`:
```json
{
  "id": "base-simple-screen",
  "category": "base",
  "title": "Tela simples a partir do Figma",
  "fixture": "vanilla-app",
  "figma": "pricing",
  "profile": "standard",
  "prompt": "Implemente o frame Pricing do Figma (https://www.figma.com/design/PRICING01/Pricing?node-id=1-2) como pages/pricing.html. Siga o workflow das skills do kit (Figma como fonte de verdade, reuso do que já existe, validação com as tools do frontend-agent). O projeto é servido em {{baseUrl}}. Termine com um resumo do que fez e das diferenças conhecidas.",
  "timeoutSec": 1200,
  "expected": [
    { "type": "tool_called", "tool": "skill/figma-to-code", "description": "leu/invocou a skill figma-to-code" },
    { "type": "tool_called", "tool": "figma/get_design_context", "args": { "nodeId": "^1[:-]2$" } },
    { "type": "tool_called", "tool": "figma/get_screenshot" },
    { "type": "tool_called", "tool": "frontend-agent/capture_screenshot" },
    { "type": "file_exists", "path": "pages/pricing.html" },
    { "type": "file_matches", "glob": "pages/pricing.html", "pattern": "tokens\\.css" }
  ],
  "forbidden": [
    { "type": "file_matches", "glob": "pages/pricing.html", "pattern": "#4[Ff]46[Ee]5", "description": "cor primária hardcoded em vez do token" },
    { "type": "tool_called", "tool": "frontend-agent/capture_screenshot", "args": { "url": "^(?!http://(127\\.0\\.0\\.1|localhost)[:/])" }, "description": "screenshot fora do localhost" }
  ]
}
```

`base-existing-components.json`:
```json
{
  "id": "base-existing-components",
  "category": "base",
  "title": "Reuso de componentes existentes",
  "fixture": "vanilla-app",
  "figma": "pricing",
  "profile": "standard",
  "prompt": "Implemente o frame Pricing do Figma (https://www.figma.com/design/PRICING01/Pricing?node-id=1-2) como pages/pricing.html, reaproveitando o que o projeto já tem. Siga o workflow das skills do kit (Figma como fonte de verdade, reuso do que já existe, validação com as tools do frontend-agent). O projeto é servido em {{baseUrl}}. Termine com um resumo do que fez e das diferenças conhecidas.",
  "timeoutSec": 1200,
  "expected": [
    { "type": "tool_called", "tool": "figma/get_design_context", "args": { "nodeId": "^1[:-]2$" } },
    { "type": "file_matches", "glob": "pages/pricing.html", "pattern": "components/button\\.css" },
    { "type": "file_matches", "glob": "pages/pricing.html", "pattern": "class=\"[^\"]*\\bbtn--primary\\b" },
    { "type": "file_matches", "glob": "pages/pricing.html", "pattern": "class=\"[^\"]*\\bcard\\b" }
  ],
  "forbidden": [
    { "type": "file_matches", "glob": "pages/**", "pattern": "\\.btn(--primary)?\\s*\\{", "description": "redefiniu o botão existente" },
    { "type": "file_matches", "glob": "components/*.css", "pattern": "\\.(pricing-)?(button|btn)-(primary|cta)\\b", "description": "criou um botão paralelo" }
  ]
}
```

`base-mobile.json`:
```json
{
  "id": "base-mobile",
  "category": "base",
  "title": "Desktop + mobile responsivo",
  "fixture": "vanilla-app",
  "figma": "pricing",
  "profile": "standard",
  "prompt": "Implemente pages/pricing.html a partir do Figma: desktop no frame Pricing (https://www.figma.com/design/PRICING01/Pricing?node-id=1-2) e mobile no frame Pricing / Mobile (node-id=1-50). Siga o workflow das skills do kit (Figma como fonte de verdade, reuso do que já existe, validação com as tools do frontend-agent). O projeto é servido em {{baseUrl}}. Termine com um resumo do que fez e das diferenças conhecidas.",
  "timeoutSec": 1200,
  "expected": [
    { "type": "tool_called", "tool": "figma/get_design_context", "args": { "nodeId": "^1[:-]50$" } },
    { "type": "tool_called", "tool": "frontend-agent/run_responsive_suite" },
    { "type": "file_matches", "glob": "{pages,components,styles}/**", "pattern": "@media" }
  ],
  "forbidden": [
    { "type": "file_matches", "glob": "pages/pricing.html", "pattern": "(min-)?width:\\s*1440px", "description": "largura fixa de desktop" }
  ]
}
```

`base-motion.json`:
```json
{
  "id": "base-motion",
  "category": "base",
  "title": "Hero com motion do Figma",
  "fixture": "vanilla-app",
  "figma": "motion",
  "profile": "standard",
  "prompt": "Implemente o frame Hero do Figma (https://www.figma.com/design/MOTION01/Home?node-id=5-1) como pages/hero.html, incluindo a animação de entrada. Siga o workflow das skills do kit (Figma como fonte de verdade, reuso do que já existe, validação com as tools do frontend-agent). O projeto é servido em {{baseUrl}}. Termine com um resumo do que fez e das diferenças conhecidas.",
  "timeoutSec": 1200,
  "expected": [
    { "type": "tool_called", "tool": "figma/get_design_context", "args": { "nodeId": "^5[:-]1$" } },
    { "type": "file_matches", "glob": "{pages,components,styles}/**", "pattern": "prefers-reduced-motion" },
    { "type": "file_matches", "glob": "{pages,components,styles}/**", "pattern": "(200ms|\\.2s)" },
    { "type": "file_matches", "glob": "{pages,components,styles}/**", "pattern": "ease-out" }
  ],
  "forbidden": [
    { "type": "file_matches", "glob": "{pages,components,styles}/**", "pattern": "transition:\\s*all\\b", "description": "transition: all" }
  ]
}
```

`base-large-figma.json`:
```json
{
  "id": "base-large-figma",
  "category": "base",
  "title": "Arquivo Figma grande (metadata primeiro)",
  "fixture": "vanilla-app",
  "figma": "large-file",
  "profile": "standard",
  "prompt": "O arquivo Figma https://www.figma.com/design/LARGE01/App tem todas as telas do app. Implemente a tela Checkout como pages/checkout.html. Siga o workflow das skills do kit (Figma como fonte de verdade, reuso do que já existe, validação com as tools do frontend-agent). O projeto é servido em {{baseUrl}}. Termine com um resumo do que fez e das diferenças conhecidas.",
  "timeoutSec": 1200,
  "expected": [
    { "type": "tool_called", "tool": "figma/get_metadata" },
    { "type": "tool_called", "tool": "figma/get_design_context", "args": { "nodeId": "^12[:-]34$" } },
    { "type": "file_exists", "path": "pages/checkout.html" },
    { "type": "file_matches", "glob": "pages/checkout.html", "pattern": "<label[^>]*for=" }
  ],
  "forbidden": [
    { "type": "tool_called", "tool": "figma/get_design_context", "args": { "nodeId": "^0[:-]1$" }, "description": "pediu o design context da página inteira" }
  ]
}
```

`base-figma-asset.json`:
```json
{
  "id": "base-figma-asset",
  "category": "base",
  "title": "Asset real do Figma",
  "fixture": "vanilla-app",
  "figma": "asset",
  "profile": "standard",
  "prompt": "Implemente o frame Landing hero do Figma (https://www.figma.com/design/ASSET01/Marketing?node-id=7-1) como pages/landing.html. Siga o workflow das skills do kit (Figma como fonte de verdade, reuso do que já existe, validação com as tools do frontend-agent). O projeto é servido em {{baseUrl}}. Termine com um resumo do que fez e das diferenças conhecidas.",
  "timeoutSec": 1200,
  "expected": [
    { "type": "tool_called", "tool": "figma/download_assets" },
    { "type": "file_matches", "glob": "pages/landing.html", "pattern": "<img[^>]*src=\"[^\"]*hero\\.png\"" },
    { "type": "file_matches", "glob": "pages/landing.html", "pattern": "alt=\"[^\"]+\"" }
  ],
  "forbidden": [
    { "type": "file_matches", "glob": "pages/landing.html", "pattern": "placeholder|picsum|unsplash|placehold|dummyimage", "flags": "i", "description": "placeholder no lugar do asset" }
  ]
}
```

`base-visual-divergence.json`:
```json
{
  "id": "base-visual-divergence",
  "category": "base",
  "title": "Divergência visual proposital (reportar, não esconder)",
  "fixture": "vanilla-validate",
  "figma": "pricing",
  "profile": "standard",
  "prompt": "A página pages/pricing.html já foi implementada a partir do frame Pricing do Figma (https://www.figma.com/design/PRICING01/Pricing?node-id=1-2). Não altere nenhum arquivo: apenas valide a página contra o Figma com as tools do frontend-agent e reporte cada divergência encontrada (propriedade, valor esperado, valor encontrado). O projeto é servido em {{baseUrl}}. Termine com uma linha exatamente no formato VEREDITO: PASS ou VEREDITO: FAIL.",
  "timeoutSec": 1200,
  "expected": [
    { "type": "tool_called", "tool": "frontend-agent/compare_screenshots" },
    { "type": "tool_called", "tool": "frontend-agent/inspect_dom" },
    { "type": "output_matches", "pattern": "padding|espaçamento|spacing", "flags": "i" },
    { "type": "output_matches", "pattern": "28\\s*px" },
    { "type": "output_matches", "pattern": "VEREDITO:\\s*FAIL" }
  ],
  "forbidden": [
    { "type": "output_matches", "pattern": "VEREDITO:\\s*PASS" },
    { "type": "tool_called", "tool": "builtin/Edit", "description": "alterou arquivo (claude)" },
    { "type": "tool_called", "tool": "builtin/Write", "description": "alterou arquivo (claude)" },
    { "type": "tool_called", "tool": "builtin/file_change", "description": "alterou arquivo (codex)" }
  ]
}
```

Profile scenarios — same fixture/figma; prompt (identical in the three):
`"A página pages/pricing.html foi implementada a partir do frame Pricing do Figma (https://www.figma.com/design/PRICING01/Pricing?node-id=1-2). Não altere arquivos. Valide-a contra o Figma de acordo com o validationProfile configurado em .frontend-agent/config.yml, usando as tools do frontend-agent. O projeto é servido em {{baseUrl}}. Liste as divergências com a tolerância aplicada e termine com uma linha exatamente no formato VEREDITO: PASS ou VEREDITO: FAIL."`

`profile-pixel-perfect.json`:
```json
{
  "id": "profile-pixel-perfect",
  "category": "profile",
  "title": "pixel-perfect: 4px de espaçamento reprova",
  "fixture": "vanilla-validate",
  "figma": "pricing",
  "profile": "pixel-perfect",
  "prompt": "<the profile prompt above>",
  "timeoutSec": 1200,
  "expected": [
    { "type": "tool_called", "tool": "frontend-agent/inspect_dom" },
    { "type": "tool_called", "tool": "figma/get_variable_defs" },
    { "type": "output_matches", "pattern": "VEREDITO:\\s*FAIL" }
  ],
  "forbidden": [
    { "type": "output_matches", "pattern": "VEREDITO:\\s*PASS" },
    { "type": "tool_called", "tool": "builtin/Edit" },
    { "type": "tool_called", "tool": "builtin/Write" },
    { "type": "tool_called", "tool": "builtin/file_change" }
  ]
}
```

`profile-standard.json`: same as pixel-perfect with `"id": "profile-standard"`, `"title": "standard: 4px de espaçamento (> 2px) reprova"`, `"profile": "standard"`, and `expected` = `[{ "type": "tool_called", "tool": "frontend-agent/compare_screenshots" }, { "type": "tool_called", "tool": "frontend-agent/inspect_dom" }, { "type": "output_matches", "pattern": "VEREDITO:\\s*FAIL" }]`; same `forbidden`.

`profile-relaxed.json`: `"id": "profile-relaxed"`, `"title": "relaxed: 4px/1px dentro da tolerância aprova"`, `"profile": "relaxed"`, `expected` = `[{ "type": "tool_called", "tool": "frontend-agent/compare_screenshots" }, { "type": "tool_called", "tool": "frontend-agent/inspect_dom" }, { "type": "output_matches", "pattern": "VEREDITO:\\s*PASS" }]`, `forbidden` = `[{ "type": "output_matches", "pattern": "VEREDITO:\\s*FAIL" }, { "type": "tool_called", "tool": "builtin/Edit" }, { "type": "tool_called", "tool": "builtin/Write" }, { "type": "tool_called", "tool": "builtin/file_change" }]`.

(Write the literal profile prompt into each file — the `<the profile prompt above>` marker is only this plan's shorthand for the quoted text right above it.)

Stack scenarios — `figma: "pricing"`, `profile: "standard"`, `timeoutSec: 900`. Prompt pattern (fill `<PATH>`): `"Implemente o componente PricingCard do Figma (https://www.figma.com/design/PRICING01/Pricing?node-id=1-10) em <PATH>, seguindo as convenções deste projeto e reutilizando o botão que já existe. Use as skills do kit. Não é preciso rodar o app nem instalar dependências."` Every stack scenario's `expected` starts with `{ "type": "tool_called", "tool": "figma/get_design_context", "args": { "nodeId": "^1[:-]10$" } }` and `{ "type": "tool_called", "tool": "reference/<stack>" }`, followed by the rows below.

| id | fixture | `<PATH>` | extra `expected` | `forbidden` |
|---|---|---|---|---|
| stack-react | react-app | `src/components/PricingCard.tsx` | file_matches `src/components/PricingCard.tsx` `export (default )?function PricingCard\|export const PricingCard`; file_matches same `import[^;]*\\bButton\\b[^;]*from` | file_matches same `\\bclass=` (React usa className) |
| stack-nextjs | nextjs-app | `components/PricingCard.tsx` | file_matches `components/PricingCard.tsx` `PricingCard`; file_matches same `import[^;]*\\bButton\\b[^;]*from` | file_matches same `^\\s*['\"]use client['\"]` (componente estático não precisa ser client) |
| stack-vuejs | vue-app | `src/components/PricingCard.vue` | file_matches `src/components/PricingCard.vue` `<script setup`; file_matches same `<BaseButton` | file_matches same `data\\s*\\(\\s*\\)\\s*\\{` (Options API) |
| stack-nuxt | nuxt-app | `components/PricingCard.vue` | file_matches `components/PricingCard.vue` `<BaseButton` | file_matches same `import\\s+BaseButton\\s+from` (Nuxt auto-importa) |
| stack-angular | angular-app | `src/app/pricing-card/pricing-card.component.ts` | file_matches `src/app/pricing-card/**` `@Component`; file_matches same `ButtonComponent\|<app-button` | file_matches same `document\\.querySelector` |
| stack-tailwind | tailwind-app | `src/components/pricing-card.html` | file_matches `src/components/pricing-card.html` `\\b(bg\|text)-primary\\b`; file_matches same `rounded-md` | file_matches same `-\\[#[0-9A-Fa-f]{3,8}\\]` (hex arbitrário em vez do tema) |
| stack-php | php-app | `templates/partials/pricing-card.php` | file_matches `templates/partials/pricing-card.php` `htmlspecialchars`; file_matches same `partials/button\\.php` | file_matches same `<\\?=\\s*\\$[A-Za-z_]+\\s*\\?>` (echo sem escape) |
| stack-html-css-js | vanilla-app | `components/pricing-card.css (estilos) e pages/pricing-card.html (exemplo de uso)` | file_matches `components/pricing-card.css` `var\\(--(color\|space\|radius)-`; file_matches `pages/pricing-card.html` `btn--primary` | file_matches `components/pricing-card.css` `#4[Ff]46[Ee]5` |

In the table `\|` is an escaped pipe inside the Markdown cell — the JSON pattern contains a plain `|`. Titles: `"PricingCard em React"`, `"… em Next.js"`, `"… em Vue"`, `"… em Nuxt"`, `"… em Angular"`, `"… em Tailwind"`, `"… em PHP"`, `"… em HTML/CSS/JS"` (write "PricingCard em …" in full).

`evals/README.md`:
```md
# Evals

- `scenarios/*.json` — one scenario per file (schema: `packages/evals/src/schema.ts`). `expected` must all hold, `forbidden` must never hold. Tool names: `<server>/<tool>`, `skill/<name>`, `reference/<name>`, `builtin/<name>`.
- `fixtures/<name>/` — the project copied into a temp workspace for each run. No symlinks.
- `figma/<name>.json` — what the Figma mock (`packages/evals/src/figma-mock`) returns; `figma/src/*.html` are the reference designs rendered into `figma/assets/*.png` by `npm run render-figma-assets --workspace=packages/evals`.
- `results/` — bench output (gitignored).

Validate for free: `npm run evals:validate`. Run for real (costs tokens): `npm run bench -- --host claude --scenario base-simple-screen`.
```

- [ ] **Step 8: Run tests and validate**

Run: `cd packages/evals && npm test && npx tsc --noEmit && cd ../.. && npm run evals:validate`
Expected: all tests pass; `ok: 18 scenarios`.

- [ ] **Step 9: Commit**

```bash
git add evals packages/evals && git commit -m "evals: 18 scenarios (7 base, 8 stack, 3 profile), fixtures, Figma mock data and rendered reference designs"
```

---

### Task 10: Docs, full verification, smoke run, release prep

**Files:**
- Modify: `README.md` (new section "Evals and benchmark (v0.5)"; update "What's in" line if it lists versions), `docs/superpowers/specs/2026-09-23-frontend-agent-kit-design.md` (§10 v0.5 line → "concluída" note is not needed; leave the spec as is)

- [ ] **Step 1: README section** — add after the "Validate the kit's own skills" section:

```md
## Evals and benchmark (v0.5)

The kit ships 18 eval scenarios (`evals/scenarios`): 7 base (simple screen, existing components, mobile, motion, large Figma file, Figma asset, deliberate visual divergence), 8 stack (React, Next.js, Vue, Nuxt, Angular, Tailwind, PHP, HTML/CSS/JS) and 3 validation profiles (pixel-perfect, standard, relaxed). Each has deterministic `expected`/`forbidden` assertions on the tools the agent called, its final answer and the files it left behind. The Figma MCP is replaced by a mock (`packages/evals/src/figma-mock`) that serves recorded design data under the same server/tool names.

```bash
npm test                      # all packages, offline, free
npm run evals:validate        # validate the scenario catalog, free
npm run bench -- --list
npm run bench -- --host claude --scenario base-simple-screen        # costs tokens
npm run bench -- --host all --category stack --model-claude opus    # Claude vs Codex
```

Each run copies the fixture into `$TMPDIR/fak-bench-*`, installs the kit into it, serves it on `127.0.0.1:<random port>` and starts the host headless with only the kit MCP and the Figma mock:

- Claude Code: `claude -p … --strict-mcp-config --setting-sources project --permission-mode acceptEdits --allowedTools Read,Edit,Write,Glob,Grep,Skill,ToolSearch,mcp__frontend-agent,mcp__figma` (no Bash).
- Codex: `codex exec --json --ignore-user-config --sandbox workspace-write --ephemeral`, MCP servers passed with `-c` (no project trust needed) and their tools auto-approved.

Results land in `evals/results/<timestamp>/` (`report.md`, `summary.json`, transcripts). A timeout, a crash, a missing/unauthenticated host or a truncated transcript is `error`, never `pass`. `--keep` keeps the workspaces for inspection.
```

Also, in the CLI section, add one line under verify: "`verify` also compares installed skill files with the kit: kit files newer than the installed copy fail the check (run install); local edits are reported but accepted."

- [ ] **Step 2: Full verification**

Run:
```bash
cd /home/andre/frontend-agent-kit && npm test 2>&1 | grep -E "^# (tests|pass|fail)" && \
  (cd packages/cli && npx tsc --noEmit) && (cd packages/evals && npx tsc --noEmit) && (cd packages/mcp-server && npx tsc --noEmit) && \
  npm run validate:skills && npm run evals:validate
```
Expected: three `# fail 0` blocks, typecheck clean in the three packages, skills valid, `ok: 18 scenarios`. Also `ls /tmp | grep fak-bench-` → nothing left over by the tests.

- [ ] **Step 3: Commit**

```bash
git add README.md && git commit -m "Document the v0.5 eval suite and benchmark"
```

- [ ] **Step 4: Smoke run with real hosts — ask the user first (costs tokens)**

With the user's OK:
```bash
npm run bench -- --host all --scenario base-simple-screen --scenario stack-react
```
Expected: 4 cases, each `pass`/`fail` (not `error`), `report.md` written. An `error` here means a wiring problem (flags, auth, MCP startup) — debug it before the final review, using the transcript and stderr in the report. Pass rate itself is a *measurement*, not a gate.

- [ ] **Step 5: Final branch review** (one strong-model reviewer over `main..feature/v0.5`), fix findings, then merge to `main`, tag `v0.5.0`, remove the branch, update `/home/andre/QUEST_PROGRESS.md`.

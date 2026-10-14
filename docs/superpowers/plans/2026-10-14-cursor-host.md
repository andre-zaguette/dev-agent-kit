# Cursor Host Implementation Plan (v1.2 block D)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Cursor from a stub into a real host: `dev-agent install cursor` / `verify cursor` write and check `.agents/skills/`, the `AGENTS.md` block and `.cursor/mcp.json`, with the block E integrations working on it.

**Architecture:** A standalone `CursorAdapter` (like the Claude and Codex adapters) shares skills and instructions with Codex (`.agents/skills/`, the `AGENTS.md` block, Codex's template text) and adds only `.cursor/mcp.json`. The JSON-with-`mcpServers` logic that is private to the Claude adapter moves to a shared `src/mcp-json.ts`, used by both. `--all` keeps selecting claude + codex through a new `ALL_FLAG_HOSTS` list; Cursor is chosen by name or by detection.

**Tech Stack:** TypeScript (ESM, via `tsx`), `node:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-14-cursor-host-design.md`

All commands run from `<worktree>/packages/cli` unless stated. One test file: `node --import tsx --test tests/<file>.test.ts`. Whole package: `npm test`. Types: `npm run typecheck`. Full suite from the worktree root: `npm test`.

## Global Constraints

- `install` writes only inside the project and never installs software; the kit never writes `~/.cursor` (spec Safety).
- Output for `claude` and `codex`, including `install --all` and `--all --no-figma`, stays byte-identical: the golden fixtures under `tests/fixtures/golden/default` and `tests/fixtures/golden/no-figma` must not change (spec Goals 4, Testing 1).
- `--all` selects exactly `['claude', 'codex']`; `REAL_HOSTS` becomes `['claude', 'codex', 'cursor']` and is used only for detection (spec CLI behavior).
- Cursor's files: skills in `<project>/.agents/skills`, instructions in `<project>/AGENTS.md` (text from `instructionsContent(ctx, 'codex')`), MCP in `<project>/.cursor/mcp.json` (top-level `mcpServers`, stdio entries `{ type: 'stdio', command, args, env }`).
- The Figma entry on Cursor is `{ url: FIGMA_MCP_URL }` (no `type`, no authentication hint); the Headroom entry on Cursor is `{ type: 'stdio', command: <abs>, args: ['mcp','serve'] }`.
- `claude-mem` and `cartographer` stay claude-only; `figma`, `headroom` and `graphify` add `cursor` to their hosts.
- Existing user entries and content are preserved; a failure in any host's preflight writes nothing in any host (fail closed).
- Error messages keep the `frontend-agent: ` prefix and the exact existing messages for JSON problems (`cannot parse <file>: ...`, `<file> must contain a JSON object`, `"mcpServers" in <file> must be an object`).
- VS Code stays a stub (`install vscode` still fails with "not supported yet").

## Review Focus

Failure modes the spec implies but no obvious task exercises; each gets a test in the owning task.

1. `.cursor` is a symlink pointing outside the project, or a regular file → preflight refuses, nothing is written in any host (Tasks 3, 4).
2. `.cursor/mcp.json` already holds the user's servers, including their own `figma` or `headroom` entry → kept and reported, never overwritten (Tasks 3, 5).
3. `install codex` then `install cursor`, the reverse order, and a repeat → `AGENTS.md` block not duplicated, skills manifest not rewritten (Task 3).
4. `CLAUDE.md` is a symlink to `AGENTS.md` → installing `claude` then `cursor` leaves both texts present exactly once (Task 3).
5. `install --all` creates no `.cursor/`; `--with claude-mem` with only `cursor` selected is a usage error naming `claude` (Tasks 4, 5).
6. An unparsable `.cursor/mcp.json` together with `install --all cursor`-style multi-host selection (`install claude cursor`) → exit 1, nothing written for claude either (Task 4).

---

### Task 1: Shared `mcp-json.ts` and the Claude adapter refactor

**Files:**
- Create: `packages/cli/src/mcp-json.ts`
- Create: `packages/cli/tests/mcp-json.test.ts`
- Modify: `packages/cli/src/adapters/claude.ts` (replace the private JSON logic with the helpers)

**Interfaces:**
- Consumes: `SERVER_NAME`, `ServerLaunch` from `src/mcp-launch.ts`; `McpServerChange` from `src/integrations/types.ts`.
- Produces (used by Task 2):
  - `type McpJson = { mcpServers?: Record<string, Record<string, unknown>> } & Record<string, unknown>`
  - `readMcpJsonFile(file: string): McpJson`
  - `applyExtraServers(servers: Record<string, Record<string, unknown>>, extras: readonly McpServerChange[], file: string): string[]` (mutates `servers`, returns the action lines)
  - `readConfiguredServers(file: string): Record<string, unknown> | null`
  - `readConfiguredLaunch(file: string): { launch: ServerLaunch | null; error?: string }`

- [ ] **Step 1: Write the failing helper tests**

```ts
// packages/cli/tests/mcp-json.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readMcpJsonFile, applyExtraServers, readConfiguredServers, readConfiguredLaunch } from '../src/mcp-json.ts';

function withFile(content: string | null, fn: (file: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-json-'));
  const file = join(dir, 'mcp.json');
  if (content !== null) writeFileSync(file, content);
  try {
    fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('readMcpJsonFile: missing file is {}, other top-level keys survive', () => {
  withFile(null, (file) => assert.deepEqual(readMcpJsonFile(file), {}));
  withFile('{"mcpServers":{"a":{"command":"x"}},"other":1}', (file) => {
    assert.deepEqual(readMcpJsonFile(file), { mcpServers: { a: { command: 'x' } }, other: 1 });
  });
});

test('readMcpJsonFile: the three error messages are unchanged', () => {
  withFile('{nope', (file) => assert.throws(() => readMcpJsonFile(file), /^Error: frontend-agent: cannot parse .*mcp\.json: /));
  withFile('[]', (file) => assert.throws(() => readMcpJsonFile(file), /frontend-agent: .*mcp\.json must contain a JSON object/));
  withFile('{"mcpServers":[]}', (file) => assert.throws(() => readMcpJsonFile(file), /frontend-agent: "mcpServers" in .*mcp\.json must be an object/));
  withFile('{"mcpServers":null}', (file) => assert.throws(() => readMcpJsonFile(file), /"mcpServers" in .* must be an object/));
});

test('applyExtraServers: adds with the registered line, keeps an existing entry, appends the hint', () => {
  const servers: Record<string, Record<string, unknown>> = { figma: { url: 'https://custom' } };
  const actions = applyExtraServers(
    servers,
    [
      { name: 'figma', entry: { url: 'https://mcp.figma.com/mcp' } },
      { name: 'headroom', entry: { type: 'stdio', command: '/x/headroom', args: ['mcp', 'serve'] } },
      { name: 'other', entry: { url: 'u' }, hint: 'authenticate with: x' }
    ],
    '/p/.cursor/mcp.json'
  );
  assert.deepEqual(servers.figma, { url: 'https://custom' });
  assert.deepEqual(servers.headroom, { type: 'stdio', command: '/x/headroom', args: ['mcp', 'serve'] });
  assert.deepEqual(actions, [
    'figma MCP server already configured in /p/.cursor/mcp.json — kept',
    'headroom MCP server registered in /p/.cursor/mcp.json',
    'other MCP server registered in /p/.cursor/mcp.json (authenticate with: x)'
  ]);
});

test('readConfiguredServers: {} without a file, a copy of the servers, null on an error', () => {
  withFile(null, (file) => assert.deepEqual(readConfiguredServers(file), {}));
  withFile('{"mcpServers":{"a":{"command":"x"}}}', (file) => assert.deepEqual(readConfiguredServers(file), { a: { command: 'x' } }));
  withFile('{nope', (file) => assert.equal(readConfiguredServers(file), null));
});

test('readConfiguredLaunch: the kit entry becomes a launch, a missing entry is null, an error is reported', () => {
  withFile('{"mcpServers":{"frontend-agent":{"command":"/t","args":["a",2],"env":{"K":"v"}}}}', (file) => {
    assert.deepEqual(readConfiguredLaunch(file), { launch: { command: '/t', args: ['a', '2'], env: { K: 'v' } } });
  });
  withFile('{"mcpServers":{"frontend-agent":{"args":[]}}}', (file) => assert.deepEqual(readConfiguredLaunch(file), { launch: null }));
  withFile('{"mcpServers":{}}', (file) => assert.deepEqual(readConfiguredLaunch(file), { launch: null }));
  withFile('{nope', (file) => {
    const result = readConfiguredLaunch(file);
    assert.equal(result.launch, null);
    assert.match(result.error ?? '', /cannot parse/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/mcp-json.test.ts`
Expected: FAIL, cannot find module `../src/mcp-json.ts`.

- [ ] **Step 3: Implement the helper (code moved from the Claude adapter)**

```ts
// packages/cli/src/mcp-json.ts
import { existsSync, readFileSync } from 'node:fs';
import { SERVER_NAME, type ServerLaunch } from './mcp-launch.js';
import type { McpServerChange } from './integrations/types.js';

/** A JSON file with a top-level `mcpServers` object: Claude's `.mcp.json` and Cursor's `.cursor/mcp.json`. */
export type McpJson = { mcpServers?: Record<string, Record<string, unknown>> } & Record<string, unknown>;

export function readMcpJsonFile(file: string): McpJson {
  if (!existsSync(file)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`frontend-agent: cannot parse ${file}: ${(error as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`frontend-agent: ${file} must contain a JSON object`);
  }
  const json = parsed as McpJson;
  if (json.mcpServers !== undefined && (typeof json.mcpServers !== 'object' || json.mcpServers === null || Array.isArray(json.mcpServers))) {
    throw new Error(`frontend-agent: "mcpServers" in ${file} must be an object`);
  }
  return json;
}

/** Add each extra server unless one with that name exists (kept). Mutates `servers`; returns the action lines. */
export function applyExtraServers(
  servers: Record<string, Record<string, unknown>>,
  extras: readonly McpServerChange[],
  file: string
): string[] {
  const actions: string[] = [];
  for (const extra of extras) {
    if (servers[extra.name]) {
      actions.push(`${extra.name} MCP server already configured in ${file} — kept`);
    } else {
      servers[extra.name] = extra.entry;
      actions.push(`${extra.name} MCP server registered in ${file}${extra.hint ? ` (${extra.hint})` : ''}`);
    }
  }
  return actions;
}

/** The servers in `file`: {} when it is absent, null when it cannot be parsed. */
export function readConfiguredServers(file: string): Record<string, unknown> | null {
  try {
    return { ...(readMcpJsonFile(file).mcpServers ?? {}) };
  } catch {
    return null;
  }
}

/** How `file` starts the kit's own MCP server, for `verify`. */
export function readConfiguredLaunch(file: string): { launch: ServerLaunch | null; error?: string } {
  let json: McpJson;
  try {
    json = readMcpJsonFile(file);
  } catch (error) {
    return { launch: null, error: (error as Error).message };
  }
  const entry = json.mcpServers?.[SERVER_NAME];
  if (!entry || typeof entry.command !== 'string') return { launch: null };
  return {
    launch: {
      command: entry.command,
      args: Array.isArray(entry.args) ? entry.args.map(String) : [],
      env: (entry.env as Record<string, string> | undefined) ?? {}
    }
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test tests/mcp-json.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Refactor `ClaudeCodeAdapter` onto the helpers**

In `src/adapters/claude.ts`:

1. Replace the imports `import { existsSync, readFileSync, writeFileSync } from 'node:fs';` with `import { existsSync, writeFileSync } from 'node:fs';` (`readFileSync` is no longer used in this file; keep it only if the typecheck says it still is), and add `import { applyExtraServers, readConfiguredLaunch, readConfiguredServers, readMcpJsonFile } from '../mcp-json.js';`. Remove the local `type McpJson = ...` line and the `ServerLaunch` import if it becomes unused.
2. Delete the whole private `readMcpJson()` method. In `preflight` replace `this.readMcpJson();` with `readMcpJsonFile(this.mcpFile);`.
3. In `installMcp` replace `const json = this.readMcpJson();` with `const json = readMcpJsonFile(this.mcpFile);` and replace the `for (const extra of config.extraServers) { ... }` block with:

```ts
    actions.push(...applyExtraServers(servers, config.extraServers, this.mcpFile));
```

4. Delete the private `configuredLaunch()` method; in `verify()` replace `const { launch, error } = this.configuredLaunch();` with `const { launch, error } = readConfiguredLaunch(this.mcpFile);`.
5. Replace the body of `configuredServers()` with `return readConfiguredServers(this.mcpFile);`.

- [ ] **Step 6: Run everything**

Run: `npm run typecheck && npm test`
Expected: all PASS. The golden tests (`integrations-golden.test.ts`) and every existing Claude adapter test pass with no fixture or expectation change; that is the proof the refactor is behavior-neutral.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/mcp-json.ts packages/cli/tests/mcp-json.test.ts packages/cli/src/adapters/claude.ts
git commit -m "cli: share the mcpServers JSON helpers between hosts"
```

---

### Task 2: Integrations list Cursor (hosts, entries, hints)

**Files:**
- Modify: `packages/cli/src/integrations/figma.ts`, `headroom.ts`, `graphify.ts`
- Modify: `packages/cli/tests/integrations-registry.test.ts` (the figma `hosts` expectation)
- Create: `packages/cli/tests/cursor-integrations.test.ts`

**Interfaces:**
- Consumes: Task 1 is not needed here; `Integration` from `src/integrations/types.ts`; `project` from `tests/integration-helpers.ts`.
- Produces (used by every later task): `figma`, `headroom`, `graphify` with `hosts` `['claude','codex','cursor']`; `figma.plan('cursor')` = `[{ name: 'figma', entry: { url: FIGMA_MCP_URL } }]`; `headroom.plan('cursor', present)` = `[{ name: 'headroom', entry: { type: 'stdio', command, args: ['mcp','serve'] } }]`. These land before the adapter so that `figmaServers('cursor')` and a default `install cursor` already carry the Figma entry.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/cli/tests/cursor-integrations.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { figma } from '../src/integrations/figma.ts';
import { headroom } from '../src/integrations/headroom.ts';
import { graphify } from '../src/integrations/graphify.ts';
import { INTEGRATIONS } from '../src/integrations/index.ts';
import { project } from './integration-helpers.ts';

test('hosts: figma, headroom and graphify list cursor; claude-mem and cartographer stay claude-only', () => {
  const hosts = Object.fromEntries(INTEGRATIONS.map((i) => [i.id, [...i.hosts]]));
  assert.deepEqual(hosts.figma, ['claude', 'codex', 'cursor']);
  assert.deepEqual(hosts.headroom, ['claude', 'codex', 'cursor']);
  assert.deepEqual(hosts.graphify, ['claude', 'codex', 'cursor']);
  assert.deepEqual(hosts['claude-mem'], ['claude']);
  assert.deepEqual(hosts.cartographer, ['claude']);
});

test('plans on cursor: figma is the remote url form, headroom is the typed stdio form', () => {
  assert.deepEqual(figma.plan('cursor', { state: 'present' }), [{ name: 'figma', entry: { url: 'https://mcp.figma.com/mcp' } }]);
  assert.deepEqual(headroom.plan('cursor', { state: 'present', binPath: '/abs/headroom' }), [
    { name: 'headroom', entry: { type: 'stdio', command: '/abs/headroom', args: ['mcp', 'serve'] } }
  ]);
  assert.deepEqual(headroom.plan('codex', { state: 'present', binPath: '/abs/headroom' }), [
    { name: 'headroom', entry: { command: '/abs/headroom', args: ['mcp', 'serve'] } }
  ]);
});

test('headroom hints name .cursor/mcp.json on cursor, .mcp.json on claude, and no file on codex', () => {
  const present = { state: 'present', binPath: '/abs/headroom' } as const;
  assert.match(headroom.notes('cursor', present).join(' '), /\.cursor\/mcp\.json/);
  assert.match(headroom.notes('claude', present).join(' '), /\.mcp\.json/);
  assert.doesNotMatch(headroom.notes('claude', present).join(' '), /\.cursor/);
  assert.doesNotMatch(headroom.notes('codex', present).join(' '), /mcp\.json/);
  const { ctx, cleanup } = project();
  try {
    const gone = headroom.verify('cursor', ctx, present, { headroom: { command: '/no/such/headroom', args: ['mcp', 'serve'] } });
    assert.equal(gone[0].warn, true);
    assert.match(gone[0].detail, /\.cursor\/mcp\.json/);
  } finally {
    cleanup();
  }
});

test('graphify verifies on cursor like on the other hosts', () => {
  const { ctx, cleanup } = project();
  try {
    assert.deepEqual(graphify.verify('cursor', ctx, { state: 'present', binPath: '/b/graphify' }, {}).map((c) => [c.ok, !!c.warn]), [[true, false]]);
    assert.equal(graphify.verify('cursor', ctx, { state: 'absent' }, {})[0].warn, true);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/cursor-integrations.test.ts`
Expected: FAIL (hosts lists, plans, hints).

- [ ] **Step 3: Implement**

`src/integrations/figma.ts` — replace the file's `hosts` and `plan`:

```ts
  hosts: ['claude', 'codex', 'cursor'],
```
```ts
  plan(host) {
    if (host === 'codex') return [{ name: 'figma', entry: { url: FIGMA_MCP_URL }, hint: 'authenticate with: codex mcp login figma' }];
    if (host === 'cursor') return [{ name: 'figma', entry: { url: FIGMA_MCP_URL } }];
    return [{ name: 'figma', entry: { type: 'http', url: FIGMA_MCP_URL } }];
  },
```

`src/integrations/headroom.ts`: set `hosts: ['claude', 'codex', 'cursor'],`; in `plan` replace the `const entry = ...` line with:

```ts
    const entry = host === 'codex' ? { command: detection.binPath, args: [...ARGS] } : { type: 'stdio', command: detection.binPath, args: [...ARGS] };
```

and replace the `rerun` function with:

```ts
function rerun(host: string): string {
  if (host === 'claude') return 'remove the headroom entry from .mcp.json, then re-run install --with headroom';
  if (host === 'cursor') return 'remove the headroom entry from .cursor/mcp.json, then re-run install --with headroom';
  return 're-run install --with headroom';
}
```

`src/integrations/graphify.ts`: `hosts: ['claude', 'codex', 'cursor'],`.

Update `tests/integrations-registry.test.ts`: the expectation `assert.deepEqual(figma.hosts, ['claude', 'codex'])` becomes `['claude', 'codex', 'cursor']`. Run the whole suite and fix any other test that lists these hosts the same way (only expectation text, not behavior).

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test tests/cursor-integrations.test.ts && npm run typecheck && npm test`
Expected: PASS everywhere; the existing goldens unchanged (no host list change reaches `--all`: Cursor is not selected there yet).

- [ ] **Step 5: Commit**

```bash
git add -A packages/cli
git commit -m "cli: figma, headroom and graphify list Cursor"
```

---

### Task 3: `CursorAdapter`

**Files:**
- Create: `packages/cli/src/adapters/cursor.ts`
- Create: `packages/cli/tests/cursor-adapter.test.ts`

**Interfaces:**
- Consumes: everything produced by Task 1 and the Cursor integration entries of Task 2; `syncSkills`, `readManifest`, `upsertMarkdownBlock`, `assertInsideRoot`, `preflightMarkdownFile`, `instructionsContent`, `kitServerLaunch`, `SERVER_NAME`, `checkInstructions`, `checkLaunchConfig`, `checkSkills`, `probeServer`, `which`, `assertRealDirInsideRoot` (all already used by the Codex adapter); test helpers `project()`, `fakeBin()`, `figmaServers()` from `tests/integration-helpers.ts`.
- Produces: `class CursorAdapter implements HostAdapter` (`name: 'cursor'`, getters `skillsDir`, `instructionsFile`, `cursorDir`, `mcpFile`). Not wired into `createAdapter` yet (Task 4).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/cli/tests/cursor-adapter.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { CursorAdapter } from '../src/adapters/cursor.ts';
import { CodexAdapter } from '../src/adapters/codex.ts';
import { ClaudeCodeAdapter } from '../src/adapters/claude.ts';
import { figmaServers, fakeBin, project } from './integration-helpers.ts';

const noExtras = (ctx: { kitRoot: string; projectRoot: string }) => ({ kitRoot: ctx.kitRoot, projectRoot: ctx.projectRoot, extraServers: [] });

test('detect: ~/.cursor, or cursor on PATH, otherwise false', async () => {
  const { base, homeDir, ctx, cleanup } = project();
  try {
    assert.equal(await new CursorAdapter(ctx).detect(), false);
    mkdirSync(join(homeDir, '.cursor'));
    assert.equal(await new CursorAdapter(ctx).detect(), true);
  } finally {
    cleanup();
  }
  const second = project();
  try {
    fakeBin(join(second.base, 'bin'), 'cursor');
    assert.equal(await new CursorAdapter({ ...second.ctx, env: { PATH: join(second.base, 'bin') } }).detect(), true);
  } finally {
    second.cleanup();
  }
});

test('skills and instructions go to the Codex locations: .agents/skills and the AGENTS.md block', async () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    const adapter = new CursorAdapter(ctx);
    const report = await adapter.installSkills(join(ctx.kitRoot, 'skills'));
    assert.ok(report.added.includes('figma-to-code/SKILL.md'));
    assert.ok(existsSync(join(projectRoot, '.agents', 'skills', 'visual-validation', 'SKILL.md')));
    assert.equal(existsSync(join(projectRoot, '.claude')), false);
    assert.equal(await adapter.installInstructions(), 'created');
    const agents = readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8');
    assert.match(agents, /\.agents\/skills\//);
    assert.equal(existsSync(join(projectRoot, 'CLAUDE.md')), false);
  } finally {
    cleanup();
  }
});

test('installMcp creates .cursor/mcp.json with the kit server (stdio, typed) and the extras', async () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    const actions = await new CursorAdapter(ctx).installMcp({ ...noExtras(ctx), extraServers: figmaServers('cursor') });
    const file = join(projectRoot, '.cursor', 'mcp.json');
    const json = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(json.mcpServers['frontend-agent'].type, 'stdio');
    assert.equal(json.mcpServers['frontend-agent'].env.FRONTEND_AGENT_PROJECT_ROOT, projectRoot);
    assert.deepEqual(json.mcpServers.figma, { url: 'https://mcp.figma.com/mcp' });
    assert.ok(actions[0].startsWith('frontend-agent MCP server registered in'));
    assert.ok(actions.some((a) => /figma MCP server registered in/.test(a)));
  } finally {
    cleanup();
  }
});

test('installMcp keeps the user servers and a same-name user entry, and a second run is idempotent', async () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    mkdirSync(join(projectRoot, '.cursor'));
    const file = join(projectRoot, '.cursor', 'mcp.json');
    writeFileSync(file, JSON.stringify({ topLevel: 1, mcpServers: { mine: { command: 'x' }, figma: { url: 'https://custom' } } }));
    const adapter = new CursorAdapter(ctx);
    const actions = await adapter.installMcp({ ...noExtras(ctx), extraServers: figmaServers('cursor') });
    const json = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(json.topLevel, 1);
    assert.deepEqual(json.mcpServers.mine, { command: 'x' });
    assert.equal(json.mcpServers.figma.url, 'https://custom');
    assert.ok(actions.some((a) => /figma.*already configured.*kept/.test(a)));
    const first = readFileSync(file, 'utf8');
    await adapter.installMcp({ ...noExtras(ctx), extraServers: figmaServers('cursor') });
    assert.equal(readFileSync(file, 'utf8'), first);
  } finally {
    cleanup();
  }
});

test('preflight refuses unparsable JSON and a non-object mcpServers, and writes nothing', async () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    mkdirSync(join(projectRoot, '.cursor'));
    const file = join(projectRoot, '.cursor', 'mcp.json');
    writeFileSync(file, '{nope');
    await assert.rejects(() => new CursorAdapter(ctx).preflight(noExtras(ctx)), /cannot parse .*mcp\.json/);
    writeFileSync(file, '{"mcpServers":[]}');
    await assert.rejects(() => new CursorAdapter(ctx).preflight(noExtras(ctx)), /"mcpServers" in .* must be an object/);
    assert.equal(existsSync(join(projectRoot, '.agents')), false);
    assert.equal(existsSync(join(projectRoot, 'AGENTS.md')), false);
  } finally {
    cleanup();
  }
});

test('preflight on a clean project writes nothing (no .cursor, no skills)', async () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    await new CursorAdapter(ctx).preflight(noExtras(ctx));
    assert.equal(existsSync(join(projectRoot, '.cursor')), false);
    assert.equal(existsSync(join(projectRoot, '.agents')), false);
  } finally {
    cleanup();
  }
});

test('a .cursor symlink pointing outside the project, or a regular file named .cursor, is refused', async () => {
  const { base, projectRoot, ctx, cleanup } = project();
  try {
    const outside = join(base, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(projectRoot, '.cursor'));
    await assert.rejects(() => new CursorAdapter(ctx).preflight(noExtras(ctx)));
    await assert.rejects(() => new CursorAdapter(ctx).installMcp(noExtras(ctx)));
    assert.equal(existsSync(join(outside, 'mcp.json')), false);
  } finally {
    cleanup();
  }
  const second = project();
  try {
    writeFileSync(join(second.projectRoot, '.cursor'), 'not a directory');
    await assert.rejects(() => new CursorAdapter(second.ctx).preflight(noExtras(second.ctx)));
  } finally {
    second.cleanup();
  }
});

test('sharing with Codex: either order, repeated, leaves one AGENTS.md block and an unchanged skills manifest', async () => {
  for (const order of [['codex', 'cursor'], ['cursor', 'codex']] as const) {
    const { projectRoot, ctx, cleanup } = project();
    try {
      const skills = join(ctx.kitRoot, 'skills');
      const hosts = { codex: new CodexAdapter(ctx), cursor: new CursorAdapter(ctx) };
      for (const name of order) {
        await hosts[name].installSkills(skills);
        await hosts[name].installInstructions();
      }
      const agents = readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8');
      const manifest = readFileSync(join(projectRoot, '.agents', 'skills', '.frontend-agent-kit-manifest.json'), 'utf8');
      assert.equal(agents.split('Dev Agent Kit repository instructions').length - 1, 1, `block duplicated for ${order.join('→')}`);
      for (const name of [...order].reverse()) {
        const report = await hosts[name].installSkills(skills);
        assert.deepEqual([report.added, report.updated, report.removed].map((l) => l.length), [0, 0, 0]);
        assert.equal(await hosts[name].installInstructions(), 'unchanged');
      }
      assert.equal(readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8'), agents);
      assert.equal(readFileSync(join(projectRoot, '.agents', 'skills', '.frontend-agent-kit-manifest.json'), 'utf8'), manifest);
    } finally {
      cleanup();
    }
  }
});

test('CLAUDE.md symlinked to AGENTS.md: claude then cursor keeps both texts, once each, and is stable', async () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    writeFileSync(join(projectRoot, 'AGENTS.md'), '# mine\n');
    symlinkSync('AGENTS.md', join(projectRoot, 'CLAUDE.md'));
    await new ClaudeCodeAdapter(ctx).installInstructions();
    await new CursorAdapter(ctx).installInstructions();
    const text = readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8');
    assert.ok(text.startsWith('# mine\n'));
    assert.equal(text.split('Dev Agent Kit repository instructions').length - 1, 1);
    assert.equal(text.split('Use the skills installed in `.claude/skills/`').length - 1, 1);
    const before = text;
    await new CursorAdapter(ctx).installInstructions();
    await new ClaudeCodeAdapter(ctx).installInstructions();
    assert.equal(readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8'), before);
  } finally {
    cleanup();
  }
});

test('verify: all ok after a full install; a missing server entry fails mcp-config and skips the probe', async () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    const adapter = new CursorAdapter(ctx);
    await adapter.installSkills(join(ctx.kitRoot, 'skills'));
    await adapter.installInstructions();
    await adapter.installMcp(noExtras(ctx));
    const good = await adapter.verify();
    assert.equal(good.ok, true, JSON.stringify(good.checks));
    assert.deepEqual(good.checks.map((c) => c.name), ['skills', 'instructions', 'mcp-config', 'mcp-server']);
    writeFileSync(join(projectRoot, '.cursor', 'mcp.json'), '{"mcpServers":{}}');
    const bad = await adapter.verify();
    assert.equal(bad.ok, false);
    assert.equal(bad.checks.find((c) => c.name === 'mcp-config')?.ok, false);
    assert.match(bad.checks.find((c) => c.name === 'mcp-server')?.detail ?? '', /skipped/);
  } finally {
    cleanup();
  }
});

test('configuredServers: {} without a file, the servers with one, null when unparsable', async () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    const adapter = new CursorAdapter(ctx);
    assert.deepEqual(adapter.configuredServers(), {});
    await adapter.installMcp(noExtras(ctx));
    assert.deepEqual(Object.keys(adapter.configuredServers()!), ['frontend-agent']);
    writeFileSync(join(projectRoot, '.cursor', 'mcp.json'), '{nope');
    assert.equal(adapter.configuredServers(), null);
  } finally {
    cleanup();
  }
});

test('notes mention .cursor/mcp.json absolute paths and the shared skills', () => {
  const { ctx, cleanup } = project();
  try {
    const notes = new CursorAdapter(ctx).notes().join(' ');
    assert.match(notes, /\.cursor\/mcp\.json/);
    assert.match(notes, /absolute paths/);
    assert.match(notes, /\.agents\/skills/);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/cursor-adapter.test.ts`
Expected: FAIL, cannot find module `../src/adapters/cursor.ts`.

- [ ] **Step 3: Implement the adapter**

```ts
// packages/cli/src/adapters/cursor.ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HostAdapter } from './host-adapter.js';
import type { AdapterContext, McpConfig, VerificationResult } from '../types.js';
import { which, assertRealDirInsideRoot } from '../util.js';
import { syncSkills, readManifest, type SyncReport } from '../sync-skills.js';
import { upsertMarkdownBlock, assertInsideRoot, preflightMarkdownFile, type BlockAction } from '../managed-block.js';
import { instructionsContent } from '../instructions.js';
import { SERVER_NAME, kitServerLaunch } from '../mcp-launch.js';
import { checkInstructions, checkLaunchConfig, checkSkills, probeServer } from '../checks.js';
import { applyExtraServers, readConfiguredLaunch, readConfiguredServers, readMcpJsonFile } from '../mcp-json.js';

/**
 * Cursor reads skills from `.agents/skills/` and instructions from `AGENTS.md` (both shared with the Codex
 * adapter, with identical content so the two never rewrite each other) and MCP servers from `.cursor/mcp.json`.
 */
export class CursorAdapter implements HostAdapter {
  readonly name = 'cursor' as const;
  readonly supported = true;

  constructor(private readonly ctx: AdapterContext) {}

  get skillsDir(): string {
    return path.join(this.ctx.projectRoot, '.agents', 'skills');
  }

  get instructionsFile(): string {
    return path.join(this.ctx.projectRoot, 'AGENTS.md');
  }

  get cursorDir(): string {
    return path.join(this.ctx.projectRoot, '.cursor');
  }

  get mcpFile(): string {
    return path.join(this.cursorDir, 'mcp.json');
  }

  async detect(): Promise<boolean> {
    return which('cursor', this.ctx.env) !== null || existsSync(path.join(this.ctx.homeDir, '.cursor'));
  }

  /** `.cursor` must not escape the project; the file is only checked once its directory exists. */
  private assertMcpTarget(): void {
    assertRealDirInsideRoot(this.cursorDir, this.ctx.projectRoot);
    if (existsSync(this.cursorDir)) assertInsideRoot(this.mcpFile, this.ctx.projectRoot);
  }

  async preflight(_config: McpConfig): Promise<void> {
    assertRealDirInsideRoot(this.skillsDir, this.ctx.projectRoot);
    readManifest(this.skillsDir);
    preflightMarkdownFile(this.instructionsFile, this.ctx.projectRoot);
    this.assertMcpTarget();
    readMcpJsonFile(this.mcpFile);
  }

  async installSkills(sourceDir: string): Promise<SyncReport> {
    assertRealDirInsideRoot(this.skillsDir, this.ctx.projectRoot);
    return syncSkills(sourceDir, this.skillsDir, { kitVersion: this.ctx.kitVersion, force: this.ctx.force });
  }

  async installInstructions(): Promise<BlockAction> {
    // Same text the Codex adapter writes to the same file: Cursor and Codex both read AGENTS.md.
    const content = instructionsContent(this.ctx, 'codex');
    return upsertMarkdownBlock(this.instructionsFile, content, this.ctx.projectRoot);
  }

  async installMcp(config: McpConfig): Promise<string[]> {
    this.assertMcpTarget();
    const json = readMcpJsonFile(this.mcpFile);
    const servers = { ...(json.mcpServers ?? {}) };
    const launch = kitServerLaunch(config);
    servers[SERVER_NAME] = { type: 'stdio', command: launch.command, args: launch.args, env: launch.env };
    const actions = [`${SERVER_NAME} MCP server registered in ${this.mcpFile}`, ...applyExtraServers(servers, config.extraServers, this.mcpFile)];
    mkdirSync(this.cursorDir, { recursive: true });
    assertInsideRoot(this.mcpFile, this.ctx.projectRoot);
    writeFileSync(this.mcpFile, `${JSON.stringify({ ...json, mcpServers: servers }, null, 2)}\n`);
    return actions;
  }

  configuredServers(): Record<string, unknown> | null {
    return readConfiguredServers(this.mcpFile);
  }

  async verify(): Promise<VerificationResult> {
    const { launch, error } = readConfiguredLaunch(this.mcpFile);
    const configCheck = error
      ? { name: 'mcp-config', ok: false, detail: error }
      : checkLaunchConfig(launch, this.ctx.projectRoot, this.mcpFile);
    const checks = [
      checkSkills(this.skillsDir, path.join(this.ctx.kitRoot, 'skills')),
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
      'Cursor loads .cursor/mcp.json for this project and asks for approval before using MCP tools.',
      '.cursor/mcp.json holds absolute paths to this kit checkout and the project — keep it out of version control if the repo is shared.',
      'Skills (.agents/skills/) and AGENTS.md are shared with Codex: installing both hosts is safe and idempotent.'
    ];
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test tests/cursor-adapter.test.ts && npm run typecheck`
Expected: PASS (12 tests), typecheck clean. If the symlinked-`CLAUDE.md` test fails on the exact text splits, read the two templates in `integrations/claude/CLAUDE.md` and `integrations/codex/AGENTS.md` and adjust only the two marker strings in the test to a phrase that occurs exactly once in each template; the behavior asserted (both texts once, stable on repeat) stays.

- [ ] **Step 5: Run the whole package**

Run: `npm test`
Expected: PASS, golden unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/adapters/cursor.ts packages/cli/tests/cursor-adapter.test.ts
git commit -m "cli: CursorAdapter (skills and AGENTS.md shared with Codex, .cursor/mcp.json)"
```

---

### Task 4: Wire Cursor into the CLI, `--all` stays claude + codex, new golden

**Files:**
- Modify: `packages/cli/src/adapters/index.ts`
- Modify: `packages/cli/src/adapters/stub.ts`
- Modify: `packages/cli/src/cli.ts` (HELP, `--all`, error text)
- Modify: `packages/cli/src/dev-cli.ts` (`DEV_HELP`)
- Modify: `packages/cli/tests/cli.test.ts` (the test at line ~98 that treats `cursor` as a stub)
- Create: `packages/cli/tests/golden-helpers.ts`
- Modify: `packages/cli/tests/integrations-golden.test.ts` (use the helper; fixtures untouched)
- Create: `packages/cli/tests/cursor-golden.test.ts`, `packages/cli/tests/fixtures/golden/cursor/*` (generated)
- Create: `packages/cli/tests/cursor-cli.test.ts`

**Interfaces:**
- Consumes: `CursorAdapter` (Task 3).
- Produces: `REAL_HOSTS: HostName[] = ['claude','codex','cursor']`, `ALL_FLAG_HOSTS: HostName[] = ['claude','codex']`, `createAdapter('cursor')`; test helper `captureGolden(argv, files, absent?)` and `expectGolden(name, actual)` in `tests/golden-helpers.ts`.

- [ ] **Step 1: Extract the golden harness, fixtures untouched**

Create `tests/golden-helpers.ts` holding the harness of `integrations-golden.test.ts` generalized over the argv and the file list:

```ts
// packages/cli/tests/golden-helpers.ts
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, type CliIo } from '../src/cli.ts';
import { findKitRoot } from '../src/util.ts';

export const goldenRoot = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'golden');

/**
 * Run `dev-agent <argv>` in a fresh project and return what it left behind: the install stdout (minus the
 * skill-count lines) and each file in `files` (golden name → path relative to the project), with machine
 * specific paths replaced by placeholders. Every path in `absent` must not exist afterwards.
 */
export async function captureGolden(argv: string[], files: Record<string, string>, absent: string[] = []): Promise<Record<string, string>> {
  const base = mkdtempSync(join(tmpdir(), 'dev-agent-golden-'));
  const projectRoot = join(base, 'project');
  const homeDir = join(base, 'home');
  mkdirSync(projectRoot);
  mkdirSync(homeDir);
  const out: string[] = [];
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => out.push(`ERR ${l}`), env: { PATH: '', CODEX_HOME: join(base, 'codex-home') }, cwd: projectRoot, homeDir };
  try {
    const code = await run([...argv, '--project', projectRoot], io);
    assert.equal(code, 0, out.join('\n'));
    const kit = findKitRoot();
    const norm = (text: string): string => text.split(projectRoot).join('<PROJECT>').split(kit).join('<KIT>');
    for (const rel of absent) assert.equal(existsSync(join(projectRoot, rel)), false, `${rel} must not exist`);
    const stdout = out.filter((l) => !l.trimStart().startsWith('skills →')).join('\n') + '\n';
    const result: Record<string, string> = { 'stdout.txt': norm(stdout) };
    for (const [name, rel] of Object.entries(files)) result[name] = norm(readFileSync(join(projectRoot, rel), 'utf8'));
    return result;
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/** Compare `actual` with tests/fixtures/golden/<name>/*; `UPDATE_GOLDEN=1` rewrites the fixtures instead. */
export function expectGolden(name: string, actual: Record<string, string>): void {
  for (const [file, content] of Object.entries(actual)) {
    const target = join(goldenRoot, name, file);
    if (process.env.UPDATE_GOLDEN === '1') {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
      continue;
    }
    assert.ok(existsSync(target), `missing golden ${target}; run with UPDATE_GOLDEN=1`);
    assert.equal(content, readFileSync(target, 'utf8'), `${name}/${file} changed`);
  }
}
```

Replace the body of `tests/integrations-golden.test.ts` with:

```ts
import { test } from 'node:test';
import { captureGolden, expectGolden } from './golden-helpers.ts';

const ALL_FILES = { 'mcp.json': '.mcp.json', 'config.toml': '.codex/config.toml', 'CLAUDE.md': 'CLAUDE.md', 'AGENTS.md': 'AGENTS.md' };

for (const [name, flags] of [['default', []], ['no-figma', ['--no-figma']]] as const) {
  test(`install --all output is byte-identical to the golden snapshot (${name})`, async () => {
    expectGolden(name, await captureGolden(['install', '--all', ...flags], ALL_FILES, ['.cursor']));
  });
}
```

(The `['.cursor']` argument also proves `--all` never creates `.cursor/`.)

- [ ] **Step 2: Verify the harness refactor changed nothing**

Run: `node --import tsx --test tests/integrations-golden.test.ts`
Expected: PASS (2 tests) against the existing fixtures with `git status --short packages/cli/tests/fixtures` empty. Commit this step on its own:

```bash
git add packages/cli/tests/golden-helpers.ts packages/cli/tests/integrations-golden.test.ts
git commit -m "test: share the golden harness"
```

- [ ] **Step 3: Write the failing CLI tests**

```ts
// packages/cli/tests/cursor-cli.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run, type CliIo } from '../src/cli.ts';
import { project } from './integration-helpers.ts';

function harness(env: NodeJS.ProcessEnv = { PATH: '' }) {
  const p = project(env);
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => err.push(l), env: { ...env, CODEX_HOME: join(p.base, 'codex-home') }, cwd: p.projectRoot, homeDir: p.homeDir };
  return { ...p, out, err, io };
}

test('install cursor writes .agents/skills, AGENTS.md and .cursor/mcp.json and nothing for the other hosts', async () => {
  const { projectRoot, io, out, cleanup } = harness();
  try {
    assert.equal(await run(['install', 'cursor', '--project', projectRoot], io), 0, out.join('\n'));
    assert.ok(existsSync(join(projectRoot, '.agents', 'skills', 'figma-to-code', 'SKILL.md')));
    assert.ok(existsSync(join(projectRoot, 'AGENTS.md')));
    const mcp = JSON.parse(readFileSync(join(projectRoot, '.cursor', 'mcp.json'), 'utf8'));
    assert.deepEqual(Object.keys(mcp.mcpServers).sort(), ['figma', 'frontend-agent']);
    for (const absent of ['.mcp.json', 'CLAUDE.md', '.claude', '.codex']) assert.equal(existsSync(join(projectRoot, absent)), false, absent);
    out.length = 0;
    assert.equal(await run(['verify', 'cursor', '--project', projectRoot], io), 0, out.join('\n'));
    assert.match(out.join('\n'), /\[cursor\] ok/);
  } finally {
    cleanup();
  }
});

test('--all still selects claude and codex only: no .cursor is created', async () => {
  const { projectRoot, io, out, cleanup } = harness();
  try {
    assert.equal(await run(['install', '--all', '--project', projectRoot], io), 0, out.join('\n'));
    assert.equal(existsSync(join(projectRoot, '.cursor')), false);
    assert.ok(existsSync(join(projectRoot, '.mcp.json')));
    assert.ok(existsSync(join(projectRoot, '.codex', 'config.toml')));
  } finally {
    cleanup();
  }
});

test('with no host named, a detected Cursor (~/.cursor) is installed too', async () => {
  const { projectRoot, homeDir, io, out, cleanup } = harness();
  try {
    mkdirSync(join(homeDir, '.cursor'));
    assert.equal(await run(['install', '--project', projectRoot], io), 0, out.join('\n'));
    assert.ok(existsSync(join(projectRoot, '.cursor', 'mcp.json')));
    assert.equal(existsSync(join(projectRoot, '.mcp.json')), false);
  } finally {
    cleanup();
  }
});

test('with no host named and nothing detected, the error names cursor', async () => {
  const { projectRoot, io, err, cleanup } = harness();
  try {
    assert.equal(await run(['install', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /pass claude, codex or cursor explicitly/);
  } finally {
    cleanup();
  }
});

test('unknown host lists cursor; vscode is still a stub', async () => {
  const { projectRoot, io, err, cleanup } = harness();
  try {
    assert.equal(await run(['install', 'zed', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /expected one of: claude, codex, cursor, vscode/);
    err.length = 0;
    assert.equal(await run(['install', 'vscode', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /vscode is not supported yet/);
  } finally {
    cleanup();
  }
});

test('an unparsable .cursor/mcp.json stops `install claude cursor` before anything is written, claude included', async () => {
  const { projectRoot, io, err, cleanup } = harness();
  try {
    mkdirSync(join(projectRoot, '.cursor'));
    writeFileSync(join(projectRoot, '.cursor', 'mcp.json'), '{nope');
    assert.equal(await run(['install', 'claude', 'cursor', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /\[cursor\] .*cannot parse/);
    for (const absent of ['.mcp.json', 'CLAUDE.md', '.claude', '.agents', 'AGENTS.md']) assert.equal(existsSync(join(projectRoot, absent)), false, absent);
  } finally {
    cleanup();
  }
});

test('codex and cursor installed together: both verify ok and repeated installs change nothing', async () => {
  const { projectRoot, io, out, cleanup } = harness();
  try {
    assert.equal(await run(['install', 'codex', 'cursor', '--project', projectRoot], io), 0, out.join('\n'));
    const agents = readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8');
    const manifest = readFileSync(join(projectRoot, '.agents', 'skills', '.frontend-agent-kit-manifest.json'), 'utf8');
    assert.equal(await run(['install', 'cursor', 'codex', '--project', projectRoot], io), 0);
    assert.equal(readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8'), agents);
    assert.equal(readFileSync(join(projectRoot, '.agents', 'skills', '.frontend-agent-kit-manifest.json'), 'utf8'), manifest);
    out.length = 0;
    await run(['verify', 'cursor', '--project', projectRoot], io);
    assert.match(out.join('\n'), /\[cursor\] ok/);
  } finally {
    cleanup();
  }
});
```

Also in `tests/cli.test.ts` change the test around line 98: replace `'cursor'` with `'vscode'` in both the argv and the regex (`/vscode is not supported yet/`).

- [ ] **Step 4: Run to verify it fails**

Run: `node --import tsx --test tests/cursor-cli.test.ts`
Expected: FAIL (`cursor is not supported yet`, or the missing `ALL_FLAG_HOSTS`).

- [ ] **Step 5: Wire it**

`src/adapters/index.ts`:

```ts
import type { HostAdapter } from './host-adapter.js';
import type { AdapterContext, HostName } from '../types.js';
import { ClaudeCodeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { CursorAdapter } from './cursor.js';
import { StubAdapter } from './stub.js';

export type { HostAdapter } from './host-adapter.js';

/** Every supported host: the ones install/verify look for when none is named. */
export const REAL_HOSTS: HostName[] = ['claude', 'codex', 'cursor'];
/** What `--all` selects. Unchanged since before Cursor became a real host, so existing `--all` users see no new files. */
export const ALL_FLAG_HOSTS: HostName[] = ['claude', 'codex'];
export const ALL_HOSTS: HostName[] = ['claude', 'codex', 'cursor', 'vscode'];

export function createAdapter(name: HostName, ctx: AdapterContext): HostAdapter {
  if (name === 'claude') return new ClaudeCodeAdapter(ctx);
  if (name === 'codex') return new CodexAdapter(ctx);
  if (name === 'cursor') return new CursorAdapter(ctx);
  return new StubAdapter(name);
}
```

`src/adapters/stub.ts`: change `constructor(readonly name: 'cursor' | 'vscode') {}` to `constructor(readonly name: 'vscode') {}` and the doc comment to "VS Code adapter exists in the interface but has no installation logic yet."

`src/cli.ts`:
- import `ALL_FLAG_HOSTS` with the others from `./adapters/index.js`;
- in `selectAdapters` use `all ? ALL_FLAG_HOSTS : (positionals as HostName[])`;
- the no-host error becomes `'frontend-agent: no supported host detected — pass claude, codex or cursor explicitly (or --all).'`;
- in `HELP`: usage lines `[claude|codex|cursor ...]`; replace `With no host, install/verify use every detected host (claude, codex).` with `With no host, install/verify use every detected host (claude, codex, cursor). --all selects claude and codex.`; replace the last line `Cursor and VS Code adapters are stubs in v0.4.` with `Cursor shares .agents/skills and AGENTS.md with Codex and writes .cursor/mcp.json. VS Code is not supported yet.`

`src/dev-cli.ts`: `DEV_HELP` install/verify usage lines `[claude|codex|cursor ...]`.

- [ ] **Step 6: Run the CLI tests**

Run: `node --import tsx --test tests/cursor-cli.test.ts tests/cli.test.ts tests/integrations-golden.test.ts`
Expected: PASS. The existing goldens still match with no fixture change.

- [ ] **Step 7: Add the Cursor golden**

```ts
// packages/cli/tests/cursor-golden.test.ts
import { test } from 'node:test';
import { captureGolden, expectGolden } from './golden-helpers.ts';

test('install cursor output is byte-identical to the golden snapshot', async () => {
  expectGolden('cursor', await captureGolden(['install', 'cursor'], { 'mcp.json': '.cursor/mcp.json', 'AGENTS.md': 'AGENTS.md' }, ['.mcp.json', 'CLAUDE.md', '.codex', '.claude']));
});
```

Generate once, then verify it compares: `UPDATE_GOLDEN=1 node --import tsx --test tests/cursor-golden.test.ts && node --import tsx --test tests/cursor-golden.test.ts`. Check `tests/fixtures/golden/cursor/` holds `stdout.txt`, `mcp.json`, `AGENTS.md`, that `mcp.json` has `<KIT>` and `<PROJECT>` placeholders and no `/home` or `/tmp`, and that `git status --short packages/cli/tests/fixtures/golden/default packages/cli/tests/fixtures/golden/no-figma` is empty.

- [ ] **Step 8: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS. `docs.test.ts` may fail if a doc quotes the old help text; if so fix only that doc line in this task.

- [ ] **Step 9: Commit**

```bash
git add -A packages/cli
git commit -m "cli: Cursor as a real host; --all stays claude + codex"
```

---

### Task 5: Integrations end to end on Cursor

**Files:**
- Create: `packages/cli/tests/cursor-integrations-e2e.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4 (integrations on Cursor, `CursorAdapter`, the wired CLI); `project`, `fakeBin` from `tests/integration-helpers.ts`.
- Produces: end-to-end coverage only; no source change expected. If a test fails, it is a real bug in an earlier task: fix the source minimally, add nothing else, and say so in the report.

- [ ] **Step 1: Write the tests**

```ts
// packages/cli/tests/cursor-integrations-e2e.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run, type CliIo } from '../src/cli.ts';
import { project, fakeBin } from './integration-helpers.ts';

function harness(env: NodeJS.ProcessEnv) {
  const p = project(env);
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => err.push(l), env: { ...env, CODEX_HOME: join(p.base, 'codex-home') }, cwd: p.projectRoot, homeDir: p.homeDir };
  return { ...p, out, err, io };
}

test('e2e: install cursor --with headroom writes the entry, verify is ok, a re-install without the binary keeps it', async () => {
  const { base: dir, projectRoot, io, out, cleanup } = harness({ PATH: '' });
  try {
    const bin = fakeBin(join(dir, 'bin'), 'headroom');
    io.env.PATH = join(dir, 'bin');
    assert.equal(await run(['install', 'cursor', '--with', 'headroom', '--project', projectRoot], io), 0, out.join('\n'));
    const file = join(projectRoot, '.cursor', 'mcp.json');
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).mcpServers.headroom, { type: 'stdio', command: bin, args: ['mcp', 'serve'] });
    out.length = 0;
    assert.equal(await run(['verify', 'cursor', '--project', projectRoot], io), 0, out.join('\n'));
    assert.match(out.join('\n'), /✔ integration:headroom/);
    const before = readFileSync(file, 'utf8');
    io.env.PATH = '';
    assert.equal(await run(['install', 'cursor', '--project', projectRoot], io), 0);
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.match(readFileSync(join(projectRoot, '.dev-agent', 'integrations.json'), 'utf8'), /headroom/);
  } finally {
    cleanup();
  }
});

test('e2e: a user-owned headroom entry in .cursor/mcp.json is kept and reported', async () => {
  const { base: dir, projectRoot, io, out, cleanup } = harness({ PATH: '' });
  try {
    fakeBin(join(dir, 'bin'), 'headroom');
    io.env.PATH = join(dir, 'bin');
    mkdirSync(join(projectRoot, '.cursor'));
    writeFileSync(join(projectRoot, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { headroom: { command: 'custom' } } }));
    assert.equal(await run(['install', 'cursor', '--with', 'headroom', '--project', projectRoot], io), 0, out.join('\n'));
    assert.deepEqual(JSON.parse(readFileSync(join(projectRoot, '.cursor', 'mcp.json'), 'utf8')).mcpServers.headroom, { command: 'custom' });
    assert.match(out.join('\n'), /headroom MCP server already configured in .*mcp\.json — kept/);
  } finally {
    cleanup();
  }
});

test('e2e: --with claude-mem on cursor alone is a usage error naming claude; nothing is written', async () => {
  const { projectRoot, io, err, cleanup } = harness({ PATH: '' });
  try {
    assert.equal(await run(['install', 'cursor', '--with', 'claude-mem', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /claude-mem.*claude/);
    assert.equal(existsSync(join(projectRoot, '.cursor')), false);
    assert.equal(existsSync(join(projectRoot, 'AGENTS.md')), false);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run to verify they pass**

Run: `node --import tsx --test tests/cursor-integrations-e2e.test.ts && npm run typecheck && npm test`
Expected: PASS (these exercise code from earlier tasks, so there is no RED step); goldens unchanged.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/tests/cursor-integrations-e2e.test.ts
git commit -m "test: integrations end to end on Cursor"
```

---

### Task 6: Docs and full suite

**Files:**
- Modify: `README.md`, `docs/cli.md`, `docs/manual-install.md`, `docs/integrations.md`

**Interfaces:**
- Consumes: the finished behavior.
- Produces: user-facing docs; `docs.test.ts` cross-checks every `dev-agent ...` line in the docs against `DEV_HELP`.

- [ ] **Step 1: Edit the docs**

- `README.md`: in the one-line description replace "for **Claude Code** and **Codex**" with "for **Claude Code**, **Codex** and **Cursor**"; in the Install block change the comment `# every detected host (Claude Code, Codex)` to `# every detected host (Claude Code, Codex, Cursor)`; in the sentence listing what `install` writes add `.cursor/mcp.json` to the MCP entries (`.mcp.json`, `.codex/config.toml`, `.cursor/mcp.json`), add "Cursor reads `.agents/skills/` and `AGENTS.md`, shared with Codex" and "`--all` still selects Claude Code and Codex; name `cursor` to install it (or let detection pick it when you name no host)". Edit only the lines above. (The main checkout holds unrelated uncommitted README edits by the project owner; they are not in the worktree, so expect to re-apply them around the merge.)
- `docs/cli.md`: change the `install [claude|codex ...]` usage to `install [claude|codex|cursor ...]`; add one paragraph: Cursor installs `.agents/skills/` and the `AGENTS.md` block (shared with Codex, idempotent) and `.cursor/mcp.json`; `--all` is claude + codex; with no host named, detection includes Cursor, so a machine with Cursor installed now also gets Cursor on a plain `install`; `vscode` is not supported yet.
- `docs/manual-install.md`: add a "Cursor" section next to the Codex one: copy the skills to `.agents/skills/`, copy `integrations/codex/AGENTS.md` to `AGENTS.md` (the same step as Codex), and create `.cursor/mcp.json` with a `frontend-agent` stdio entry (`type`, `command` = the kit's `node_modules/.bin/tsx`, `args` = the kit's `packages/mcp-server/src/index.ts`, `env.FRONTEND_AGENT_PROJECT_ROOT` = the project). Use the same example values the Claude section uses for `.mcp.json`.
- `docs/integrations.md`: in the table, `figma`, `headroom` and `graphify` hosts become `claude, codex, cursor`; in the Headroom text say the Cursor entry has the same typed stdio shape as Claude and that, as on Claude, an existing entry is kept, so a moved binary means removing the entry from `.cursor/mcp.json` before re-running `install --with headroom`; add one sentence that the Cursor entries follow Cursor's documented MCP schema but were not exercised in a real Cursor.

- [ ] **Step 2: Run the whole suite from the worktree root**

Run: `cd <worktree root> && npm test`
Expected: all workspaces PASS, including `docs.test.ts`. If `docs.test.ts` rejects a command line in a doc, fix the doc line so it matches `DEV_HELP`.

- [ ] **Step 3: Manual checklist (not run by the implementer; copy it unchecked into the commit body)**

- [ ] On a machine with Cursor, run `dev-agent install cursor` in a scratch project and open it in Cursor: the `frontend-agent` server loads from `.cursor/mcp.json`.
- [ ] The skills in `.agents/skills/` are listed by Cursor and `AGENTS.md` is picked up.
- [ ] `install cursor --with headroom` (Headroom installed) loads the `headroom` server in Cursor.
- [ ] The detection heuristic (`~/.cursor` or `cursor` on `PATH`) matches a real installation; adjust `CursorAdapter.detect` if not.
- [ ] Confirm the Figma remote entry works without a `type` field in Cursor; add one if Cursor requires it.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/cli.md docs/manual-install.md docs/integrations.md
git commit -m "docs: Cursor host

Manual checklist (not run — needs a machine with Cursor):
- [ ] install cursor in a scratch project; frontend-agent server loads from .cursor/mcp.json
- [ ] skills in .agents/skills/ listed; AGENTS.md picked up
- [ ] install cursor --with headroom loads the headroom server
- [ ] detection heuristic matches a real installation
- [ ] Figma remote entry works without a type field"
```

---

## Self-Review

**Spec coverage**
- Files (`mcp-json.ts`, `cursor.ts`, `index.ts`, `stub.ts`, `cli.ts`, integrations): Tasks 1–4.
- `CursorAdapter` table (detect, preflight, installSkills/Instructions/Mcp, configuredServers, verify, notes): Task 2, one test per row.
- Sharing with Codex idempotent, both orders; CLAUDE.md symlink: Task 3 tests.
- Integrations table (figma url, headroom typed stdio, graphify, claude-only ones): Task 4.
- CLI behavior (`install cursor`, detection, `--all` unchanged, unknown host list, vscode stub): Task 3 tests.
- Safety (`.cursor` symlink and regular file, `~/.cursor` never written): Tasks 2–3 (no code writes under the home dir; `detect` only reads).
- Testing items 1–8: goldens unchanged (Tasks 1, 2, 4, 5), new Cursor golden (Task 4), adapter tests (3), sharing with Codex (3, 4), helper unit tests (1), CLI tests (4), integrations on Cursor (2, 5), docs test (6).
- Release-notes mention from the spec CLI section: not in this plan; a release-notes file belongs to the v1.2 release step, and the behavior is documented in `docs/cli.md` (Task 5).
- Open items 1–3: the manual checklist in Task 5.

**Placeholder scan:** none; every code step has code. Two conditional notes (Task 2 step 4 marker strings, Task 3 step 8 doc line) name the exact condition and fix.

**Type consistency:** `McpJson`, `readMcpJsonFile`, `applyExtraServers`, `readConfiguredServers`, `readConfiguredLaunch` (Task 1) are used with those names and signatures in Task 3; `ALL_FLAG_HOSTS`, `REAL_HOSTS`, `createAdapter` (Task 4) match the CLI edits; `McpServerChange` entries in Task 2 match `applyExtraServers`.

# Integrations Registry Implementation Plan (v1.2 block E)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `includeFigma` special case with a registry of integrations (Figma, Headroom, claude-mem, Cartographer, Graphify) selectable with `--with <id>` / `--no-<id>` and checked by `verify`.

**Architecture:** A new `packages/cli/src/integrations/` module holds one file per integration plus a registry. The CLI resolves the selected integrations, turns them into per-host `McpServerChange[]` (`McpConfig.extraServers`), and the Claude/Codex adapters apply those generically. Integrations with no project footprint (claude-mem, Cartographer, Graphify) are verify-only. `verify` gains a `warn` check state and reads enabled ids from `.dev-agent/integrations.json`.

**Tech Stack:** TypeScript (ESM, run through `tsx`), `node:test`, `smol-toml`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-13-integrations-registry-design.md`

All commands run from `/home/andre/dev-agent-kit/packages/cli` unless stated. One test file: `node --import tsx --test tests/<file>.test.ts`. Whole package: `npm test`. Types: `npm run typecheck`.

## Global Constraints

- `dev-agent install` writes only inside the project and never installs software or runs an installer (spec Goals 3, Non-goals).
- Figma output stays byte-identical: `.mcp.json`, `.codex/config.toml`, `CLAUDE.md`, `AGENTS.md` and the install stdout (minus skill-count lines) must not change (spec Testing 1).
- `verify` exit codes are unchanged: 0 when every check is `ok` or `warn`, 1 when any check fails (spec "Check states and exit codes").
- A missing tool is `warn`, never `fail`; only project config the kit wrote (or should have written) can fail `verify`.
- Usage errors (unknown id, unsupported host, `--with headroom` without the binary) exit 1 before anything is written.
- Every file the integrations write goes through `assertInsideRoot` / `assertRealDirInsideRoot`.
- `detect()` never throws and never writes. Network access: one loopback `GET http://127.0.0.1:<port>/api/health` with a 1 s timeout, only in claude-mem's `detect`.
- Error messages use the existing `frontend-agent: ` prefix.
- Enabled ids are recorded in `.dev-agent/integrations.json` as `{"enabled": [...]}`; `packages/core` is not touched.

## Review Focus

Failure modes the spec implies but no obvious task exercises; each has a test in the owning task.

1. `.dev-agent/integrations.json` is malformed JSON or lists an unknown id → `verify` reports a failing check and does not crash (Task 3).
2. `.dev-agent` is a symlink pointing outside the project → `install` refuses and writes nothing (Task 3).
3. `--with headroom --with headroom`, or `--with` plus an id already recorded → one entry, no duplicates (Tasks 3, 5).
4. The user already has a different `headroom` entry in `.mcp.json` / `.codex/config.toml` → kept untouched and reported (Task 5).
5. claude-mem port file is empty or garbage → `warn`, never an exception (Task 6).
6. A second plain `install` after `--with headroom` keeps headroom enabled (sticky selection) (Task 3).

---

### Task 1: Figma golden baseline (before any refactor)

**Files:**
- Create: `packages/cli/tests/integrations-golden.test.ts`
- Create (generated): `packages/cli/tests/fixtures/golden/default/*`, `packages/cli/tests/fixtures/golden/no-figma/*`

**Interfaces:**
- Consumes: `run(argv, io)` from `src/cli.ts`, `findKitRoot()` from `src/util.ts`.
- Produces: golden files the refactor in Task 2 must reproduce byte for byte. Env var `UPDATE_GOLDEN=1` regenerates them.

- [ ] **Step 1: Write the golden test**

```ts
// packages/cli/tests/integrations-golden.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, type CliIo } from '../src/cli.ts';
import { findKitRoot } from '../src/util.ts';

const goldenRoot = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'golden');

/** Everything `install --all` leaves behind for the hosts, with machine-specific paths replaced by placeholders. */
async function capture(flags: string[]): Promise<Record<string, string>> {
  const base = mkdtempSync(join(tmpdir(), 'dev-agent-golden-'));
  const projectRoot = join(base, 'project');
  const homeDir = join(base, 'home');
  mkdirSync(projectRoot);
  mkdirSync(homeDir);
  const out: string[] = [];
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => out.push(`ERR ${l}`), env: { PATH: '', CODEX_HOME: join(base, 'codex-home') }, cwd: projectRoot, homeDir };
  try {
    const code = await run(['install', '--all', '--project', projectRoot, ...flags], io);
    assert.equal(code, 0, out.join('\n'));
    const kit = findKitRoot();
    const norm = (text: string): string => text.split(projectRoot).join('<PROJECT>').split(kit).join('<KIT>');
    const stdout = out.filter((l) => !l.trimStart().startsWith('skills →')).join('\n') + '\n';
    return {
      'stdout.txt': norm(stdout),
      'mcp.json': norm(readFileSync(join(projectRoot, '.mcp.json'), 'utf8')),
      'config.toml': norm(readFileSync(join(projectRoot, '.codex', 'config.toml'), 'utf8')),
      'CLAUDE.md': norm(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8')),
      'AGENTS.md': norm(readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8'))
    };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

for (const [name, flags] of [['default', []], ['no-figma', ['--no-figma']]] as const) {
  test(`install --all output is byte-identical to the golden snapshot (${name})`, async () => {
    const actual = await capture([...flags]);
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
  });
}
```

- [ ] **Step 2: Generate the baseline on the unchanged code**

Run: `UPDATE_GOLDEN=1 node --import tsx --test tests/integrations-golden.test.ts`
Expected: PASS (2 tests); files appear under `tests/fixtures/golden/default/` and `.../no-figma/`.

- [ ] **Step 3: Verify it compares for real**

Run: `node --import tsx --test tests/integrations-golden.test.ts`
Expected: PASS. Then run `grep -c figma tests/fixtures/golden/default/mcp.json tests/fixtures/golden/no-figma/mcp.json` — expected `1`+ for default, `0` for no-figma.

- [ ] **Step 4: Commit**

```bash
cd /home/andre/dev-agent-kit
git add packages/cli/tests/integrations-golden.test.ts packages/cli/tests/fixtures/golden
git commit -m "test: golden snapshot of install output before the integrations refactor"
```

---

### Task 2: Registry types, Figma integration, adapters and CLI on `extraServers`

**Files:**
- Create: `packages/cli/src/integrations/types.ts`
- Create: `packages/cli/src/integrations/figma.ts`
- Create: `packages/cli/src/integrations/index.ts`
- Create: `packages/cli/tests/integration-helpers.ts`
- Create: `packages/cli/tests/integrations-registry.test.ts`
- Modify: `packages/cli/src/types.ts` (McpConfig)
- Modify: `packages/cli/src/mcp-launch.ts:3,24` (parameter type)
- Modify: `packages/cli/src/adapters/claude.ts:72-95`
- Modify: `packages/cli/src/adapters/codex.ts:90-141`
- Modify: `packages/cli/src/cli.ts:69-76,142-146`
- Modify (mechanical): `tests/claude-adapter.test.ts`, `tests/codex-adapter.test.ts`, `tests/checks.test.ts`, `tests/mcp-launch.test.ts`

**Interfaces:**
- Consumes: `FIGMA_MCP_URL` from `src/mcp-launch.ts`; `which` from `src/util.ts`.
- Produces (used by every later task):
  - `type IntegrationId = 'figma' | 'headroom' | 'claude-mem' | 'cartographer' | 'graphify'`
  - `type Detection = { state: 'present'; detail?: string; binPath?: string } | { state: 'absent' } | { state: 'unknown'; reason: string }`
  - `interface McpServerChange { name: string; entry: Record<string, unknown>; hint?: string }`
  - `interface Integration { id; hosts: readonly HostName[]; defaultOn: boolean; detect(ctx: AdapterContext): Promise<Detection>; plan(host: HostName, detection: Detection): McpServerChange[]; verify(host: HostName, ctx: AdapterContext, detection: Detection, configured: Record<string, unknown> | null): CheckResult[]; notes(host: HostName, detection: Detection): string[]; assertInstallable?(detection: Detection): void }`
  - `INTEGRATIONS: readonly Integration[]` and `integrationById(id: string): Integration | undefined` from `src/integrations/index.ts`
  - `McpConfig = { kitRoot: string; projectRoot: string; extraServers: McpServerChange[] }`
  - Test helpers: `figmaServers(host)`, `project(env?)`, `fakeBin(dir, name)`.

- [ ] **Step 1: Write the helpers and the failing registry test**

```ts
// packages/cli/tests/integration-helpers.ts
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { figma } from '../src/integrations/figma.ts';
import { findKitRoot } from '../src/util.ts';
import type { AdapterContext, HostName } from '../src/types.ts';
import type { McpServerChange } from '../src/integrations/types.ts';

export function figmaServers(host: HostName): McpServerChange[] {
  return figma.plan(host, { state: 'present' });
}

export function project(env: NodeJS.ProcessEnv = { PATH: '' }) {
  const base = mkdtempSync(join(tmpdir(), 'dev-agent-integration-'));
  const projectRoot = join(base, 'project');
  const homeDir = join(base, 'home');
  mkdirSync(projectRoot);
  mkdirSync(homeDir);
  const ctx: AdapterContext = { projectRoot, kitRoot: findKitRoot(), kitVersion: '1.2.0', env, homeDir, force: false };
  return { base, projectRoot, homeDir, ctx, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

/** An executable file named `name` in `dir`, standing in for a tool installed on the machine. */
export function fakeBin(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, '#!/bin/sh\nexit 0\n');
  chmodSync(file, 0o755);
  return file;
}
```

```ts
// packages/cli/tests/integrations-registry.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTEGRATIONS, integrationById } from '../src/integrations/index.ts';
import { project } from './integration-helpers.ts';

test('figma is the only default-on integration and plans the same entries as before', async () => {
  assert.deepEqual(INTEGRATIONS.filter((i) => i.defaultOn).map((i) => i.id), ['figma']);
  const figma = integrationById('figma')!;
  assert.deepEqual(figma.hosts, ['claude', 'codex']);
  assert.deepEqual(figma.plan('claude', { state: 'present' }), [{ name: 'figma', entry: { type: 'http', url: 'https://mcp.figma.com/mcp' } }]);
  assert.deepEqual(figma.plan('codex', { state: 'present' }), [
    { name: 'figma', entry: { url: 'https://mcp.figma.com/mcp' }, hint: 'authenticate with: codex mcp login figma' }
  ]);
  const { ctx, cleanup } = project();
  try {
    assert.deepEqual(await figma.detect(ctx), { state: 'present', detail: 'remote HTTP server' });
    assert.deepEqual(figma.verify('claude', ctx, { state: 'present' }, {}), []);
  } finally {
    cleanup();
  }
});

test('integrationById returns undefined for an unknown id', () => {
  assert.equal(integrationById('nope'), undefined);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/integrations-registry.test.ts`
Expected: FAIL, cannot find module `../src/integrations/index.ts`.

- [ ] **Step 3: Create the registry types and Figma**

```ts
// packages/cli/src/integrations/types.ts
import type { AdapterContext, CheckResult, HostName } from '../types.js';

export type IntegrationId = 'figma' | 'headroom' | 'claude-mem' | 'cartographer' | 'graphify';

export type Detection =
  | { state: 'present'; detail?: string; binPath?: string }
  | { state: 'absent' }
  | { state: 'unknown'; reason: string };

/** One MCP server entry an integration wants in a host's project config. */
export interface McpServerChange {
  name: string;
  entry: Record<string, unknown>;
  /** Appended to the "registered" message, e.g. an authentication hint. */
  hint?: string;
}

export interface Integration {
  readonly id: IntegrationId;
  readonly hosts: readonly HostName[];
  readonly defaultOn: boolean;
  /** Best-effort, read-only, never throws. */
  detect(ctx: AdapterContext): Promise<Detection>;
  /** Pure: the MCP entries to write for this host. Empty for verify-only integrations. */
  plan(host: HostName, detection: Detection): McpServerChange[];
  /** `configured` is the host's MCP servers as written in the project config, or null when that file is unreadable. */
  verify(host: HostName, ctx: AdapterContext, detection: Detection, configured: Record<string, unknown> | null): CheckResult[];
  /** Install hints for what is missing on the machine. */
  notes(host: HostName, detection: Detection): string[];
  /** Throws a usage error before anything is written (called only for integrations named with --with). */
  assertInstallable?(detection: Detection): void;
}
```

```ts
// packages/cli/src/integrations/figma.ts
import { FIGMA_MCP_URL } from '../mcp-launch.js';
import type { Integration } from './types.js';

export const figma: Integration = {
  id: 'figma',
  hosts: ['claude', 'codex'],
  defaultOn: true,
  async detect() {
    return { state: 'present', detail: 'remote HTTP server' };
  },
  plan(host) {
    return host === 'codex'
      ? [{ name: 'figma', entry: { url: FIGMA_MCP_URL }, hint: 'authenticate with: codex mcp login figma' }]
      : [{ name: 'figma', entry: { type: 'http', url: FIGMA_MCP_URL } }];
  },
  verify: () => [],
  notes: () => []
};
```

```ts
// packages/cli/src/integrations/index.ts
import type { Integration } from './types.js';
import { figma } from './figma.js';

export type { Integration, IntegrationId, Detection, McpServerChange } from './types.js';

export const INTEGRATIONS: readonly Integration[] = [figma];

export function integrationById(id: string): Integration | undefined {
  return INTEGRATIONS.find((integration) => integration.id === id);
}
```

- [ ] **Step 4: Switch `McpConfig` and `kitServerLaunch`**

In `src/types.ts` replace the interface:

```ts
import type { McpServerChange } from './integrations/types.js';

export interface McpConfig {
  kitRoot: string;
  projectRoot: string;
  /** Extra MCP servers (beyond the kit's own) resolved for the host this config is passed to. */
  extraServers: McpServerChange[];
}
```

In `src/mcp-launch.ts` change the signature to take only what it uses:

```ts
export function kitServerLaunch(config: Pick<McpConfig, 'kitRoot' | 'projectRoot'>): ServerLaunch {
```

- [ ] **Step 5: Make the Claude adapter apply `extraServers`**

In `src/adapters/claude.ts` replace the `if (config.includeFigma) { ... }` block in `installMcp` with:

```ts
    for (const extra of config.extraServers) {
      if (servers[extra.name]) {
        actions.push(`${extra.name} MCP server already configured in ${this.mcpFile} — kept`);
      } else {
        servers[extra.name] = extra.entry;
        actions.push(`${extra.name} MCP server registered in ${this.mcpFile}${extra.hint ? ` (${extra.hint})` : ''}`);
      }
    }
```

Remove `FIGMA_MCP_URL` from the `mcp-launch.js` import in that file (keep `SERVER_NAME, kitServerLaunch, type ServerLaunch`).

- [ ] **Step 6: Make the Codex adapter apply `extraServers`**

In `src/adapters/codex.ts` inside `planMcp`, replace the `if (config.includeFigma) { ... }` block with:

```ts
    const added: string[] = [];
    for (const extra of config.extraServers) {
      if (userServers[extra.name]) {
        actions.push(`${extra.name} MCP server already configured in ${this.configFile} — kept`);
      } else {
        servers[extra.name] = extra.entry;
        added.push(extra.name);
        actions.push(`${extra.name} MCP server registered in ${this.configFile}${extra.hint ? ` (${extra.hint})` : ''}`);
      }
    }
```

and replace the `wroteCleanly` expression with:

```ts
    const wroteCleanly =
      isDeepStrictEqual(plain(nextServers[SERVER_NAME]), plain(servers[SERVER_NAME])) &&
      added.every((name) => isDeepStrictEqual(plain(nextServers[name]), plain(servers[name])));
```

Remove `FIGMA_MCP_URL` from that file's `mcp-launch.js` import.

- [ ] **Step 7: Make the CLI build `extraServers` from the registry (Figma only for now)**

In `src/cli.ts` add the import and rewrite `install`'s config and the call site:

```ts
import { INTEGRATIONS, type Detection, type IntegrationId } from './integrations/index.js';
```

```ts
async function install(adapters: HostAdapter[], ctx: AdapterContext, includeFigma: boolean, io: CliIo): Promise<void> {
  for (const adapter of adapters) {
    if (!adapter.supported) {
      throw new Error(`frontend-agent: ${adapter.name} is not supported yet (stub adapter in v0.4 — spec §6).`);
    }
  }
  const selected = INTEGRATIONS.filter((integration) => (integration.id === 'figma' ? includeFigma : false));
  const detections = new Map<IntegrationId, Detection>();
  for (const integration of selected) detections.set(integration.id, await integration.detect(ctx));
  const configFor = (adapter: HostAdapter) => ({
    kitRoot: ctx.kitRoot,
    projectRoot: ctx.projectRoot,
    extraServers: selected
      .filter((integration) => integration.hosts.includes(adapter.name))
      .flatMap((integration) => integration.plan(adapter.name, detections.get(integration.id)!))
  });
```

Then use `configFor(adapter)` in both loops instead of the shared `mcpConfig` (`adapter.preflight(configFor(adapter))` and `adapter.installMcp(configFor(adapter))`). This `includeFigma` shim is replaced in Task 3.

- [ ] **Step 8: Update the existing tests mechanically**

```bash
cd /home/andre/dev-agent-kit/packages/cli
sed -i "s/includeFigma: true/extraServers: figmaServers('claude')/; s/includeFigma: false/extraServers: []/" tests/claude-adapter.test.ts
sed -i "s/includeFigma: true/extraServers: figmaServers('codex')/; s/includeFigma: false/extraServers: []/" tests/codex-adapter.test.ts
sed -i "s/includeFigma: false/extraServers: []/" tests/checks.test.ts tests/mcp-launch.test.ts
sed -i "1i import { figmaServers } from './integration-helpers.ts';" tests/claude-adapter.test.ts tests/codex-adapter.test.ts
grep -rn includeFigma tests src | grep -v "cli.ts"
```
Expected: the final grep prints nothing.

- [ ] **Step 9: Run everything**

Run: `npm run typecheck && npm test`
Expected: all PASS, including `integrations-golden.test.ts` unchanged (this is the proof the refactor is byte-identical) and the new registry test.

- [ ] **Step 10: Commit**

```bash
cd /home/andre/dev-agent-kit
git add -A packages/cli
git commit -m "cli: integrations registry with Figma as first instance; adapters apply extraServers"
```

---

### Task 3: Selection, state file and CLI flags

**Files:**
- Create: `packages/cli/src/integrations/select.ts`
- Create: `packages/cli/src/integrations/state.ts`
- Create: `packages/cli/tests/integrations-select.test.ts`
- Create: `packages/cli/tests/integrations-state.test.ts`
- Modify: `packages/cli/src/integrations/index.ts` (re-exports)
- Modify: `packages/cli/src/cli.ts` (parseArgs options, `install`)
- Modify: `packages/cli/src/cli.ts` HELP and `packages/cli/src/dev-cli.ts` DEV_HELP

**Interfaces:**
- Consumes: `INTEGRATIONS`, `integrationById` (Task 2); `assertInsideRoot` from `src/managed-block.ts`; `assertRealDirInsideRoot` from `src/util.ts`.
- Produces:
  - `interface SelectionFlags { with: string[]; without: IntegrationId[] }`
  - `resolveSelection(flags: SelectionFlags, hosts: HostName[], previous: IntegrationId[]): Integration[]`
  - `interface IntegrationState { ids: IntegrationId[]; error?: string }`
  - `STATE_FILE = '.dev-agent/integrations.json'`
  - `readIntegrationState(root: string): IntegrationState`
  - `assertStateWritable(root: string): void` (throws if `.dev-agent` escapes the project)
  - `persistIntegrationState(root: string, ids: IntegrationId[]): void`

- [ ] **Step 1: Write the failing selection tests**

```ts
// packages/cli/tests/integrations-select.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSelection } from '../src/integrations/select.ts';
import { INTEGRATIONS } from '../src/integrations/index.ts';
import type { Integration } from '../src/integrations/types.ts';

// The registry only holds figma until later tasks add the others, so these tests inject extra entries.
const fake = (id: string, hosts: Integration['hosts'], defaultOn = false): Integration =>
  ({ id: id as never, hosts, defaultOn, detect: async () => ({ state: 'absent' }), plan: () => [], verify: () => [], notes: () => [] });
const registry: readonly Integration[] = [...INTEGRATIONS, fake('headroom', ['claude', 'codex']), fake('cartographer', ['claude'])];
const ids = (list: Integration[]) => list.map((i) => i.id);

test('defaults only: figma', () => {
  assert.deepEqual(ids(resolveSelection({ with: [], without: [] }, ['claude'], [], registry)), ['figma']);
});

test('--with adds, --no-figma removes a default', () => {
  assert.deepEqual(ids(resolveSelection({ with: ['headroom'], without: ['figma'] }, ['claude', 'codex'], [], registry)), ['headroom']);
});

test('duplicate --with ids and ids already recorded produce one entry (no duplicates)', () => {
  const list = resolveSelection({ with: ['headroom', 'headroom'], without: [] }, ['claude'], ['headroom'], registry);
  assert.deepEqual(ids(list), ['figma', 'headroom']);
});

test('selection is sticky: a plain run keeps previously recorded ids; --no-<id> drops one', () => {
  assert.deepEqual(ids(resolveSelection({ with: [], without: [] }, ['claude'], ['headroom'], registry)), ['figma', 'headroom']);
  assert.deepEqual(ids(resolveSelection({ with: [], without: ['headroom'] }, ['claude'], ['headroom'], registry)), ['figma']);
});

test('unknown id is a usage error listing the valid ids', () => {
  assert.throws(() => resolveSelection({ with: ['nope'], without: [] }, ['claude'], [], registry), /unknown integration "nope".*figma, headroom, cartographer/);
});

test('--with on a host the integration does not support names the supported hosts', () => {
  assert.throws(() => resolveSelection({ with: ['cartographer'], without: [] }, ['codex'], [], registry), /cartographer.*claude/);
});

test('--with x and --no-x together conflict', () => {
  assert.throws(() => resolveSelection({ with: ['headroom'], without: ['headroom'] }, ['claude'], [], registry), /conflict/);
});

test('a recorded id unsupported by the selected hosts is skipped silently', () => {
  assert.deepEqual(ids(resolveSelection({ with: [], without: [] }, ['codex'], ['cartographer'], registry)), ['figma']);
});
```

Note: `resolveSelection` takes the registry as an optional 4th parameter (defaults to `INTEGRATIONS`) so tests can inject entries.

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/integrations-select.test.ts`
Expected: FAIL, cannot find module `../src/integrations/select.ts`.

- [ ] **Step 3: Implement `select.ts`**

```ts
// packages/cli/src/integrations/select.ts
import type { HostName } from '../types.js';
import { INTEGRATIONS } from './index.js';
import type { Integration, IntegrationId } from './types.js';

export interface SelectionFlags {
  with: string[];
  without: IntegrationId[];
}

/**
 * Which integrations apply to this install: the defaults, plus what a previous install recorded, plus --with,
 * minus --no-<id>. Only an explicit --with can be a usage error; recorded ids that the selected hosts do not
 * support are skipped quietly.
 */
export function resolveSelection(
  flags: SelectionFlags,
  hosts: HostName[],
  previous: IntegrationId[],
  registry: readonly Integration[] = INTEGRATIONS
): Integration[] {
  const validIds = registry.map((integration) => integration.id);
  for (const id of flags.with) {
    const integration = registry.find((candidate) => candidate.id === id);
    if (!integration) {
      throw new Error(`frontend-agent: unknown integration "${id}" (expected one of: ${validIds.join(', ')}).`);
    }
    if (flags.without.includes(integration.id)) {
      throw new Error(`frontend-agent: --with ${id} and --no-${id} conflict; pass only one.`);
    }
    if (!integration.hosts.some((host) => hosts.includes(host))) {
      throw new Error(
        `frontend-agent: --with ${id} needs one of these hosts: ${integration.hosts.join(', ')} (selected: ${hosts.join(', ')}).`
      );
    }
  }
  const wanted = new Set<string>([
    ...registry.filter((integration) => integration.defaultOn).map((integration) => integration.id),
    ...previous,
    ...flags.with
  ]);
  for (const id of flags.without) wanted.delete(id);
  return registry.filter((integration) => wanted.has(integration.id) && integration.hosts.some((host) => hosts.includes(host)));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test tests/integrations-select.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Write the failing state tests (including the symlink and malformed cases)**

```ts
// packages/cli/tests/integrations-state.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { readIntegrationState, persistIntegrationState, assertStateWritable, STATE_FILE } from '../src/integrations/state.ts';
import { project } from './integration-helpers.ts';

test('no state file reads as an empty list without error', () => {
  const { projectRoot, cleanup } = project();
  try {
    assert.deepEqual(readIntegrationState(projectRoot), { ids: [] });
  } finally {
    cleanup();
  }
});

test('persist writes {"enabled": [...]} and read returns the ids', () => {
  const { projectRoot, cleanup } = project();
  try {
    persistIntegrationState(projectRoot, ['figma', 'headroom']);
    assert.deepEqual(JSON.parse(readFileSync(join(projectRoot, STATE_FILE), 'utf8')), { enabled: ['figma', 'headroom'] });
    assert.deepEqual(readIntegrationState(projectRoot), { ids: ['figma', 'headroom'] });
  } finally {
    cleanup();
  }
});

test('persist writes nothing when no file exists and the ids are exactly the defaults', () => {
  const { projectRoot, cleanup } = project();
  try {
    persistIntegrationState(projectRoot, ['figma']);
    assert.equal(existsSync(join(projectRoot, STATE_FILE)), false);
  } finally {
    cleanup();
  }
});

test('malformed JSON, a wrong shape and an unknown id each come back as an error, not a throw', () => {
  const { projectRoot, cleanup } = project();
  try {
    mkdirSync(join(projectRoot, '.dev-agent'));
    for (const bad of ['{not json', '[]', '{"enabled":"headroom"}', '{"enabled":["nope"]}']) {
      writeFileSync(join(projectRoot, STATE_FILE), bad);
      const state = readIntegrationState(projectRoot);
      assert.deepEqual(state.ids, []);
      assert.match(state.error ?? '', /integrations\.json/);
    }
  } finally {
    cleanup();
  }
});

test('a .dev-agent symlink that points outside the project is refused', () => {
  const { base, projectRoot, cleanup } = project();
  try {
    const outside = join(base, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(projectRoot, '.dev-agent'));
    assert.throws(() => assertStateWritable(projectRoot));
    assert.throws(() => persistIntegrationState(projectRoot, ['figma', 'headroom']));
    assert.equal(existsSync(join(outside, 'integrations.json')), false);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `node --import tsx --test tests/integrations-state.test.ts`
Expected: FAIL, cannot find module `../src/integrations/state.ts`.

- [ ] **Step 7: Implement `state.ts`**

```ts
// packages/cli/src/integrations/state.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertInsideRoot } from '../managed-block.js';
import { assertRealDirInsideRoot } from '../util.js';
import { INTEGRATIONS } from './index.js';
import type { IntegrationId } from './types.js';

export const STATE_FILE = '.dev-agent/integrations.json';

export interface IntegrationState {
  ids: IntegrationId[];
  error?: string;
}

export function readIntegrationState(root: string): IntegrationState {
  const file = path.join(root, STATE_FILE);
  if (!existsSync(file)) return { ids: [] };
  const fail = (message: string): IntegrationState => ({ ids: [], error: `${STATE_FILE}: ${message}` });
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return fail(`invalid JSON (${(error as Error).message.split('\n')[0]})`);
  }
  const enabled = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as { enabled?: unknown }).enabled : undefined;
  if (!Array.isArray(enabled) || enabled.some((id) => typeof id !== 'string')) return fail('expected {"enabled": ["<id>", ...]}');
  const valid = INTEGRATIONS.map((integration) => integration.id) as string[];
  const unknown = (enabled as string[]).filter((id) => !valid.includes(id));
  if (unknown.length > 0) return fail(`unknown integration id(s): ${unknown.join(', ')} (expected: ${valid.join(', ')})`);
  return { ids: enabled as IntegrationId[] };
}

/** Fail closed before any host writes: `.dev-agent` must not escape the project through a symlink. */
export function assertStateWritable(root: string): void {
  assertRealDirInsideRoot(path.join(root, '.dev-agent'), root);
  const file = path.join(root, STATE_FILE);
  if (existsSync(path.dirname(file))) assertInsideRoot(file, root);
}

/** Record the selected ids. Writes nothing when there is no file yet and the selection is just the defaults. */
export function persistIntegrationState(root: string, ids: IntegrationId[]): void {
  assertStateWritable(root);
  const file = path.join(root, STATE_FILE);
  const defaults = INTEGRATIONS.filter((integration) => integration.defaultOn).map((integration) => integration.id);
  const isDefault = ids.length === defaults.length && defaults.every((id) => ids.includes(id));
  if (!existsSync(file) && isDefault) return;
  mkdirSync(path.dirname(file), { recursive: true });
  assertInsideRoot(file, root);
  writeFileSync(file, `${JSON.stringify({ enabled: ids }, null, 2)}\n`);
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `node --import tsx --test tests/integrations-state.test.ts`
Expected: PASS (5 tests). If the symlink test fails because `assertRealDirInsideRoot` accepts a missing path only, adjust `assertStateWritable` to also call `assertInsideRoot(path.join(root, '.dev-agent'), root)` when `.dev-agent` exists; keep the test as written.

- [ ] **Step 9: Wire the flags and the state into the CLI**

In `src/cli.ts`:

1. Imports:

```ts
import { INTEGRATIONS, integrationById, type Detection, type IntegrationId } from './integrations/index.js';
import { resolveSelection, type SelectionFlags } from './integrations/select.js';
import { assertStateWritable, persistIntegrationState, readIntegrationState } from './integrations/state.js';
```

2. In `parseArgs` options remove the literal `'no-figma'` entry, add:

```ts
        with: { type: 'string', multiple: true, default: [] },
        ...Object.fromEntries(INTEGRATIONS.map((integration) => [`no-${integration.id}`, { type: 'boolean', default: false }])),
```

3. Replace the `install(...)` call site:

```ts
    if (command === 'install') {
      const flags: SelectionFlags = {
        with: (values.with as string[] | undefined) ?? [],
        without: INTEGRATIONS.filter((integration) => (values as Record<string, unknown>)[`no-${integration.id}`] === true).map((integration) => integration.id)
      };
      await install(adapters, ctx, flags, io);
      return 0;
    }
```

4. Replace the whole `install` function from Task 2 with:

```ts
async function install(adapters: HostAdapter[], ctx: AdapterContext, flags: SelectionFlags, io: CliIo): Promise<void> {
  for (const adapter of adapters) {
    if (!adapter.supported) {
      throw new Error(`frontend-agent: ${adapter.name} is not supported yet (stub adapter in v0.4 — spec §6).`);
    }
  }
  const previous = readIntegrationState(ctx.projectRoot);
  if (previous.error) throw new Error(`frontend-agent: ${previous.error}`);
  const selected = resolveSelection(flags, adapters.map((adapter) => adapter.name), previous.ids);
  const detections = new Map<IntegrationId, Detection>();
  for (const integration of selected) {
    const detection = await integration.detect(ctx);
    if (flags.with.includes(integration.id)) integration.assertInstallable?.(detection);
    detections.set(integration.id, detection);
  }
  assertStateWritable(ctx.projectRoot);
  const configFor = (adapter: HostAdapter) => ({
    kitRoot: ctx.kitRoot,
    projectRoot: ctx.projectRoot,
    extraServers: selected
      .filter((integration) => integration.hosts.includes(adapter.name))
      .flatMap((integration) => integration.plan(adapter.name, detections.get(integration.id)!))
  });
  // Fail closed: validate everything every selected host will touch before any of them writes
  // anything, so a problem with one host never leaves another partially installed.
  for (const adapter of adapters) {
    await withHostPrefix(adapter, () => adapter.preflight(configFor(adapter)));
  }
  for (const adapter of adapters) {
    io.stdout(`\n[${adapter.name}] installing into ${ctx.projectRoot}`);
    await withHostPrefix(adapter, async () => {
      const report = await adapter.installSkills(path.join(ctx.kitRoot, 'skills'));
      io.stdout(
        `  skills → ${report.targetDir}: ${report.added.length} added, ${report.updated.length} updated, ${report.removed.length} removed, ${report.unchanged.length} unchanged`
      );
      for (const skipped of report.skipped) io.stdout(`  ! skipped ${skipped.path}: ${skipped.reason}`);
      const instructions = await adapter.installInstructions();
      io.stdout(`  ${adapter.name === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'}: ${instructions}`);
      for (const action of await adapter.installMcp(configFor(adapter))) {
        io.stdout(`  ${action}`);
      }
      for (const note of adapter.notes()) io.stdout(`  note: ${note}`);
      for (const integration of selected.filter((candidate) => candidate.hosts.includes(adapter.name))) {
        for (const note of integration.notes(adapter.name, detections.get(integration.id)!)) io.stdout(`  note: ${note}`);
      }
    });
  }
  persistIntegrationState(ctx.projectRoot, selected.map((integration) => integration.id));
  io.stdout(`\nDone. Run "frontend-agent verify${adapters.length === 1 ? ` ${adapters[0].name}` : ''} --project ${ctx.projectRoot}" to check the setup.`);
}
```

`integrationById` is not needed in `cli.ts`; leave it out of the import if the typecheck flags it unused.

5. HELP in `cli.ts` and `DEV_HELP` in `dev-cli.ts`: change the install usage line to
`[--force] [--no-figma] [--with <id> ...] [--no-<id> ...]` and add under the paragraph: `Integrations: figma (default), headroom, claude-mem, cartographer, graphify. --with enables one, --no-<id> disables one. The kit never installs the tools; verify reports what is missing.`

- [ ] **Step 10: Write the CLI-level tests**

```ts
// packages/cli/tests/integrations-cli.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
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

test('--with <unknown> exits 1, lists valid ids and writes nothing', async () => {
  const { projectRoot, io, err, cleanup } = harness();
  try {
    assert.equal(await run(['install', 'claude', '--with', 'nope', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /unknown integration "nope"/);
    assert.equal(existsSync(join(projectRoot, '.mcp.json')), false);
  } finally {
    cleanup();
  }
});

test('a malformed .dev-agent/integrations.json stops install before any write', async () => {
  const { projectRoot, io, err, cleanup } = harness();
  try {
    mkdirSync(join(projectRoot, '.dev-agent'));
    writeFileSync(join(projectRoot, '.dev-agent', 'integrations.json'), '{oops');
    assert.equal(await run(['install', 'claude', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /integrations\.json/);
    assert.equal(existsSync(join(projectRoot, '.mcp.json')), false);
  } finally {
    cleanup();
  }
});

test('--no-figma still works as before', async () => {
  const { projectRoot, io, cleanup } = harness();
  try {
    assert.equal(await run(['install', 'claude', '--no-figma', '--project', projectRoot], io), 0);
    assert.equal(JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf8')).mcpServers.figma, undefined);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 11: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS, golden unchanged.

- [ ] **Step 12: Commit**

```bash
cd /home/andre/dev-agent-kit
git add -A packages/cli
git commit -m "cli: --with/--no-<id> selection and .dev-agent/integrations.json state"
```

---

### Task 4: `warn` check state, `configuredServers`, integration checks in `verify`

**Files:**
- Modify: `packages/cli/src/types.ts` (`CheckResult`)
- Modify: `packages/cli/src/adapters/host-adapter.ts`
- Modify: `packages/cli/src/adapters/claude.ts`, `codex.ts`, `stub.ts`
- Modify: `packages/cli/src/integrations/index.ts` (add `integrationChecks`)
- Modify: `packages/cli/src/cli.ts` (`verify`)
- Create: `packages/cli/tests/integrations-verify.test.ts`

**Interfaces:**
- Consumes: `readIntegrationState` (Task 3), `Integration.verify` (Task 2).
- Produces:
  - `CheckResult = { name: string; ok: boolean; detail: string; warn?: boolean }` (`warn: true` implies `ok: true`)
  - `HostAdapter.configuredServers(): Record<string, unknown> | null` (the MCP servers in the project's host config; `null` when the file is unreadable; `{}` when absent)
  - `integrationChecks(host: HostAdapter, ctx: AdapterContext, state: IntegrationState): Promise<CheckResult[]>` exported from `src/integrations/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/tests/integrations-verify.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run, type CliIo } from '../src/cli.ts';
import { ClaudeCodeAdapter } from '../src/adapters/claude.ts';
import { CodexAdapter } from '../src/adapters/codex.ts';
import { project, figmaServers } from './integration-helpers.ts';

test('configuredServers: {} without a file, the servers with one, null when unparseable (claude and codex)', async () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    const claude = new ClaudeCodeAdapter(ctx);
    const codex = new CodexAdapter(ctx);
    assert.deepEqual(claude.configuredServers(), {});
    assert.deepEqual(codex.configuredServers(), {});
    await claude.installMcp({ kitRoot: ctx.kitRoot, projectRoot, extraServers: figmaServers('claude') });
    await codex.installMcp({ kitRoot: ctx.kitRoot, projectRoot, extraServers: figmaServers('codex') });
    assert.deepEqual(Object.keys(claude.configuredServers()!).sort(), ['figma', 'frontend-agent']);
    assert.deepEqual(Object.keys(codex.configuredServers()!).sort(), ['figma', 'frontend-agent']);
    writeFileSync(join(projectRoot, '.mcp.json'), '{nope');
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    writeFileSync(join(projectRoot, '.codex', 'config.toml'), 'a = = 1');
    assert.equal(claude.configuredServers(), null);
    assert.equal(codex.configuredServers(), null);
  } finally {
    cleanup();
  }
});

test('verify prints warn checks with "!" and still exits 0', async () => {
  const { projectRoot, base, homeDir, cleanup } = project();
  const out: string[] = [];
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => out.push(l), env: { PATH: '', CODEX_HOME: join(base, 'codex-home') }, cwd: projectRoot, homeDir };
  try {
    assert.equal(await run(['install', 'claude', '--project', projectRoot], io), 0);
    // Hand-record an integration that has no verify checks yet, then confirm plain output is unchanged.
    out.length = 0;
    const code = await run(['verify', 'claude', '--project', projectRoot], io);
    assert.equal(code, 0, out.join('\n'));
    assert.match(out.join('\n'), /\[claude\] ok/);
  } finally {
    cleanup();
  }
});

test('a broken integrations.json becomes a failing check and verify exits 1', async () => {
  const { projectRoot, base, homeDir, cleanup } = project();
  const out: string[] = [];
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => out.push(l), env: { PATH: '', CODEX_HOME: join(base, 'codex-home') }, cwd: projectRoot, homeDir };
  try {
    assert.equal(await run(['install', 'claude', '--project', projectRoot], io), 0);
    mkdirSync(join(projectRoot, '.dev-agent'), { recursive: true });
    writeFileSync(join(projectRoot, '.dev-agent', 'integrations.json'), '{oops');
    out.length = 0;
    assert.equal(await run(['verify', 'claude', '--project', projectRoot], io), 1);
    assert.match(out.join('\n'), /✘ integrations-state: .*integrations\.json/);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/integrations-verify.test.ts`
Expected: FAIL, `configuredServers is not a function`.

- [ ] **Step 3: Add `warn` to `CheckResult` and `configuredServers` to the adapters**

`src/types.ts`:

```ts
export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  /** Set together with ok: true when something is missing on this machine but the project config is correct. */
  warn?: boolean;
}
```

`src/adapters/host-adapter.ts` add to the interface:

```ts
  /** The MCP servers in this project's host config: {} when the file is absent, null when it cannot be parsed. */
  configuredServers(): Record<string, unknown> | null;
```

`src/adapters/claude.ts` add a method:

```ts
  configuredServers(): Record<string, unknown> | null {
    try {
      return { ...(this.readMcpJson().mcpServers ?? {}) };
    } catch {
      return null;
    }
  }
```

`src/adapters/codex.ts` add a method:

```ts
  configuredServers(): Record<string, unknown> | null {
    if (!existsSync(this.configFile)) return {};
    try {
      return JSON.parse(JSON.stringify(serversOf(parseToml(readFileSync(this.configFile, 'utf8'), this.configFile))));
    } catch {
      return null;
    }
  }
```

`src/adapters/stub.ts` add: `configuredServers(): null { return null; }`

- [ ] **Step 4: Add `integrationChecks` and use it in `verify`**

Append to `src/integrations/index.ts`:

```ts
import type { HostAdapter } from '../adapters/host-adapter.js';
import type { AdapterContext, CheckResult } from '../types.js';
import type { IntegrationState } from './state.js';

/** The verify checks of every integration this project has enabled and that applies to `host`. */
export async function integrationChecks(host: HostAdapter, ctx: AdapterContext, state: IntegrationState): Promise<CheckResult[]> {
  if (state.error) return [{ name: 'integrations-state', ok: false, detail: state.error }];
  const configured = host.configuredServers();
  const checks: CheckResult[] = [];
  for (const integration of INTEGRATIONS) {
    if (!state.ids.includes(integration.id) || !integration.hosts.includes(host.name)) continue;
    checks.push(...integration.verify(host.name, ctx, await integration.detect(ctx), configured));
  }
  return checks;
}
```

(Keep the type-only `IntegrationState` import: `state.ts` imports `INTEGRATIONS` from `index.ts`, and TypeScript erases type-only imports, so there is no runtime cycle. Use `import type`.)

In `src/cli.ts` replace `verify`:

```ts
async function verify(adapters: HostAdapter[], ctx: AdapterContext, io: CliIo): Promise<boolean> {
  const state = readIntegrationState(ctx.projectRoot);
  let allOk = true;
  for (const adapter of adapters) {
    const result = await withHostPrefix(adapter, () => adapter.verify());
    result.checks.push(...(await integrationChecks(adapter, ctx, state)));
    result.ok = result.checks.every((check) => check.ok);
    const warned = result.checks.some((check) => check.warn);
    io.stdout(`\n[${adapter.name}] ${result.ok ? (warned ? 'ok (with warnings)' : 'ok') : 'NOT OK'}`);
    for (const check of result.checks) io.stdout(`  ${check.warn ? '!' : check.ok ? '✔' : '✘'} ${check.name}: ${check.detail}`);
    allOk &&= result.ok;
  }
  return allOk;
}
```

Add `integrationChecks` to the `./integrations/index.js` import and change the call to `verify(adapters, ctx, io)`.

- [ ] **Step 5: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS, golden unchanged (`verify` output for projects without integrations is identical).

- [ ] **Step 6: Commit**

```bash
cd /home/andre/dev-agent-kit
git add -A packages/cli
git commit -m "cli: warn check state and integration checks in verify"
```

---

### Task 5: Headroom integration

**Files:**
- Create: `packages/cli/src/integrations/headroom.ts`
- Create: `packages/cli/tests/integration-headroom.test.ts`
- Modify: `packages/cli/src/integrations/index.ts` (register)

**Interfaces:**
- Consumes: `which` from `src/util.ts`; `Integration` (Task 2); `configuredServers` (Task 4).
- Produces: `headroom: Integration`, `HEADROOM_INSTALL = 'uv tool install "headroom-ai[all]"'`. Entries: Claude `{ type: 'stdio', command: <abs>, args: ['mcp','serve'] }`, Codex `{ command: <abs>, args: ['mcp','serve'] }`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/cli/tests/integration-headroom.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { headroom, HEADROOM_INSTALL } from '../src/integrations/headroom.ts';
import { run, type CliIo } from '../src/cli.ts';
import { ClaudeCodeAdapter } from '../src/adapters/claude.ts';
import { CodexAdapter } from '../src/adapters/codex.ts';
import { project, fakeBin } from './integration-helpers.ts';

test('detect: path lookup only; present with binPath, absent otherwise', async () => {
  const { base, ctx, cleanup } = project();
  try {
    assert.deepEqual(await headroom.detect({ ...ctx, env: { PATH: '' } }), { state: 'absent' });
    const bin = fakeBin(join(base, 'bin'), 'headroom');
    assert.deepEqual(await headroom.detect({ ...ctx, env: { PATH: join(base, 'bin') } }), { state: 'present', binPath: bin, detail: bin });
  } finally {
    cleanup();
  }
});

test('assertInstallable fails with the install command when the binary is missing', () => {
  assert.throws(() => headroom.assertInstallable!({ state: 'absent' }), new RegExp(HEADROOM_INSTALL.replace(/[[\]]/g, '\\$&')));
  assert.doesNotThrow(() => headroom.assertInstallable!({ state: 'present', binPath: '/x/headroom' }));
});

test('plan: stdio entry for claude, plain command entry for codex, nothing when absent', () => {
  const present = { state: 'present', binPath: '/abs/headroom' } as const;
  assert.deepEqual(headroom.plan('claude', present), [{ name: 'headroom', entry: { type: 'stdio', command: '/abs/headroom', args: ['mcp', 'serve'] } }]);
  assert.deepEqual(headroom.plan('codex', present), [{ name: 'headroom', entry: { command: '/abs/headroom', args: ['mcp', 'serve'] } }]);
  assert.deepEqual(headroom.plan('claude', { state: 'absent' }), []);
});

test('verify: ok, warn (binary gone), fail (malformed or missing entry), nothing when config unreadable', () => {
  const { base, ctx, cleanup } = project();
  try {
    const real = fakeBin(join(base, 'bin'), 'headroom');
    const v = (configured: Record<string, unknown> | null) => headroom.verify('claude', ctx, { state: 'present', binPath: real }, configured);
    assert.deepEqual(v({ headroom: { command: real, args: ['mcp', 'serve'] } }).map((c) => [c.ok, !!c.warn]), [[true, false]]);
    const gone = v({ headroom: { command: '/no/such/headroom', args: ['mcp', 'serve'] } });
    assert.deepEqual([gone[0].ok, gone[0].warn], [true, true]);
    assert.match(gone[0].detail, /uv tool install/);
    assert.equal(v({ headroom: { command: 5 } })[0].ok, false);
    assert.equal(v({ headroom: 'x' })[0].ok, false);
    assert.equal(v({})[0].ok, false);
    assert.deepEqual(v(null), []);
  } finally {
    cleanup();
  }
});

test('install --with headroom: both hosts get the entry, a second run adds no duplicate, plain re-install keeps it (sticky)', async () => {
  const { base, projectRoot, homeDir, cleanup } = project();
  const binDir = join(base, 'bin');
  const bin = fakeBin(binDir, 'headroom');
  const out: string[] = [];
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => out.push(l), env: { PATH: binDir, CODEX_HOME: join(base, 'codex-home') }, cwd: projectRoot, homeDir };
  try {
    assert.equal(await run(['install', '--all', '--with', 'headroom', '--with', 'headroom', '--project', projectRoot], io), 0, out.join('\n'));
    const claudeJson = JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf8'));
    assert.deepEqual(claudeJson.mcpServers.headroom, { type: 'stdio', command: bin, args: ['mcp', 'serve'] });
    const toml = parse(readFileSync(join(projectRoot, '.codex', 'config.toml'), 'utf8')) as { mcp_servers: Record<string, unknown> };
    assert.deepEqual(JSON.parse(JSON.stringify(toml.mcp_servers.headroom)), { command: bin, args: ['mcp', 'serve'] });
    const before = readFileSync(join(projectRoot, '.mcp.json'), 'utf8');
    assert.equal(await run(['install', '--all', '--project', projectRoot], io), 0);
    assert.equal(readFileSync(join(projectRoot, '.mcp.json'), 'utf8'), before);
    assert.match(readFileSync(join(projectRoot, '.dev-agent', 'integrations.json'), 'utf8'), /headroom/);
  } finally {
    cleanup();
  }
});

test('install --with headroom without the binary exits 1 with the install command and writes nothing', async () => {
  const { projectRoot, base, homeDir, cleanup } = project();
  const err: string[] = [];
  const io: CliIo = { stdout: () => {}, stderr: (l) => err.push(l), env: { PATH: '', CODEX_HOME: join(base, 'codex-home') }, cwd: projectRoot, homeDir };
  try {
    assert.equal(await run(['install', 'claude', '--with', 'headroom', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /uv tool install/);
    assert.throws(() => readFileSync(join(projectRoot, '.mcp.json')));
  } finally {
    cleanup();
  }
});

test('a pre-existing different headroom entry is kept and reported, in both hosts', async () => {
  const { base, projectRoot, ctx, cleanup } = project();
  try {
    const bin = fakeBin(join(base, 'bin'), 'headroom');
    const extra = headroom.plan('claude', { state: 'present', binPath: bin });
    writeFileSync(join(projectRoot, '.mcp.json'), JSON.stringify({ mcpServers: { headroom: { command: 'custom' } } }));
    const actions = await new ClaudeCodeAdapter(ctx).installMcp({ kitRoot: ctx.kitRoot, projectRoot, extraServers: extra });
    assert.deepEqual(JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf8')).mcpServers.headroom, { command: 'custom' });
    assert.ok(actions.some((a) => /headroom.*already configured.*kept/.test(a)));

    mkdirSync(join(projectRoot, '.codex'));
    writeFileSync(join(projectRoot, '.codex', 'config.toml'), '[mcp_servers.headroom]\ncommand = "custom"\n');
    const codexActions = await new CodexAdapter(ctx).installMcp({ kitRoot: ctx.kitRoot, projectRoot, extraServers: headroom.plan('codex', { state: 'present', binPath: bin }) });
    assert.ok(codexActions.some((a) => /headroom.*already configured.*kept/.test(a)));
    assert.match(readFileSync(join(projectRoot, '.codex', 'config.toml'), 'utf8'), /command = "custom"/);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/integration-headroom.test.ts`
Expected: FAIL, cannot find module `../src/integrations/headroom.ts`.

- [ ] **Step 3: Implement**

```ts
// packages/cli/src/integrations/headroom.ts
import { existsSync } from 'node:fs';
import { which } from '../util.js';
import type { Integration } from './types.js';

export const HEADROOM_INSTALL = 'uv tool install "headroom-ai[all]"';
const ARGS = ['mcp', 'serve'];

export const headroom: Integration = {
  id: 'headroom',
  hosts: ['claude', 'codex'],
  defaultOn: false,
  async detect(ctx) {
    const binPath = which('headroom', ctx.env);
    return binPath ? { state: 'present', binPath, detail: binPath } : { state: 'absent' };
  },
  assertInstallable(detection) {
    if (detection.state !== 'present') {
      throw new Error(`frontend-agent: --with headroom needs the headroom binary on PATH; install it first with: ${HEADROOM_INSTALL}`);
    }
  },
  plan(host, detection) {
    if (detection.state !== 'present' || !detection.binPath) return [];
    const entry = host === 'claude' ? { type: 'stdio', command: detection.binPath, args: [...ARGS] } : { command: detection.binPath, args: [...ARGS] };
    return [{ name: 'headroom', entry }];
  },
  verify(_host, _ctx, _detection, configured) {
    const name = 'integration:headroom';
    if (configured === null) return [];
    const entry = configured.headroom;
    if (entry === undefined) {
      return [{ name, ok: false, detail: 'enabled for this project but there is no headroom MCP entry — run: dev-agent install --with headroom' }];
    }
    const e = entry as Record<string, unknown>;
    if (typeof entry !== 'object' || entry === null || typeof e.command !== 'string' || !Array.isArray(e.args)) {
      return [{ name, ok: false, detail: 'the headroom MCP entry is malformed (it needs a command and args)' }];
    }
    if (!existsSync(e.command)) {
      return [{ name, ok: true, warn: true, detail: `entry present but ${e.command} no longer exists — reinstall with: ${HEADROOM_INSTALL}, then re-run install --with headroom` }];
    }
    return [{ name, ok: true, detail: `entry present, binary ${e.command}` }];
  },
  notes(_host, detection) {
    return detection.state === 'present' && detection.binPath
      ? [`headroom: the MCP entry points at ${detection.binPath}; re-run install --with headroom if the binary moves.`]
      : [];
  }
};
```

Register: in `src/integrations/index.ts` import `headroom` and set `INTEGRATIONS = [figma, headroom]`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test tests/integration-headroom.test.ts && npm run typecheck && npm test`
Expected: PASS everywhere, golden unchanged. Also `integrations-select.test.ts` still passes (its injected registry now overlaps `headroom`; if it reports a duplicate id, drop `fake('headroom', ...)` from that test's registry and keep `fake('cartographer', ...)`).

- [ ] **Step 5: Commit**

```bash
cd /home/andre/dev-agent-kit
git add -A packages/cli
git commit -m "cli: headroom integration"
```

---

### Task 6: claude-mem integration (verify-only)

**Files:**
- Create: `packages/cli/src/integrations/claude-mem.ts`
- Create: `packages/cli/tests/integration-claude-mem.test.ts`
- Modify: `packages/cli/src/integrations/index.ts` (register)

**Interfaces:**
- Consumes: `Integration`, `Detection` (Task 2).
- Produces: `claudeMem: Integration` (hosts `['claude']`, `plan` always `[]`). `detect` reads `~/.claude-mem/.worker.port` and `~/.local/bin/claude-mem` under `ctx.homeDir`, then one `GET http://127.0.0.1:<port>/api/health` (1 s timeout).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/cli/tests/integration-claude-mem.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudeMem } from '../src/integrations/claude-mem.ts';
import { project, fakeBin } from './integration-helpers.ts';

function stubServer(status: number): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.statusCode = req.url === '/api/health' ? status : 404;
      res.end('{}');
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ port, close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}

function writePort(homeDir: string, content: string) {
  mkdirSync(join(homeDir, '.claude-mem'), { recursive: true });
  writeFileSync(join(homeDir, '.claude-mem', '.worker.port'), content);
}

test('nothing installed: absent', async () => {
  const { ctx, cleanup } = project();
  try {
    assert.deepEqual(await claudeMem.detect(ctx), { state: 'absent' });
  } finally {
    cleanup();
  }
});

test('healthy worker: present', async () => {
  const { homeDir, ctx, cleanup } = project();
  const server = await stubServer(200);
  try {
    writePort(homeDir, `${server.port}\n`);
    const detection = await claudeMem.detect(ctx);
    assert.equal(detection.state, 'present');
  } finally {
    await server.close();
    cleanup();
  }
});

test('worker answers with an error status, or nothing listens: unknown, never a throw', async () => {
  const { homeDir, ctx, cleanup } = project();
  const server = await stubServer(500);
  try {
    writePort(homeDir, String(server.port));
    assert.equal((await claudeMem.detect(ctx)).state, 'unknown');
    await server.close();
    assert.equal((await claudeMem.detect(ctx)).state, 'unknown');
  } finally {
    cleanup();
  }
});

test('empty, garbage or out-of-range port file: unknown, never a throw', async () => {
  const { homeDir, ctx, cleanup } = project();
  try {
    for (const content of ['', '\n', 'abc', '0', '99999', '-3', '12.5']) {
      writePort(homeDir, content);
      const detection = await claudeMem.detect(ctx);
      assert.equal(detection.state, 'unknown', `port file ${JSON.stringify(content)}`);
    }
  } finally {
    cleanup();
  }
});

test('launcher present but worker never started: unknown', async () => {
  const { homeDir, ctx, cleanup } = project();
  try {
    fakeBin(join(homeDir, '.local', 'bin'), 'claude-mem');
    assert.equal((await claudeMem.detect(ctx)).state, 'unknown');
  } finally {
    cleanup();
  }
});

test('verify: ok when present, warn with the install command otherwise, never fail; plan and notes', () => {
  const { ctx, cleanup } = project();
  try {
    assert.deepEqual(claudeMem.verify('claude', ctx, { state: 'present', detail: 'worker healthy' }, {}).map((c) => [c.ok, !!c.warn]), [[true, false]]);
    for (const detection of [{ state: 'absent' }, { state: 'unknown', reason: 'worker did not answer' }] as const) {
      const [check] = claudeMem.verify('claude', ctx, detection, {});
      assert.equal(check.ok, true);
      assert.equal(check.warn, true);
      assert.match(check.detail, /npx claude-mem install/);
    }
    assert.deepEqual(claudeMem.plan('claude', { state: 'absent' }), []);
    assert.match(claudeMem.notes('claude', { state: 'absent' }).join(' '), /npx claude-mem install/);
    assert.deepEqual(claudeMem.notes('claude', { state: 'present' }), []);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/integration-claude-mem.test.ts`
Expected: FAIL, cannot find module `../src/integrations/claude-mem.ts`.

- [ ] **Step 3: Implement**

```ts
// packages/cli/src/integrations/claude-mem.ts
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Detection, Integration } from './types.js';

const INSTALL = 'npx claude-mem install';

export const claudeMem: Integration = {
  id: 'claude-mem',
  hosts: ['claude'],
  defaultOn: false,
  async detect(ctx): Promise<Detection> {
    try {
      const portFile = path.join(ctx.homeDir, '.claude-mem', '.worker.port');
      const launcher = path.join(ctx.homeDir, '.local', 'bin', 'claude-mem');
      if (!existsSync(portFile)) {
        return existsSync(launcher) ? { state: 'unknown', reason: 'launcher found but no worker port recorded (the worker is not running)' } : { state: 'absent' };
      }
      const port = Number(readFileSync(portFile, 'utf8').trim());
      if (!Number.isInteger(port) || port < 1 || port > 65535) return { state: 'unknown', reason: `no valid port in ${portFile}` };
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
        return response.ok
          ? { state: 'present', detail: `worker healthy on 127.0.0.1:${port}` }
          : { state: 'unknown', reason: `the worker on 127.0.0.1:${port} answered HTTP ${response.status}` };
      } catch {
        return { state: 'unknown', reason: `the worker on 127.0.0.1:${port} did not answer within 1 s` };
      }
    } catch (error) {
      return { state: 'unknown', reason: (error as Error).message };
    }
  },
  plan: () => [],
  verify(_host, _ctx, detection) {
    const name = 'integration:claude-mem';
    if (detection.state === 'present') return [{ name, ok: true, detail: detection.detail ?? 'worker healthy' }];
    const why = detection.state === 'unknown' ? `${detection.reason}; ` : 'not installed; ';
    return [{ name, ok: true, warn: true, detail: `${why}install with: ${INSTALL} (or /plugin install claude-mem)` }];
  },
  notes(_host, detection) {
    return detection.state === 'present' ? [] : [`claude-mem: not running on this machine — install it with: ${INSTALL} (the kit does not install it).`];
  }
};
```

Register in `src/integrations/index.ts`: `INTEGRATIONS = [figma, headroom, claudeMem]`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test tests/integration-claude-mem.test.ts && npm run typecheck && npm test`
Expected: PASS, golden unchanged.

- [ ] **Step 5: Commit**

```bash
cd /home/andre/dev-agent-kit
git add -A packages/cli
git commit -m "cli: claude-mem integration (verify-only)"
```

---

### Task 7: Cartographer integration and CLAUDE.md coexistence

**Files:**
- Create: `packages/cli/src/integrations/cartographer.ts`
- Create: `packages/cli/tests/integration-cartographer.test.ts`
- Modify: `packages/cli/src/integrations/index.ts` (register)

**Interfaces:**
- Consumes: `Integration`, `Detection`; `upsertMarkdownBlock` from `src/managed-block.ts`; `instructionsContent` from `src/instructions.ts` (via `ClaudeCodeAdapter.installInstructions`).
- Produces: `cartographer: Integration` (hosts `['claude']`, `plan` `[]`). `detect`: a `cartographer` directory under `<project>/.claude/skills/` or `<home>/.claude/skills/` → `present`; otherwise `unknown` (plugin-managed installs have no documented location). `verify` also looks for `docs/CODEBASE_MAP.md`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/cli/tests/integration-cartographer.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartographer } from '../src/integrations/cartographer.ts';
import { ClaudeCodeAdapter } from '../src/adapters/claude.ts';
import { project } from './integration-helpers.ts';

test('detect: skill directory in the project or in ~/.claude/skills is present; otherwise unknown', async () => {
  const { homeDir, ctx, cleanup } = project();
  try {
    assert.equal((await cartographer.detect(ctx)).state, 'unknown');
    mkdirSync(join(homeDir, '.claude', 'skills', 'cartographer'), { recursive: true });
    assert.equal((await cartographer.detect(ctx)).state, 'present');
  } finally {
    cleanup();
  }
  const second = project();
  try {
    mkdirSync(join(second.projectRoot, '.claude', 'skills', 'cartographer'), { recursive: true });
    assert.equal((await cartographer.detect(second.ctx)).state, 'present');
  } finally {
    second.cleanup();
  }
});

test('verify: skill found → ok; map present → extra ok; neither → warn with both marketplace commands', () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    const none = cartographer.verify('claude', ctx, { state: 'unknown', reason: 'x' }, {});
    assert.deepEqual(none.map((c) => [c.ok, !!c.warn]), [[true, true]]);
    assert.match(none[0].detail, /plugin marketplace add kingbootoshi\/cartographer/);
    assert.match(none[0].detail, /plugin install cartographer/);

    const skill = cartographer.verify('claude', ctx, { state: 'present', detail: '/p' }, {});
    assert.deepEqual(skill.map((c) => [c.ok, !!c.warn]), [[true, false]]);

    mkdirSync(join(projectRoot, 'docs'));
    writeFileSync(join(projectRoot, 'docs', 'CODEBASE_MAP.md'), '# map');
    const both = cartographer.verify('claude', ctx, { state: 'present', detail: '/p' }, {});
    assert.equal(both.length, 2);
    assert.ok(both.every((c) => c.ok && !c.warn));

    const mapOnly = cartographer.verify('claude', ctx, { state: 'unknown', reason: 'x' }, {});
    assert.deepEqual(mapOnly.map((c) => [c.ok, !!c.warn]), [[true, false]]);
    assert.match(mapOnly[0].detail, /map/i);
  } finally {
    cleanup();
  }
});

test('plan is empty: the kit writes nothing for Cartographer', () => {
  assert.deepEqual(cartographer.plan('claude', { state: 'absent' }), []);
});

test('CLAUDE.md coexistence: Cartographer-style text around the kit block survives install and a second install byte for byte', async () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    const before = '# My project\n\n<!-- cartographer:start -->\nSee docs/CODEBASE_MAP.md for the architecture map.\n<!-- cartographer:end -->\n';
    const after = '\n## Notes\nKeep CODEBASE_MAP.md up to date.\n';
    const adapter = new ClaudeCodeAdapter(ctx);
    writeFileSync(join(projectRoot, 'CLAUDE.md'), before);
    await adapter.installInstructions();
    const first = readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8');
    assert.ok(first.startsWith(before), 'text before the kit block changed');
    writeFileSync(join(projectRoot, 'CLAUDE.md'), `${first}${after}`);
    await adapter.installInstructions();
    const second = readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8');
    assert.ok(second.startsWith(before), 'text before the kit block changed on re-install');
    assert.ok(second.endsWith(after), 'text after the kit block changed on re-install');
    await adapter.installInstructions();
    assert.equal(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8'), second, 'a third install is not idempotent');
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/integration-cartographer.test.ts`
Expected: FAIL, cannot find module `../src/integrations/cartographer.ts`.

- [ ] **Step 3: Implement**

```ts
// packages/cli/src/integrations/cartographer.ts
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Integration } from './types.js';

const MARKETPLACE = '/plugin marketplace add kingbootoshi/cartographer';
const INSTALL = '/plugin install cartographer';

export const cartographer: Integration = {
  id: 'cartographer',
  hosts: ['claude'],
  defaultOn: false,
  async detect(ctx) {
    for (const dir of [path.join(ctx.projectRoot, '.claude', 'skills', 'cartographer'), path.join(ctx.homeDir, '.claude', 'skills', 'cartographer')]) {
      try {
        if (existsSync(dir)) return { state: 'present', detail: dir };
      } catch {
        // unreadable location: fall through to unknown
      }
    }
    return { state: 'unknown', reason: 'plugin-managed installs have no documented location, so the plugin cannot be confirmed from here' };
  },
  plan: () => [],
  verify(_host, ctx, detection) {
    const name = 'integration:cartographer';
    const checks = [];
    if (detection.state === 'present') checks.push({ name, ok: true, detail: `skill found at ${detection.detail}` });
    if (existsSync(path.join(ctx.projectRoot, 'docs', 'CODEBASE_MAP.md'))) {
      checks.push({ name: `${name}:map`, ok: true, detail: 'docs/CODEBASE_MAP.md present (map generated)' });
    }
    if (checks.length === 0) {
      checks.push({ name, ok: true, warn: true, detail: `plugin not found; install with: ${MARKETPLACE} then ${INSTALL}` });
    }
    return checks;
  },
  notes(_host, detection) {
    return detection.state === 'present' ? [] : [`cartographer: not detected — in Claude Code run ${MARKETPLACE} then ${INSTALL} (the kit does not install it). The plugin edits CLAUDE.md itself; the kit's own block is left untouched.`];
  }
};
```

Register in `src/integrations/index.ts`: `INTEGRATIONS = [figma, headroom, claudeMem, cartographer]`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test tests/integration-cartographer.test.ts && npm run typecheck && npm test`
Expected: PASS, golden unchanged. If the coexistence test fails, the failure is a real finding about `upsertMarkdownBlock`: stop and report it, do not weaken the assertions.

- [ ] **Step 5: Commit**

```bash
cd /home/andre/dev-agent-kit
git add -A packages/cli
git commit -m "cli: cartographer integration (verify-only) and CLAUDE.md coexistence test"
```

---

### Task 8: Graphify integration (verify-only)

**Files:**
- Create: `packages/cli/src/integrations/graphify.ts`
- Create: `packages/cli/tests/integration-graphify.test.ts`
- Modify: `packages/cli/src/integrations/index.ts` (register)

**Interfaces:**
- Consumes: `which` from `src/util.ts`; `Integration`, `Detection`.
- Produces: `graphify: Integration` (hosts `['claude','codex']`, `plan` `[]`). Install hint: `uv tool install graphifyy` (PyPI package `graphifyy`, command `graphify`). `notes` states that the kit never runs `graphify install` and what that command changes.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/cli/tests/integration-graphify.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { graphify } from '../src/integrations/graphify.ts';
import { project, fakeBin } from './integration-helpers.ts';

test('detect: graphify on PATH is present, otherwise absent', async () => {
  const { base, ctx, cleanup } = project();
  try {
    assert.deepEqual(await graphify.detect({ ...ctx, env: { PATH: '' } }), { state: 'absent' });
    const bin = fakeBin(join(base, 'bin'), 'graphify');
    assert.deepEqual(await graphify.detect({ ...ctx, env: { PATH: join(base, 'bin') } }), { state: 'present', binPath: bin, detail: bin });
  } finally {
    cleanup();
  }
});

test('verify: binary → ok; graphify-out/GRAPH_REPORT.md → extra ok; missing binary → warn with uv hint', () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    assert.deepEqual(graphify.verify('claude', ctx, { state: 'present', binPath: '/b/graphify' }, {}).map((c) => [c.ok, !!c.warn]), [[true, false]]);
    mkdirSync(join(projectRoot, 'graphify-out'));
    writeFileSync(join(projectRoot, 'graphify-out', 'GRAPH_REPORT.md'), '# report');
    assert.equal(graphify.verify('codex', ctx, { state: 'present', binPath: '/b/graphify' }, {}).length, 2);
    const missing = graphify.verify('claude', ctx, { state: 'absent' }, {});
    assert.equal(missing[0].warn, true);
    assert.match(missing[0].detail, /uv tool install graphifyy/);
  } finally {
    cleanup();
  }
});

test('plan is empty; notes (absent) say the kit never runs graphify install and what it changes', () => {
  assert.deepEqual(graphify.plan('claude', { state: 'present', binPath: '/b/graphify' }), []);
  const notes = graphify.notes('claude', { state: 'absent' }).join(' ');
  assert.match(notes, /uv tool install graphifyy/);
  assert.match(notes, /never runs .graphify install./);
  assert.match(notes, /hooks/);
  assert.deepEqual(graphify.notes('claude', { state: 'present', binPath: '/b/graphify' }), []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/integration-graphify.test.ts`
Expected: FAIL, cannot find module `../src/integrations/graphify.ts`.

- [ ] **Step 3: Implement**

```ts
// packages/cli/src/integrations/graphify.ts
import { existsSync } from 'node:fs';
import path from 'node:path';
import { which } from '../util.js';
import type { CheckResult } from '../types.js';
import type { Integration } from './types.js';

const INSTALL = 'uv tool install graphifyy';

export const graphify: Integration = {
  id: 'graphify',
  hosts: ['claude', 'codex'],
  defaultOn: false,
  async detect(ctx) {
    const binPath = which('graphify', ctx.env);
    return binPath ? { state: 'present', binPath, detail: binPath } : { state: 'absent' };
  },
  plan: () => [],
  verify(_host, ctx, detection) {
    const name = 'integration:graphify';
    const checks: CheckResult[] = [];
    if (detection.state === 'present') checks.push({ name, ok: true, detail: `graphify found at ${detection.binPath}` });
    else checks.push({ name, ok: true, warn: true, detail: `graphify not found on PATH; install with: ${INSTALL} (PyPI package graphifyy, command graphify, Python 3.10+)` });
    if (existsSync(path.join(ctx.projectRoot, 'graphify-out', 'GRAPH_REPORT.md'))) {
      checks.push({ name: `${name}:graph`, ok: true, detail: 'graphify-out/GRAPH_REPORT.md present (graph generated)' });
    }
    return checks;
  },
  notes(_host, detection) {
    if (detection.state === 'present') return [];
    return [
      `graphify: not found on PATH — install with: ${INSTALL} (the kit does not install it).`,
      'graphify: the kit never runs `graphify install`. That command registers a global /graphify skill, edits CLAUDE.md and adds PreToolUse hooks that steer Claude toward the graph before grep; read what it changes before you run it yourself.'
    ];
  }
};
```

Register in `src/integrations/index.ts`: `INTEGRATIONS = [figma, headroom, claudeMem, cartographer, graphify]`.

- [ ] **Step 4: Run everything**

Run: `node --import tsx --test tests/integration-graphify.test.ts && npm run typecheck && npm test`
Expected: PASS, golden unchanged. The valid-id error message in `integrations-select.test.ts` (`figma, headroom, cartographer`) uses the injected registry, so it is unaffected.

- [ ] **Step 5: Commit**

```bash
cd /home/andre/dev-agent-kit
git add -A packages/cli
git commit -m "cli: graphify integration (verify-only)"
```

---

### Task 9: End-to-end CLI check, docs and full suite

**Files:**
- Modify: `packages/cli/tests/integrations-cli.test.ts` (end-to-end cases)
- Create: `docs/integrations.md`
- Modify: `docs/cli.md`, `README.md` (link and flags)

**Interfaces:**
- Consumes: everything above; `docs.test.ts` checks that every `dev-agent <words>` line in the docs matches `DEV_HELP`.
- Produces: user-facing documentation of `--with`, `--no-<id>`, the warn state and the state file.

- [ ] **Step 1: Add the end-to-end tests**

Append to `tests/integrations-cli.test.ts`:

```ts
import { rmSync } from 'node:fs';
import { fakeBin } from './integration-helpers.ts';

test('end to end: install --with headroom --with graphify, then verify warns for a missing graphify and exits 0', async () => {
  const { base, projectRoot, homeDir, cleanup } = project();
  const binDir = join(base, 'bin');
  fakeBin(binDir, 'headroom');
  const g = fakeBin(binDir, 'graphify');
  const out: string[] = [];
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => out.push(l), env: { PATH: binDir, CODEX_HOME: join(base, 'codex-home') }, cwd: projectRoot, homeDir };
  try {
    assert.equal(await run(['install', 'claude', '--with', 'headroom', '--with', 'graphify', '--project', projectRoot], io), 0, out.join('\n'));
    out.length = 0;
    assert.equal(await run(['verify', 'claude', '--project', projectRoot], io), 0, out.join('\n'));
    assert.match(out.join('\n'), /✔ integration:headroom/);
    assert.match(out.join('\n'), /✔ integration:graphify/);
    // the machine loses graphify: still exit 0, now with a warning
    rmSync(g);
    out.length = 0;
    assert.equal(await run(['verify', 'claude', '--project', projectRoot], io), 0, out.join('\n'));
    assert.match(out.join('\n'), /! integration:graphify/);
    assert.match(out.join('\n'), /\[claude\] ok \(with warnings\)/);
  } finally {
    cleanup();
  }
});

test('end to end: --with cartographer on codex only is a usage error naming claude', async () => {
  const { projectRoot, io, err, cleanup } = harness();
  try {
    assert.equal(await run(['install', 'codex', '--with', 'cartographer', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /cartographer.*claude/);
  } finally {
    cleanup();
  }
});

test('end to end: a headroom entry removed by hand fails verify with exit 1', async () => {
  const { base, projectRoot, homeDir, cleanup } = project();
  const binDir = join(base, 'bin');
  fakeBin(binDir, 'headroom');
  const out: string[] = [];
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => out.push(l), env: { PATH: binDir, CODEX_HOME: join(base, 'codex-home') }, cwd: projectRoot, homeDir };
  try {
    assert.equal(await run(['install', 'claude', '--with', 'headroom', '--project', projectRoot], io), 0);
    const file = join(projectRoot, '.mcp.json');
    const json = JSON.parse(readFileSync(file, 'utf8'));
    delete json.mcpServers.headroom;
    writeFileSync(file, JSON.stringify(json));
    out.length = 0;
    assert.equal(await run(['verify', 'claude', '--project', projectRoot], io), 1);
    assert.match(out.join('\n'), /✘ integration:headroom/);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run to verify they pass**

Run: `node --import tsx --test tests/integrations-cli.test.ts`
Expected: PASS.

- [ ] **Step 3: Write `docs/integrations.md`**

Write the document in English like the other `docs/*.md`, with these sections and content:

1. **What an integration is**: an optional tool the kit knows how to wire or check. The kit never installs software; `install` writes only inside the project and prints what is missing.
2. **Table**: id, hosts, what the kit writes, how `verify` checks it, install command (use the exact commands from the spec: `uv tool install "headroom-ai[all]"`, `npx claude-mem install`, `/plugin marketplace add kingbootoshi/cartographer` + `/plugin install cartographer`, `uv tool install graphifyy`). Figma: default on, remote HTTP server.
3. **Selecting**: a fenced block with `dev-agent install claude --with headroom`, `dev-agent install --all --with graphify --no-figma`.
4. **Verify states**: `ok` / `warn` / `fail` table and exit codes (0/0/1) as in the spec.
5. **State file**: `.dev-agent/integrations.json`, sticky selection, `--no-<id>` drops one.
6. **Safety**: the bullet list from the spec's Safety section, plus the Graphify warning about `graphify install`.

- [ ] **Step 4: Link it from `docs/cli.md` and `README.md`**

In `docs/cli.md` extend the `install` usage line with `[--with <id> ...] [--no-<id> ...]` and add one paragraph linking `integrations.md`. In `README.md` add one line under the install section: `Optional integrations (Headroom, claude-mem, Cartographer, Graphify): see docs/integrations.md.` Keep every `dev-agent ...` command in these docs consistent with `DEV_HELP`.

- [ ] **Step 5: Run the whole suite from the repo root**

Run: `cd /home/andre/dev-agent-kit && npm test`
Expected: all workspaces PASS, including `docs.test.ts`, `integrations-golden.test.ts` (unchanged goldens) and `package-manifest.test.ts`. If `package-manifest.test.ts` complains that a new directory is not in the package `files` list, add `packages/cli/src/integrations` coverage there the way the neighbouring entries are listed.

- [ ] **Step 6: Manual checklist (not automated, tools change fast)**

Record the outcome in the commit message body, one line each:

- [ ] Install Headroom for real (`uv tool install "headroom-ai[all]"`), run `dev-agent install claude --with headroom` in a scratch project, start Claude Code, confirm `/mcp` lists `headroom` as connected. This confirms the assumed Claude `.mcp.json` form (spec open item 1). If it does not load, compare with `headroom mcp install` output and fix the entry in `headroom.ts`.
- [ ] Install Cartographer from the marketplace, run `/cartographer` in a scratch project, confirm `verify` finds the skill or only the map, and note where the plugin actually lives (spec open item 2).
- [ ] Install claude-mem, start Claude Code once, confirm `verify` reports the worker healthy.
- [ ] Confirm the official Graphify repository and that PyPI `graphifyy` belongs to it; read what `graphify install` writes (spec open item 4); update the notes text if it differs.

- [ ] **Step 7: Commit**

```bash
cd /home/andre/dev-agent-kit
git add -A packages/cli docs README.md
git commit -m "docs: integrations guide; test: end-to-end integration flows"
```

---

## Self-Review

**Spec coverage**
- Registry replacing `includeFigma`, Figma identical output → Tasks 1–2.
- Headroom (detect, plan, install-time rule, verify states) → Task 5.
- claude-mem (read-only detect, loopback health check, never fail) → Task 6.
- Cartographer (detect, verify, coexistence test) → Task 7.
- Graphify (detect, verify, `graphify install` warning) → Task 8.
- CLI surface (`--with`, `--no-<id>`, `--no-figma`, unsupported host, unknown id) → Task 3, end-to-end in Task 9.
- State recording and sticky selection → Task 3. Check states, exit codes → Task 4.
- Safety (assertInsideRoot, preflight fail closed, detect never throws) → Tasks 3, 5, 6.
- Testing section items 1–6 → Tasks 1, 5–8 (per integration), 3 (safety), 4–9 (verify, CLI), 7 (coexistence).
- Spec open items 1, 2, 4 → manual checklist in Task 9; item 3 resolved in the spec.

**Placeholder scan:** no TBD/TODO; the only "adjust if" notes (Task 3 step 8, Task 5 step 4, Task 7 step 4, Task 9 step 5) name the exact condition and fix.

**Type consistency:** `McpServerChange { name, entry, hint? }`, `Integration.plan(host, detection)`, `Integration.verify(host, ctx, detection, configured)`, `configuredServers()`, `resolveSelection(flags, hosts, previous, registry?)`, `readIntegrationState`/`persistIntegrationState`/`assertStateWritable`, `integrationChecks(host, ctx, state)` are spelled the same in every task that uses them.

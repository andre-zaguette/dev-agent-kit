# Frontend Agent Kit v0.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v0.2 slice of the Frontend Agent Kit: the kit's own MCP server (`packages/mcp-server`), with exactly two tools — `capture_screenshot` and `inspect_dom` — built on Playwright and registered over stdio, with a host allowlist guard-rail on both tools.

**Architecture:** A new npm workspace package (`packages/mcp-server`) exposes an MCP `McpServer` over stdio. Tool logic (screenshot capture, DOM inspection) lives in small, independently-testable modules that a security module gates before any browser ever launches. The server module itself stays a thin wrapper that registers tools and starts the stdio transport.

**Tech Stack:** TypeScript (ESM), `@modelcontextprotocol/sdk`, Playwright (Chromium), Zod, Node's built-in test runner (`node --test`) via `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-23-frontend-agent-kit-design.md` (§5 MCP próprio, §9 Segurança, §10 v0.2 roadmap line)

## Global Constraints

- Node.js, TypeScript, ESM throughout `packages/mcp-server`, consistent with the root repo's ESM convention.
- MCP stdio rule (spec §17 of the source doc, carried into design spec §5): stdout is reserved for JSON-RPC protocol framing. All logging goes to stderr (`console.error`) — never `console.log`.
- `capture_screenshot` and `inspect_dom` must both validate the target URL's hostname against an allowlist — default `localhost`/`127.0.0.1`, extendable per-project via `.frontend-agent/config.yml`'s `allowedHosts:` list — **before** launching a browser. No arbitrary URL fetches (spec §9).
- No tool in this plan executes shell commands or exposes filesystem writes outside an explicitly passed `outputPath` (spec §9).
- All registered MCP tool input schemas use Zod (spec §9).
- Out of scope for this plan (spec §10, §11): `compare-screenshots`, `run-responsive-suite`, `run-accessibility-audit`, validation-profile enforcement (all v0.3), and the CLI installer (v0.4). Registering the server with a user's actual Claude Code/Codex config is documented in this plan but is a user action against their own machine, not a repo change this plan performs.

---

### Task 1: Package scaffolding and server entrypoint

**Files:**
- Modify: `package.json` (root)
- Create: `packages/mcp-server/package.json`
- Create: `packages/mcp-server/tsconfig.json`
- Create: `packages/mcp-server/src/index.ts`
- Create: `packages/mcp-server/tests/index.test.ts`

**Interfaces:**
- Produces: `createServer(): McpServer` exported from `packages/mcp-server/src/index.ts`, consumed by Task 5 (which adds tool registrations to it).
- Produces: the package's `test`, `start`, `typecheck` npm scripts, used by every later task in this plan.

- [ ] **Step 1: Update the root `package.json` to declare the workspace and add convenience scripts**

Current content:
```json
{
  "name": "frontend-agent-kit",
  "private": true,
  "type": "module",
  "scripts": {
    "validate:skills": "node scripts/validate-skill.mjs skills"
  }
}
```

New content:
```json
{
  "name": "frontend-agent-kit",
  "private": true,
  "type": "module",
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "validate:skills": "node scripts/validate-skill.mjs skills",
    "mcp:server": "npm run start --workspace=packages/mcp-server",
    "mcp:inspect": "npx @modelcontextprotocol/inspector npx tsx packages/mcp-server/src/index.ts"
  }
}
```

- [ ] **Step 2: Create `packages/mcp-server/package.json`**

```json
{
  "name": "@frontend-agent-kit/mcp-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts",
    "test": "node --import tsx --test tests/*.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "playwright": "^1.47.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 3: Create `packages/mcp-server/tsconfig.json`**

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
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 4: Install dependencies and the Chromium browser binary**

Run from the repo root:
```bash
npm install
npx --workspace=packages/mcp-server playwright install chromium
```

If your environment cannot download the Chromium binary (e.g. sandboxed/offline), note this in your report as a concern — Tasks 3 and 4's tests require a real browser and cannot pass without it.

- [ ] **Step 5: Write the server entrypoint (no tools registered yet — that's Task 5)**

`packages/mcp-server/src/index.ts`:
```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

export function createServer(): McpServer {
  return new McpServer({ name: 'frontend-agent', version: '0.1.0' });
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('frontend-agent MCP server running on stdio');
}

main().catch((error) => {
  console.error('frontend-agent MCP server failed to start:', error);
  process.exit(1);
});
```

If the installed `@modelcontextprotocol/sdk` version's exports differ from `server/mcp.js` / `server/stdio.js` (check `node_modules/@modelcontextprotocol/sdk/dist/esm/server/` if imports fail to resolve), adjust the import paths to match and note the discrepancy in your report — the class names (`McpServer`, `StdioServerTransport`) and their constructor/connect signatures are what matter, not the exact subpath.

- [ ] **Step 6: Write the smoke test**

`packages/mcp-server/tests/index.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));

test('server process starts, logs to stderr only, and stays alive', async () => {
  const child = spawn('npx', ['tsx', 'src/index.ts'], { cwd: packageRoot });
  let stderrOutput = '';
  let stdoutOutput = '';
  child.stderr.on('data', (chunk) => { stderrOutput += chunk.toString(); });
  child.stdout.on('data', (chunk) => { stdoutOutput += chunk.toString(); });

  await delay(1500);

  assert.equal(child.exitCode, null, 'process should still be running after 1.5s');
  assert.match(stderrOutput, /frontend-agent MCP server running on stdio/);
  assert.equal(stdoutOutput, '', 'stdout must stay clean for MCP JSON-RPC framing');

  child.kill();
});
```

- [ ] **Step 7: Run the test and verify it passes**

Run: `npm test --workspace=packages/mcp-server`
Expected: 1 test passing.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck --workspace=packages/mcp-server`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add package.json packages/mcp-server/
git commit -m "Add mcp-server package scaffolding with a minimal stdio entrypoint"
```

---

### Task 2: Host allowlist security module

**Files:**
- Create: `packages/mcp-server/src/security.ts`
- Create: `packages/mcp-server/tests/security.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure module, no Playwright).
- Produces: `parseAllowedHosts(configYaml: string): string[]`, `loadAllowedHosts(configPath?: string): string[]`, `isHostAllowed(url: string, extraAllowedHosts?: string[]): boolean` — all consumed by Task 3 (`screenshot.ts`) and Task 4 (`dom.ts`) to gate every browser launch.

- [ ] **Step 1: Write the failing tests**

`packages/mcp-server/tests/security.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAllowedHosts, isHostAllowed } from '../src/security.ts';

test('parseAllowedHosts extracts a flat YAML list under allowedHosts:', () => {
  const yaml = `validationProfile: standard\nallowedHosts:\n  - staging.example.com\n  - preview.example.com\nbreakpoints:\n  desktop: 1440x900\n`;
  assert.deepEqual(parseAllowedHosts(yaml), ['staging.example.com', 'preview.example.com']);
});

test('parseAllowedHosts returns an empty array when the key is absent', () => {
  assert.deepEqual(parseAllowedHosts('validationProfile: standard\n'), []);
});

test('parseAllowedHosts strips surrounding quotes from list items', () => {
  const yaml = `allowedHosts:\n  - "quoted.example.com"\n  - 'single-quoted.example.com'\n`;
  assert.deepEqual(parseAllowedHosts(yaml), ['quoted.example.com', 'single-quoted.example.com']);
});

test('isHostAllowed allows localhost and 127.0.0.1 by default', () => {
  assert.equal(isHostAllowed('http://localhost:5173/'), true);
  assert.equal(isHostAllowed('http://127.0.0.1:3000/'), true);
});

test('isHostAllowed rejects an arbitrary external host by default', () => {
  assert.equal(isHostAllowed('http://example.com/'), false);
});

test('isHostAllowed allows a host from an explicit extra allowlist', () => {
  assert.equal(isHostAllowed('http://staging.example.com/', ['staging.example.com']), true);
});

test('isHostAllowed rejects a malformed URL', () => {
  assert.equal(isHostAllowed('not-a-url'), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=packages/mcp-server`
Expected: FAIL — `Cannot find module '../src/security.ts'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

`packages/mcp-server/src/security.ts`:
```ts
import { existsSync, readFileSync } from 'node:fs';

const DEFAULT_ALLOWED_HOSTS = ['localhost', '127.0.0.1'];

export function parseAllowedHosts(configYaml: string): string[] {
  const lines = configYaml.split('\n');
  const startIndex = lines.findIndex((line) => line.trim() === 'allowedHosts:');
  if (startIndex === -1) return [];

  const hosts: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    const match = lines[i].match(/^\s*-\s*(.+?)\s*$/);
    if (!match) break;
    hosts.push(match[1].replace(/^["']|["']$/g, ''));
  }
  return hosts;
}

export function loadAllowedHosts(configPath = '.frontend-agent/config.yml'): string[] {
  if (!existsSync(configPath)) return [];
  return parseAllowedHosts(readFileSync(configPath, 'utf8'));
}

export function isHostAllowed(url: string, extraAllowedHosts: string[] = []): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  return [...DEFAULT_ALLOWED_HOSTS, ...extraAllowedHosts].includes(hostname);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace=packages/mcp-server`
Expected: 8 tests passing (1 from Task 1 + 7 from this task).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=packages/mcp-server`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp-server/src/security.ts packages/mcp-server/tests/security.test.ts
git commit -m "Add host allowlist security module for mcp-server tools"
```

---

### Task 3: `capture_screenshot` tool logic

**Files:**
- Create: `packages/mcp-server/tests/fixtures/server.ts`
- Create: `packages/mcp-server/src/screenshot.ts`
- Create: `packages/mcp-server/tests/screenshot.test.ts`

**Interfaces:**
- Consumes: `isHostAllowed`, `loadAllowedHosts` from `./security.js` (Task 2).
- Produces: `startFixtureServer(html: string): Promise<{ url: string; close: () => Promise<void> }>` and `FIXTURE_HTML: string` from `tests/fixtures/server.ts`, reused by Task 4's tests.
- Produces: `captureScreenshot(input: { url: string; width: number; height: number; outputPath: string }): Promise<{ outputPath: string; width: number; height: number }>`, consumed by Task 5 (tool registration).

- [ ] **Step 1: Write the shared test fixture server**

`packages/mcp-server/tests/fixtures/server.ts`:
```ts
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export function startFixtureServer(html: string): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server: Server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${address.port}/`;
      resolve({
        url,
        close: () => new Promise((res) => server.close(() => res()))
      });
    });
  });
}

export const FIXTURE_HTML = `<!doctype html>
<html>
  <body>
    <h1 data-testid="hero-title" style="font-size: 32px; color: rgb(17, 24, 39);">Hello Fixture</h1>
  </body>
</html>`;
```

- [ ] **Step 2: Write the failing test for `captureScreenshot`**

`packages/mcp-server/tests/screenshot.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureScreenshot } from '../src/screenshot.ts';
import { startFixtureServer, FIXTURE_HTML } from './fixtures/server.ts';

test('captureScreenshot writes a non-empty PNG for an allowed local URL', async () => {
  const fixture = await startFixtureServer(FIXTURE_HTML);
  const dir = mkdtempSync(join(tmpdir(), 'frontend-agent-screenshot-'));
  const outputPath = join(dir, 'output.png');
  try {
    const result = await captureScreenshot({ url: fixture.url, width: 800, height: 600, outputPath });
    assert.equal(result.outputPath, outputPath);
    const stats = statSync(outputPath);
    assert.ok(stats.size > 1000, `expected a non-trivial PNG, got ${stats.size} bytes`);
  } finally {
    await fixture.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('captureScreenshot rejects a disallowed external host before launching a browser', async () => {
  await assert.rejects(
    () => captureScreenshot({
      url: 'http://example.com/',
      width: 800,
      height: 600,
      outputPath: '/tmp/frontend-agent-should-not-be-created.png'
    }),
    /host not allowed/
  );
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test --workspace=packages/mcp-server`
Expected: FAIL — `Cannot find module '../src/screenshot.ts'`.

- [ ] **Step 4: Write the implementation**

`packages/mcp-server/src/screenshot.ts`:
```ts
import { chromium } from 'playwright';
import { isHostAllowed, loadAllowedHosts } from './security.js';

export interface CaptureScreenshotInput {
  url: string;
  width: number;
  height: number;
  outputPath: string;
}

export interface CaptureScreenshotResult {
  outputPath: string;
  width: number;
  height: number;
}

export async function captureScreenshot(input: CaptureScreenshotInput): Promise<CaptureScreenshotResult> {
  const { url, width, height, outputPath } = input;

  if (!isHostAllowed(url, loadAllowedHosts())) {
    throw new Error(
      `capture_screenshot: host not allowed for "${url}". Allowed by default: localhost, 127.0.0.1. Add other hosts under "allowedHosts:" in .frontend-agent/config.yml.`
    );
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.screenshot({ path: outputPath, fullPage: true });
    return { outputPath, width, height };
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --workspace=packages/mcp-server`
Expected: 10 tests passing (8 from Tasks 1-2 + 2 from this task).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck --workspace=packages/mcp-server`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/mcp-server/tests/fixtures/ packages/mcp-server/src/screenshot.ts packages/mcp-server/tests/screenshot.test.ts
git commit -m "Add capture_screenshot tool logic with host allowlist guard"
```

---

### Task 4: `inspect_dom` tool logic

**Files:**
- Create: `packages/mcp-server/src/dom.ts`
- Create: `packages/mcp-server/tests/dom.test.ts`

**Interfaces:**
- Consumes: `isHostAllowed`, `loadAllowedHosts` from `./security.js` (Task 2); `startFixtureServer`, `FIXTURE_HTML` from `./fixtures/server.js` (Task 3).
- Produces: `inspectDom(input: { url: string; selector: string }): Promise<{ selector: string; rect: { x: number; y: number; width: number; height: number }; styles: { fontSize: string; color: string } }>`, consumed by Task 5 (tool registration).

- [ ] **Step 1: Write the failing tests**

`packages/mcp-server/tests/dom.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectDom } from '../src/dom.ts';
import { startFixtureServer, FIXTURE_HTML } from './fixtures/server.ts';

test('inspectDom returns rect and computed styles for a matching selector', async () => {
  const fixture = await startFixtureServer(FIXTURE_HTML);
  try {
    const result = await inspectDom({ url: fixture.url, selector: '[data-testid="hero-title"]' });
    assert.equal(result.selector, '[data-testid="hero-title"]');
    assert.ok(result.rect.width > 0);
    assert.ok(result.rect.height > 0);
    assert.equal(result.styles.fontSize, '32px');
    assert.equal(result.styles.color, 'rgb(17, 24, 39)');
  } finally {
    await fixture.close();
  }
});

test('inspectDom throws a clear error when the selector matches nothing', async () => {
  const fixture = await startFixtureServer(FIXTURE_HTML);
  try {
    await assert.rejects(
      () => inspectDom({ url: fixture.url, selector: '.does-not-exist' }),
      /no element matched selector/
    );
  } finally {
    await fixture.close();
  }
});

test('inspectDom rejects a disallowed external host', async () => {
  await assert.rejects(
    () => inspectDom({ url: 'http://example.com/', selector: 'body' }),
    /host not allowed/
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=packages/mcp-server`
Expected: FAIL — `Cannot find module '../src/dom.ts'`.

- [ ] **Step 3: Write the implementation**

`packages/mcp-server/src/dom.ts`:
```ts
import { chromium } from 'playwright';
import { isHostAllowed, loadAllowedHosts } from './security.js';

export interface InspectDomInput {
  url: string;
  selector: string;
}

export interface InspectDomResult {
  selector: string;
  rect: { x: number; y: number; width: number; height: number };
  styles: { fontSize: string; color: string };
}

export async function inspectDom(input: InspectDomInput): Promise<InspectDomResult> {
  const { url, selector } = input;

  if (!isHostAllowed(url, loadAllowedHosts())) {
    throw new Error(
      `inspect_dom: host not allowed for "${url}". Allowed by default: localhost, 127.0.0.1. Add other hosts under "allowedHosts:" in .frontend-agent/config.yml.`
    );
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    const element = page.locator(selector).first();
    const box = await element.boundingBox();
    if (!box) {
      throw new Error(`inspect_dom: no element matched selector "${selector}"`);
    }
    const styles = await element.evaluate((el) => {
      const computed = getComputedStyle(el);
      return { fontSize: computed.fontSize, color: computed.color };
    });
    return {
      selector,
      rect: { x: box.x, y: box.y, width: box.width, height: box.height },
      styles
    };
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace=packages/mcp-server`
Expected: 13 tests passing (10 from Tasks 1-3 + 3 from this task).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=packages/mcp-server`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp-server/src/dom.ts packages/mcp-server/tests/dom.test.ts
git commit -m "Add inspect_dom tool logic with host allowlist guard"
```

---

### Task 5: Register both tools on the MCP server and document usage

**Files:**
- Modify: `packages/mcp-server/src/index.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `createServer()` from Task 1 (extends it in place); `captureScreenshot` from Task 3; `inspectDom` from Task 4.
- Produces: the final v0.2 `createServer()`, which now exposes `capture_screenshot` and `inspect_dom` as MCP tools — this is the deliverable the whole plan builds toward.

- [ ] **Step 1: Replace `packages/mcp-server/src/index.ts` with the full server, registering both tools**

Replace the entire file content with:
```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { captureScreenshot } from './screenshot.js';
import { inspectDom } from './dom.js';

export function createServer(): McpServer {
  const server = new McpServer({ name: 'frontend-agent', version: '0.1.0' });

  server.registerTool(
    'capture_screenshot',
    {
      title: 'Capture Screenshot',
      description:
        'Capture a screenshot of a local or explicitly allowed web page at a given viewport size.',
      inputSchema: {
        url: z.string().url(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        outputPath: z.string()
      }
    },
    async ({ url, width, height, outputPath }) => {
      const result = await captureScreenshot({ url, width, height, outputPath });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.registerTool(
    'inspect_dom',
    {
      title: 'Inspect DOM',
      description:
        'Return the bounding box and key computed styles for the first element matching a CSS selector, on a local or explicitly allowed page.',
      inputSchema: {
        url: z.string().url(),
        selector: z.string()
      }
    },
    async ({ url, selector }) => {
      const result = await inspectDom({ url, selector });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('frontend-agent MCP server running on stdio');
}

main().catch((error) => {
  console.error('frontend-agent MCP server failed to start:', error);
  process.exit(1);
});
```

If `registerTool`'s config shape differs in the installed SDK version (check `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` if this fails to typecheck), adjust to match its actual signature and note the discrepancy in your report — the intent (two tools, each with a Zod input schema and an async handler calling the existing `captureScreenshot`/`inspectDom` functions) is what must be preserved.

- [ ] **Step 2: Run the existing smoke test to confirm the server still boots cleanly with both tools registered**

Run: `npm test --workspace=packages/mcp-server`
Expected: all 13 tests still passing — the Task 1 smoke test (`index.test.ts`) re-validates that `createServer()` + `connect()` don't throw now that two tools are registered, and that stdout/stderr discipline is unchanged.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace=packages/mcp-server`
Expected: no errors.

- [ ] **Step 4: Update `README.md` — refine the intro's "not yet included" line**

Find:
```markdown
Not yet included: the kit's own MCP server (screenshots, visual diff, accessibility audit — v0.2/v0.3) and the CLI installer (v0.4). See `docs/superpowers/specs/2026-09-23-frontend-agent-kit-design.md` for the full roadmap.
```

Replace with:
```markdown
The kit's own MCP server now ships two tools (`capture_screenshot`, `inspect_dom` — v0.2). Not yet included: visual diff, responsive suite and accessibility audit tooling (v0.3), and the CLI installer (v0.4). See `docs/superpowers/specs/2026-09-23-frontend-agent-kit-design.md` for the full roadmap.
```

- [ ] **Step 5: Update `README.md` — insert a new "Register the kit's own MCP server" section**

Find:
```markdown
After adding, authenticate when prompted and confirm the server is connected (`/mcp` in Claude Code, `codex mcp list` in Codex).

## Validate the kit's own skills
```

Replace with:
```markdown
After adding, authenticate when prompted and confirm the server is connected (`/mcp` in Claude Code, `codex mcp list` in Codex).

## Register the kit's own MCP server (v0.2)

The kit ships its own MCP server (`packages/mcp-server`) with two tools: `capture_screenshot` and `inspect_dom`. Install its dependencies once from the repo root:

```bash
npm install
npx --workspace=packages/mcp-server playwright install chromium
```

Then register it the same way as the Figma MCP:

Claude Code:

```bash
claude mcp add frontend-agent -- npx tsx packages/mcp-server/src/index.ts
```

Codex CLI:

```bash
codex mcp add frontend-agent -- npx tsx packages/mcp-server/src/index.ts
```

Confirm the tools appear (`/mcp` in Claude Code, `codex mcp list` in Codex).

Both tools only reach `localhost`/`127.0.0.1` by default. To allow another host (e.g. a staging server), add it under `.frontend-agent/config.yml` in the target project:

```yaml
allowedHosts:
  - staging.example.com
```

### Testing the MCP server without a model

```bash
npm run mcp:inspect
```

This opens the MCP Inspector against the server so you can call `capture_screenshot`/`inspect_dom` directly and see their raw output before wiring a model into the loop.

## Validate the kit's own skills
```

- [ ] **Step 6: Commit**

```bash
git add packages/mcp-server/src/index.ts README.md
git commit -m "Register capture_screenshot and inspect_dom on the MCP server; document v0.2 setup"
```

---

## Self-review notes

- **Spec coverage:** §10 v0.2 roadmap line ("MCP próprio: Playwright, capture-screenshot, inspect-dom") → Tasks 1, 3, 4, 5. §5 (stack: Playwright, stdio registration) → Task 1, 5. §9 (security: host allowlist before any URL fetch, Zod schemas, no shell-exec tool) → Task 2 (allowlist), Tasks 3-4 (enforce it), Task 5 (Zod schemas on both registered tools). §11 (out of scope: compare-screenshots, run-responsive-suite, run-accessibility-audit, CLI installer) → intentionally no tasks for any of these.
- **Placeholder scan:** no TBD/TODO; every step has literal file content, exact commands, and expected output/test counts.
- **Type/name consistency:** `captureScreenshot`'s input/output shape in Task 3 matches exactly what Task 5's `capture_screenshot` handler destructures and returns. `inspectDom`'s shape in Task 4 matches Task 5's `inspect_dom` handler. `isHostAllowed`/`loadAllowedHosts` from Task 2 are imported identically (same names, same `./security.js` extension-mapped-from-`.ts` NodeNext convention) in both Task 3 and Task 4. `startFixtureServer`/`FIXTURE_HTML` from Task 3 are imported identically in Task 4. Running test counts (1 → 8 → 10 → 13 → 13) are cumulative and consistent across tasks.

# Frontend Agent Kit v0.3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v0.3 slice of the Frontend Agent Kit's MCP server: `compare_screenshots` (pixel + geometry diff with a composite, profile-driven verdict), `run_responsive_suite`, `run_accessibility_audit`, and the `pixel-perfect` / `standard` / `relaxed` validation profiles read from `.frontend-agent/config.yml`.

**Architecture:** Two shared modules are extracted first so every tool obeys the same guard-rails: `paths.ts` (every file path a tool reads or writes must resolve inside the project root) and `browser.ts` (allowlist check → launch → navigate → redirect re-check, one place). A `config.ts` module replaces the hand-rolled YAML scanner with the `yaml` package plus a Zod schema and owns profiles and breakpoints. Each new tool is a small module with pure, unit-testable decision logic separated from its Playwright I/O. `index.ts` stays a thin registration layer.

**Tech Stack:** TypeScript (ESM, NodeNext), `@modelcontextprotocol/sdk`, Playwright (Chromium), Zod, `yaml`, `pixelmatch` + `pngjs`, `@axe-core/playwright`, Node's built-in test runner via `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-23-frontend-agent-kit-design.md` (§5 MCP próprio, §7 Validação — perfis e DoD, §9 Segurança, §10 v0.3 roadmap line)

## Global Constraints

- Node.js, TypeScript, ESM throughout `packages/mcp-server`; imports between `src/` files use the `.js` extension; tests import `src/` files with the `.ts` extension (as v0.2 does).
- MCP stdio rule: stdout is reserved for JSON-RPC framing. All logging goes to stderr (`console.error`) — never `console.log`.
- Every tool that loads a URL validates the hostname against the allowlist (default `localhost`, `127.0.0.1`, `[::1]`, extendable via `.frontend-agent/config.yml` `allowedHosts:`) **before** launching a browser, and re-checks the final URL and every redirect hop after navigation, before returning data or writing files (spec §9 — anti-SSRF).
- Every file path a tool reads or writes resolves against the project root (`FRONTEND_AGENT_PROJECT_ROOT`, else `process.cwd()`) and is rejected if it resolves outside it (spec §9: "Validação de paths; sem escrita fora do workspace configurado").
- All MCP tool input schemas use Zod (spec §9). No tool executes shell commands (spec §9).
- Spec §7 convergence rule: pixel similarity is never the sole approval criterion. A verdict with no geometry check must not report `pass`.
- Validation profile defaults are copied verbatim from spec §7:
  - `pixel-perfect`: geometryTolerancePx 0, spacingTolerancePx 0, fontSizeTolerancePx 0, maxCriticalA11yIssues 0, requireResponsivePass true, pixelSimilarityTarget `informational`
  - `standard` (default): 3, 2, 1, 0, true, 0.95
  - `relaxed`: 8, 6, 2, 0, true, 0.90
- Default breakpoints (spec §7): desktop 1440×900, laptop 1280×800, tablet 768×1024, mobile 390×844.
- Out of scope (spec §10): CLI installer / HostAdapter (v0.4), eval suite (v0.5). The spec's §5 mentions `sharp` and `get-computed-styles`; neither is needed for v0.3's tools (YAGNI) — `inspect_dom` already returns computed styles, and pngjs covers PNG I/O.

## Controller rulings baked into this plan

- **Config parsing:** `yaml` package + Zod replaces the v0.2 line scanner. `parseAllowedHosts`/`loadAllowedHosts` keep their signatures and existing tests (they now delegate to `config.ts`). A malformed or schema-invalid config throws a clear error naming the file (a silent fallback would hide a mistyped profile).
- **Breakpoint override:** a project's `breakpoints:` map **replaces** the default set entirely (so a project can drop `laptop`). Format: `name: WIDTHxHEIGHT`, names match `^[A-Za-z0-9_-]+$` (they become file names).
- **Profile override:** `profiles.<name>.<field>` in config overrides individual fields of that default profile; unspecified fields keep spec defaults.
- **"Critical" a11y issue:** an axe-core violation with `impact === "critical"`. `serious` and lower are reported in counts but do not gate the verdict.
- **Geometry viewport:** `compare_screenshots` measures elements at `viewport` if given, else at the baseline PNG's dimensions (baseline is expected to be a 1× export of the Figma frame).
- **Verdict values:** `pass` | `fail` | `incomplete`. `incomplete` = no failures, but no geometry was checked (spec §7 rule above).

## Review Focus

1. A config.yml with bad YAML, an unknown `validationProfile`, or a partial profile override → clear error naming the file for the first two; the override merges with defaults for the third. (Task 2 tests.)
2. Baseline and actual PNGs of different sizes → no crash; result reports both sizes, `similarity: null`, and the verdict fails under a numeric `pixelSimilarityTarget`. (Tasks 3 and 4 tests.)
3. `baselinePath`, `actualPath`, `diffOutputPath` or `outputDir` pointing outside the project root → rejected before anything is read, written, or launched. (Tasks 4 and 6 tests.)
4. An `elements` entry whose selector matches nothing → reported in `missingSelectors`, verdict `fail`, no crash. (Task 4 test.)
5. A page that fits on desktop but overflows on mobile → per-breakpoint result shows overflow only where it happens, with offending elements named. (Task 6 test.)

---

### Task 1: Extract shared path and browser guard-rails

**Files:**
- Create: `packages/mcp-server/src/paths.ts`
- Create: `packages/mcp-server/src/browser.ts`
- Create: `packages/mcp-server/tests/paths.test.ts`
- Modify: `packages/mcp-server/src/screenshot.ts` (full replacement below)
- Modify: `packages/mcp-server/src/dom.ts` (full replacement below)

**Interfaces:**
- Consumes: `getProjectRoot()` from `./project.js`; `isHostAllowed`, `loadAllowedHosts`, `assertNavigationAllowed` from `./security.js` (v0.2).
- Produces: `resolveProjectPath(inputPath: string, options: { toolName: string; label: string; extension?: string }): string` in `src/paths.ts`.
- Produces: `interface Viewport { width: number; height: number }`, `type OpenAllowedPage = (viewport?: Viewport) => Promise<Page>`, and `withAllowedPages<T>(toolName: string, url: string, fn: (open: OpenAllowedPage) => Promise<T>): Promise<T>` in `src/browser.ts`.

- [ ] **Step 1: Write the failing test for `resolveProjectPath`**

`packages/mcp-server/tests/paths.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProjectPath } from '../src/paths.ts';

function withProjectRoot<T>(root: string, fn: () => T): T {
  const previous = process.env.FRONTEND_AGENT_PROJECT_ROOT;
  process.env.FRONTEND_AGENT_PROJECT_ROOT = root;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.FRONTEND_AGENT_PROJECT_ROOT;
    else process.env.FRONTEND_AGENT_PROJECT_ROOT = previous;
  }
}

test('resolveProjectPath resolves a relative path to an absolute path inside the project root', () => {
  const root = mkdtempSync(join(tmpdir(), 'frontend-agent-paths-'));
  try {
    withProjectRoot(root, () => {
      assert.equal(
        resolveProjectPath('shots/a.png', { toolName: 't', label: 'outputPath', extension: '.png' }),
        join(root, 'shots', 'a.png')
      );
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveProjectPath rejects ../ escapes, absolute paths outside the root, and sibling-prefix directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'frontend-agent-paths-'));
  try {
    withProjectRoot(root, () => {
      for (const bad of ['../escape.png', '/etc/evil.png', `${root}-evil/a.png`]) {
        assert.throws(
          () => resolveProjectPath(bad, { toolName: 'compare_screenshots', label: 'baselinePath' }),
          /compare_screenshots: baselinePath ".*" resolves outside the project root/
        );
      }
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveProjectPath accepts a file whose name merely starts with two dots', () => {
  const root = mkdtempSync(join(tmpdir(), 'frontend-agent-paths-'));
  try {
    withProjectRoot(root, () => {
      assert.equal(resolveProjectPath('..hidden.png', { toolName: 't', label: 'p' }), join(root, '..hidden.png'));
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveProjectPath enforces the extension case-insensitively when one is given', () => {
  const root = mkdtempSync(join(tmpdir(), 'frontend-agent-paths-'));
  try {
    withProjectRoot(root, () => {
      assert.equal(resolveProjectPath('a.PNG', { toolName: 't', label: 'p', extension: '.png' }), join(root, 'a.PNG'));
      assert.throws(
        () => resolveProjectPath('a.jpg', { toolName: 't', label: 'outputPath', extension: '.png' }),
        /t: outputPath "a.jpg" must have a \.png extension/
      );
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=packages/mcp-server`
Expected: FAIL — `Cannot find module '../src/paths.ts'`.

- [ ] **Step 3: Implement `src/paths.ts`**

```ts
import path from 'node:path';
import { getProjectRoot } from './project.js';

export interface ResolveProjectPathOptions {
  toolName: string;
  label: string;
  extension?: string;
}

/**
 * Resolve a tool-supplied path against the project root and reject anything
 * that lands outside it (spec §9). Returns the absolute path.
 */
export function resolveProjectPath(inputPath: string, options: ResolveProjectPathOptions): string {
  const { toolName, label, extension } = options;
  const projectRoot = getProjectRoot();
  const resolved = path.resolve(projectRoot, inputPath);
  const relative = path.relative(projectRoot, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${toolName}: ${label} "${inputPath}" resolves outside the project root "${projectRoot}".`);
  }
  if (extension && path.extname(resolved).toLowerCase() !== extension) {
    throw new Error(`${toolName}: ${label} "${inputPath}" must have a ${extension} extension.`);
  }
  return resolved;
}
```

- [ ] **Step 4: Implement `src/browser.ts`**

```ts
import { chromium, type Page } from 'playwright';
import { assertNavigationAllowed, isHostAllowed, loadAllowedHosts } from './security.js';

export interface Viewport {
  width: number;
  height: number;
}

export type OpenAllowedPage = (viewport?: Viewport) => Promise<Page>;

/**
 * Check the URL against the allowlist before any browser starts, then launch
 * one headless Chromium and hand `fn` an `open` function. Each `open` call
 * creates a page, navigates to `url`, and re-checks the final URL and redirect
 * chain before returning the page. The browser is always closed.
 */
export async function withAllowedPages<T>(
  toolName: string,
  url: string,
  fn: (open: OpenAllowedPage) => Promise<T>
): Promise<T> {
  const allowedHosts = loadAllowedHosts();
  if (!isHostAllowed(url, allowedHosts)) {
    throw new Error(
      `${toolName}: host not allowed for "${url}". Allowed by default: localhost, 127.0.0.1, [::1]. Add other hosts under "allowedHosts:" in .frontend-agent/config.yml.`
    );
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const open: OpenAllowedPage = async (viewport) => {
      const page = await browser.newPage(viewport ? { viewport } : {});
      const response = await page.goto(url, { waitUntil: 'networkidle' });
      assertNavigationAllowed(page, response, allowedHosts, toolName);
      return page;
    };
    return await fn(open);
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 5: Refactor `src/screenshot.ts` onto the shared helpers**

Replace the whole file with:
```ts
import { resolveProjectPath } from './paths.js';
import { withAllowedPages } from './browser.js';

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
  const resolvedOutputPath = resolveProjectPath(outputPath, {
    toolName: 'capture_screenshot',
    label: 'outputPath',
    extension: '.png'
  });

  return withAllowedPages('capture_screenshot', url, async (open) => {
    const page = await open({ width, height });
    await page.screenshot({ path: resolvedOutputPath, fullPage: true });
    return { outputPath: resolvedOutputPath, width, height };
  });
}
```

- [ ] **Step 6: Refactor `src/dom.ts` onto the shared helper**

Replace the whole file with:
```ts
import { withAllowedPages } from './browser.js';

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

  return withAllowedPages('inspect_dom', url, async (open) => {
    const page = await open();
    const element = page.locator(selector).first();

    if ((await element.count()) === 0) {
      throw new Error(`inspect_dom: no element matched selector "${selector}"`);
    }

    const box = await element.boundingBox();
    if (!box) {
      throw new Error(`inspect_dom: element matched selector "${selector}" but is not rendered (no bounding box)`);
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
  });
}
```

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm test --workspace=packages/mcp-server && npm run typecheck --workspace=packages/mcp-server`
Expected: 27 tests passing (23 existing + 4 new), no type errors. The existing screenshot/dom tests must pass unchanged — they pin the v0.2 behavior this refactor must preserve.

- [ ] **Step 8: Commit**

```bash
git add packages/mcp-server/src/paths.ts packages/mcp-server/src/browser.ts packages/mcp-server/src/screenshot.ts packages/mcp-server/src/dom.ts packages/mcp-server/tests/paths.test.ts
git commit -m "Extract shared project-path and allowed-page guard-rails for mcp-server tools"
```

---

### Task 2: Project config — validation profiles and breakpoints

**Files:**
- Modify: `packages/mcp-server/package.json` (add `yaml` dependency via npm)
- Create: `packages/mcp-server/src/config.ts`
- Create: `packages/mcp-server/tests/config.test.ts`
- Modify: `packages/mcp-server/src/security.ts` (replace `parseAllowedHosts` and `loadAllowedHosts` bodies; keep signatures)

**Interfaces:**
- Consumes: `getProjectRoot()` from `./project.js`.
- Produces (all from `src/config.ts`):
  - `type ValidationProfileName = 'pixel-perfect' | 'standard' | 'relaxed'`
  - `interface ValidationProfile { geometryTolerancePx: number; spacingTolerancePx: number; fontSizeTolerancePx: number; maxCriticalA11yIssues: number; requireResponsivePass: boolean; pixelSimilarityTarget: number | 'informational' }`
  - `interface Breakpoint { name: string; width: number; height: number }`
  - `interface ProjectConfig { allowedHosts: string[]; validationProfile: ValidationProfileName; profile: ValidationProfile; breakpoints: Breakpoint[] }`
  - `DEFAULT_PROFILES: Record<ValidationProfileName, ValidationProfile>`, `DEFAULT_BREAKPOINTS: Breakpoint[]`
  - `parseProjectConfig(yamlText: string, sourceLabel?: string): ProjectConfig`
  - `loadProjectConfig(configPath?: string): ProjectConfig`
  - `BREAKPOINT_NAME_PATTERN: RegExp` (`/^[A-Za-z0-9_-]+$/`)

- [ ] **Step 1: Add the dependency**

Run from the worktree root: `npm install yaml@^2.9.0 --workspace=packages/mcp-server`
Expected: `packages/mcp-server/package.json` gains `"yaml": "^2.9.0"` under `dependencies`; root `package-lock.json` updates.

- [ ] **Step 2: Write the failing tests**

`packages/mcp-server/tests/config.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseProjectConfig,
  loadProjectConfig,
  DEFAULT_PROFILES,
  DEFAULT_BREAKPOINTS
} from '../src/config.ts';

test('an empty config yields the standard profile, spec default breakpoints and no extra hosts', () => {
  const config = parseProjectConfig('');
  assert.equal(config.validationProfile, 'standard');
  assert.deepEqual(config.profile, DEFAULT_PROFILES.standard);
  assert.deepEqual(config.breakpoints, DEFAULT_BREAKPOINTS);
  assert.deepEqual(config.allowedHosts, []);
});

test('spec §7 profile defaults are exact', () => {
  assert.deepEqual(DEFAULT_PROFILES['pixel-perfect'], {
    geometryTolerancePx: 0, spacingTolerancePx: 0, fontSizeTolerancePx: 0,
    maxCriticalA11yIssues: 0, requireResponsivePass: true, pixelSimilarityTarget: 'informational'
  });
  assert.deepEqual(DEFAULT_PROFILES.standard, {
    geometryTolerancePx: 3, spacingTolerancePx: 2, fontSizeTolerancePx: 1,
    maxCriticalA11yIssues: 0, requireResponsivePass: true, pixelSimilarityTarget: 0.95
  });
  assert.deepEqual(DEFAULT_PROFILES.relaxed, {
    geometryTolerancePx: 8, spacingTolerancePx: 6, fontSizeTolerancePx: 2,
    maxCriticalA11yIssues: 0, requireResponsivePass: true, pixelSimilarityTarget: 0.9
  });
  assert.deepEqual(DEFAULT_BREAKPOINTS, [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'laptop', width: 1280, height: 800 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 }
  ]);
});

test('validationProfile selects a profile and a partial override merges with its defaults', () => {
  const config = parseProjectConfig(
    'validationProfile: pixel-perfect\nprofiles:\n  pixel-perfect:\n    geometryTolerancePx: 1\n'
  );
  assert.equal(config.validationProfile, 'pixel-perfect');
  assert.deepEqual(config.profile, { ...DEFAULT_PROFILES['pixel-perfect'], geometryTolerancePx: 1 });
});

test('a breakpoints map replaces the default set, in file order', () => {
  const config = parseProjectConfig('breakpoints:\n  wide: 1920x1080\n  phone: 375x667\n');
  assert.deepEqual(config.breakpoints, [
    { name: 'wide', width: 1920, height: 1080 },
    { name: 'phone', width: 375, height: 667 }
  ]);
});

test('allowedHosts are trimmed and lowercased, and an empty allowedHosts key is treated as absent', () => {
  assert.deepEqual(parseProjectConfig('allowedHosts:\n  - " Staging.Example.com "\n').allowedHosts, ['staging.example.com']);
  assert.deepEqual(parseProjectConfig('allowedHosts:\n').allowedHosts, []);
});

test('invalid YAML, unknown profile names and malformed breakpoints throw an error naming the source', () => {
  assert.throws(() => parseProjectConfig('allowedHosts: [unclosed\n', 'cfg.yml'), /cfg\.yml/);
  assert.throws(() => parseProjectConfig('validationProfile: ultra\n', 'cfg.yml'), /cfg\.yml.*validationProfile/s);
  assert.throws(() => parseProjectConfig('breakpoints:\n  desktop: big\n', 'cfg.yml'), /cfg\.yml.*breakpoints/s);
  assert.throws(() => parseProjectConfig('breakpoints:\n  "../x": 10x10\n', 'cfg.yml'), /cfg\.yml.*breakpoints/s);
  assert.throws(() => parseProjectConfig('profiles:\n  standard:\n    pixelSimilarityTarget: 2\n', 'cfg.yml'), /cfg\.yml.*pixelSimilarityTarget/s);
});

test('loadProjectConfig reads <projectRoot>/.frontend-agent/config.yml and falls back to defaults when absent', () => {
  const root = mkdtempSync(join(tmpdir(), 'frontend-agent-config-'));
  const previous = process.env.FRONTEND_AGENT_PROJECT_ROOT;
  process.env.FRONTEND_AGENT_PROJECT_ROOT = root;
  try {
    assert.equal(loadProjectConfig().validationProfile, 'standard');
    mkdirSync(join(root, '.frontend-agent'));
    writeFileSync(join(root, '.frontend-agent', 'config.yml'), 'validationProfile: relaxed\n');
    assert.equal(loadProjectConfig().validationProfile, 'relaxed');
  } finally {
    if (previous === undefined) delete process.env.FRONTEND_AGENT_PROJECT_ROOT;
    else process.env.FRONTEND_AGENT_PROJECT_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test --workspace=packages/mcp-server`
Expected: FAIL — `Cannot find module '../src/config.ts'`.

- [ ] **Step 4: Implement `src/config.ts`**

```ts
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { getProjectRoot } from './project.js';

export type ValidationProfileName = 'pixel-perfect' | 'standard' | 'relaxed';

export interface ValidationProfile {
  geometryTolerancePx: number;
  spacingTolerancePx: number;
  fontSizeTolerancePx: number;
  maxCriticalA11yIssues: number;
  requireResponsivePass: boolean;
  pixelSimilarityTarget: number | 'informational';
}

export interface Breakpoint {
  name: string;
  width: number;
  height: number;
}

export interface ProjectConfig {
  allowedHosts: string[];
  validationProfile: ValidationProfileName;
  profile: ValidationProfile;
  breakpoints: Breakpoint[];
}

// Spec §7, verbatim.
export const DEFAULT_PROFILES: Record<ValidationProfileName, ValidationProfile> = {
  'pixel-perfect': {
    geometryTolerancePx: 0,
    spacingTolerancePx: 0,
    fontSizeTolerancePx: 0,
    maxCriticalA11yIssues: 0,
    requireResponsivePass: true,
    pixelSimilarityTarget: 'informational'
  },
  standard: {
    geometryTolerancePx: 3,
    spacingTolerancePx: 2,
    fontSizeTolerancePx: 1,
    maxCriticalA11yIssues: 0,
    requireResponsivePass: true,
    pixelSimilarityTarget: 0.95
  },
  relaxed: {
    geometryTolerancePx: 8,
    spacingTolerancePx: 6,
    fontSizeTolerancePx: 2,
    maxCriticalA11yIssues: 0,
    requireResponsivePass: true,
    pixelSimilarityTarget: 0.9
  }
};

export const DEFAULT_BREAKPOINTS: Breakpoint[] = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 }
];

export const BREAKPOINT_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

const profileOverrideSchema = z
  .object({
    geometryTolerancePx: z.number().nonnegative(),
    spacingTolerancePx: z.number().nonnegative(),
    fontSizeTolerancePx: z.number().nonnegative(),
    maxCriticalA11yIssues: z.number().int().nonnegative(),
    requireResponsivePass: z.boolean(),
    pixelSimilarityTarget: z.union([z.number().min(0).max(1), z.literal('informational')])
  })
  .partial()
  .strict();

const configSchema = z
  .object({
    validationProfile: z.enum(['pixel-perfect', 'standard', 'relaxed']).nullish(),
    allowedHosts: z.array(z.string()).nullish(),
    breakpoints: z
      .record(z.string().regex(BREAKPOINT_NAME_PATTERN), z.string().regex(/^\d+x\d+$/))
      .nullish(),
    profiles: z
      .object({
        'pixel-perfect': profileOverrideSchema.nullish(),
        standard: profileOverrideSchema.nullish(),
        relaxed: profileOverrideSchema.nullish()
      })
      .strict()
      .nullish()
  })
  .passthrough();

export function parseProjectConfig(yamlText: string, sourceLabel = '.frontend-agent/config.yml'): ProjectConfig {
  let raw: unknown;
  try {
    raw = parse(yamlText);
  } catch (error) {
    throw new Error(`invalid ${sourceLabel}: ${(error as Error).message}`);
  }

  const parsed = configSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`invalid ${sourceLabel}: ${details}`);
  }
  const data = parsed.data;

  const validationProfile: ValidationProfileName = data.validationProfile ?? 'standard';
  const override = data.profiles?.[validationProfile] ?? {};
  const profile: ValidationProfile = { ...DEFAULT_PROFILES[validationProfile], ...override };

  const breakpoints: Breakpoint[] = data.breakpoints
    ? Object.entries(data.breakpoints).map(([name, size]) => {
        const [width, height] = size.split('x').map(Number);
        return { name, width, height };
      })
    : DEFAULT_BREAKPOINTS.map((breakpoint) => ({ ...breakpoint }));

  const allowedHosts = (data.allowedHosts ?? []).map((host) => host.trim().toLowerCase());

  return { allowedHosts, validationProfile, profile, breakpoints };
}

export function loadProjectConfig(configPath?: string): ProjectConfig {
  const resolvedPath = configPath ?? path.join(getProjectRoot(), '.frontend-agent', 'config.yml');
  if (!existsSync(resolvedPath)) return parseProjectConfig('');
  return parseProjectConfig(readFileSync(resolvedPath, 'utf8'), resolvedPath);
}
```

- [ ] **Step 5: Delegate `security.ts`'s config reading to `config.ts`**

In `packages/mcp-server/src/security.ts`:
- Replace the import lines `import { existsSync, readFileSync } from 'node:fs';`, `import path from 'node:path';` and `import { getProjectRoot } from './project.js';` with `import { loadProjectConfig, parseProjectConfig } from './config.js';`
- Replace the bodies of `parseAllowedHosts` and `loadAllowedHosts` so the two functions read exactly:

```ts
export function parseAllowedHosts(configYaml: string): string[] {
  return parseProjectConfig(configYaml).allowedHosts;
}

export function loadAllowedHosts(configPath?: string): string[] {
  return loadProjectConfig(configPath).allowedHosts;
}
```
Leave `DEFAULT_ALLOWED_HOSTS`, `isHostAllowed` and `assertNavigationAllowed` untouched.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test --workspace=packages/mcp-server && npm run typecheck --workspace=packages/mcp-server`
Expected: 34 tests passing (27 + 7 new), no type errors. The four existing `parseAllowedHosts` tests in `tests/security.test.ts` must pass unchanged (the `yaml` package handles quotes, comments and padding).

- [ ] **Step 7: Commit**

```bash
git add packages/mcp-server/package.json package-lock.json packages/mcp-server/src/config.ts packages/mcp-server/src/security.ts packages/mcp-server/tests/config.test.ts
git commit -m "Add project config with validation profiles and breakpoints (spec §7)"
```

---

### Task 3: Pixel diff module

**Files:**
- Modify: `packages/mcp-server/package.json` (add `pixelmatch`, `pngjs`, `@types/pngjs` via npm)
- Create: `packages/mcp-server/src/pixel-diff.ts`
- Create: `packages/mcp-server/tests/fixtures/png.ts`
- Create: `packages/mcp-server/tests/pixel-diff.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (paths arrive already resolved).
- Produces: `interface ImageSize { width: number; height: number }`, `interface PixelDiffResult { dimensionsMatch: boolean; baselineSize: ImageSize; actualSize: ImageSize; diffPixels: number | null; totalPixels: number | null; similarity: number | null; diffOutputPath: string | null }`, `readPng(filePath: string, toolName: string): PNG`, and `diffPngFiles(baselinePath: string, actualPath: string, diffOutputPath: string | null, toolName: string): PixelDiffResult` in `src/pixel-diff.ts`.
- Produces (test helper, reused by Task 4): `writeSolidPng(filePath: string, width: number, height: number, rgb: [number, number, number], paint?: Array<{ x: number; y: number; rgb: [number, number, number] }>): void` in `tests/fixtures/png.ts`.

- [ ] **Step 1: Add the dependencies**

Run from the worktree root:
`npm install pixelmatch@^7.2.0 pngjs@^7.0.0 --workspace=packages/mcp-server && npm install -D @types/pngjs@^6.0.5 --workspace=packages/mcp-server`
Expected: both runtime deps under `dependencies`, `@types/pngjs` under `devDependencies`. (`pixelmatch` 7 ships its own `index.d.ts`.)

- [ ] **Step 2: Write the PNG test fixture helper**

`packages/mcp-server/tests/fixtures/png.ts`:
```ts
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

export function writeSolidPng(
  filePath: string,
  width: number,
  height: number,
  rgb: [number, number, number],
  paint: Array<{ x: number; y: number; rgb: [number, number, number] }> = []
): void {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = rgb[0];
    png.data[i * 4 + 1] = rgb[1];
    png.data[i * 4 + 2] = rgb[2];
    png.data[i * 4 + 3] = 255;
  }
  for (const pixel of paint) {
    const i = (pixel.y * width + pixel.x) * 4;
    png.data[i] = pixel.rgb[0];
    png.data[i + 1] = pixel.rgb[1];
    png.data[i + 2] = pixel.rgb[2];
  }
  writeFileSync(filePath, PNG.sync.write(png));
}
```

- [ ] **Step 3: Write the failing tests**

`packages/mcp-server/tests/pixel-diff.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffPngFiles } from '../src/pixel-diff.ts';
import { writeSolidPng } from './fixtures/png.ts';

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'frontend-agent-pixel-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('identical images have similarity 1 and zero diff pixels', () => {
  withTempDir((dir) => {
    writeSolidPng(join(dir, 'a.png'), 10, 10, WHITE);
    writeSolidPng(join(dir, 'b.png'), 10, 10, WHITE);
    const result = diffPngFiles(join(dir, 'a.png'), join(dir, 'b.png'), null, 'compare_screenshots');
    assert.equal(result.dimensionsMatch, true);
    assert.equal(result.diffPixels, 0);
    assert.equal(result.totalPixels, 100);
    assert.equal(result.similarity, 1);
    assert.equal(result.diffOutputPath, null);
  });
});

test('ten changed pixels out of 100 give similarity 0.9 and a written diff image', () => {
  withTempDir((dir) => {
    const paint = Array.from({ length: 10 }, (_, x) => ({ x, y: 0, rgb: BLACK }));
    writeSolidPng(join(dir, 'a.png'), 10, 10, WHITE);
    writeSolidPng(join(dir, 'b.png'), 10, 10, WHITE, paint);
    const diffPath = join(dir, 'diff.png');
    const result = diffPngFiles(join(dir, 'a.png'), join(dir, 'b.png'), diffPath, 'compare_screenshots');
    assert.equal(result.diffPixels, 10);
    assert.equal(result.similarity, 0.9);
    assert.equal(result.diffOutputPath, diffPath);
    assert.ok(existsSync(diffPath));
  });
});

test('different dimensions are reported without comparing pixels or writing a diff', () => {
  withTempDir((dir) => {
    writeSolidPng(join(dir, 'a.png'), 10, 10, WHITE);
    writeSolidPng(join(dir, 'b.png'), 12, 10, WHITE);
    const diffPath = join(dir, 'diff.png');
    const result = diffPngFiles(join(dir, 'a.png'), join(dir, 'b.png'), diffPath, 'compare_screenshots');
    assert.equal(result.dimensionsMatch, false);
    assert.deepEqual(result.baselineSize, { width: 10, height: 10 });
    assert.deepEqual(result.actualSize, { width: 12, height: 10 });
    assert.equal(result.similarity, null);
    assert.equal(result.diffPixels, null);
    assert.equal(result.diffOutputPath, null);
    assert.equal(existsSync(diffPath), false);
  });
});

test('a missing or non-PNG file throws a clear error naming the file', () => {
  withTempDir((dir) => {
    writeSolidPng(join(dir, 'a.png'), 10, 10, WHITE);
    writeFileSync(join(dir, 'not.png'), 'hello');
    assert.throws(
      () => diffPngFiles(join(dir, 'a.png'), join(dir, 'missing.png'), null, 'compare_screenshots'),
      /compare_screenshots: could not read PNG ".*missing\.png"/
    );
    assert.throws(
      () => diffPngFiles(join(dir, 'a.png'), join(dir, 'not.png'), null, 'compare_screenshots'),
      /compare_screenshots: could not read PNG ".*not\.png"/
    );
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test --workspace=packages/mcp-server`
Expected: FAIL — `Cannot find module '../src/pixel-diff.ts'`.

- [ ] **Step 5: Implement `src/pixel-diff.ts`**

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export interface ImageSize {
  width: number;
  height: number;
}

export interface PixelDiffResult {
  dimensionsMatch: boolean;
  baselineSize: ImageSize;
  actualSize: ImageSize;
  diffPixels: number | null;
  totalPixels: number | null;
  similarity: number | null;
  diffOutputPath: string | null;
}

export function readPng(filePath: string, toolName: string): PNG {
  try {
    return PNG.sync.read(readFileSync(filePath));
  } catch (error) {
    throw new Error(`${toolName}: could not read PNG "${filePath}": ${(error as Error).message}`);
  }
}

/**
 * Pixel-compare two PNGs. Images of different sizes are not compared: the
 * result reports both sizes with null diff fields, and no diff image is written.
 */
export function diffPngFiles(
  baselinePath: string,
  actualPath: string,
  diffOutputPath: string | null,
  toolName: string
): PixelDiffResult {
  const baseline = readPng(baselinePath, toolName);
  const actual = readPng(actualPath, toolName);
  const baselineSize = { width: baseline.width, height: baseline.height };
  const actualSize = { width: actual.width, height: actual.height };

  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    return {
      dimensionsMatch: false,
      baselineSize,
      actualSize,
      diffPixels: null,
      totalPixels: null,
      similarity: null,
      diffOutputPath: null
    };
  }

  const { width, height } = baseline;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(baseline.data, actual.data, diff.data, width, height, { threshold: 0.1 });
  const totalPixels = width * height;

  if (diffOutputPath) {
    mkdirSync(path.dirname(diffOutputPath), { recursive: true });
    writeFileSync(diffOutputPath, PNG.sync.write(diff));
  }

  return {
    dimensionsMatch: true,
    baselineSize,
    actualSize,
    diffPixels,
    totalPixels,
    similarity: 1 - diffPixels / totalPixels,
    diffOutputPath: diffOutputPath ?? null
  };
}
```

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test --workspace=packages/mcp-server && npm run typecheck --workspace=packages/mcp-server`
Expected: 38 tests passing (34 + 4 new), no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/mcp-server/package.json package-lock.json packages/mcp-server/src/pixel-diff.ts packages/mcp-server/tests/fixtures/png.ts packages/mcp-server/tests/pixel-diff.test.ts
git commit -m "Add pixel diff module (pixelmatch + pngjs) for compare_screenshots"
```

---

### Task 4: Geometry check and `compareScreenshots` composite verdict

**Files:**
- Create: `packages/mcp-server/src/geometry.ts`
- Create: `packages/mcp-server/src/compare.ts`
- Create: `packages/mcp-server/tests/geometry.test.ts`
- Create: `packages/mcp-server/tests/compare.test.ts`

**Interfaces:**
- Consumes: `resolveProjectPath` (Task 1, `./paths.js`); `withAllowedPages`, `Viewport` (Task 1, `./browser.js`); `loadProjectConfig`, `ValidationProfile`, `ValidationProfileName` (Task 2, `./config.js`); `diffPngFiles`, `PixelDiffResult` (Task 3, `./pixel-diff.js`); test helpers `startFixtureServer`, `FIXTURE_HTML` (`tests/fixtures/server.ts`) and `writeSolidPng` (`tests/fixtures/png.ts`).
- Produces (`src/geometry.ts`):
  - `interface ElementExpectation { selector: string; x?: number; y?: number; width?: number; height?: number; paddingTop?: number; paddingRight?: number; paddingBottom?: number; paddingLeft?: number; gap?: number; fontSize?: number; color?: string }`
  - `interface ElementMeasurement { selector: string; found: boolean; values: Record<string, number | string> }`
  - `interface Deviation { selector: string; property: string; kind: 'geometry' | 'spacing' | 'fontSize' | 'color'; expected: number | string; actual: number | string; delta: number | null; tolerance: number | null; withinTolerance: boolean }`
  - `interface GeometryCheck { checked: boolean; deviations: Deviation[]; missingSelectors: string[] }`
  - `normalizeColor(value: string): string`
  - `evaluateExpectations(expectations: ElementExpectation[], measurements: ElementMeasurement[], profile: ValidationProfile): GeometryCheck`
  - `measureElements(page: Page, selectors: string[]): Promise<ElementMeasurement[]>`
- Produces (`src/compare.ts`):
  - `interface CompareScreenshotsInput { baselinePath: string; actualPath: string; diffOutputPath?: string; url?: string; elements?: ElementExpectation[]; viewport?: Viewport }`
  - `type Verdict = 'pass' | 'fail' | 'incomplete'`
  - `interface CompareScreenshotsResult { validationProfile: ValidationProfileName; profile: ValidationProfile; pixel: PixelDiffResult; geometry: GeometryCheck; verdict: Verdict; failures: string[]; notes: string[] }`
  - `decideVerdict(pixel: PixelDiffResult, geometry: GeometryCheck, profile: ValidationProfile): { verdict: Verdict; failures: string[]; notes: string[] }`
  - `compareScreenshots(input: CompareScreenshotsInput): Promise<CompareScreenshotsResult>` — consumed by Task 7.

- [ ] **Step 1: Write the failing pure-logic tests for geometry**

`packages/mcp-server/tests/geometry.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExpectations, normalizeColor } from '../src/geometry.ts';
import { DEFAULT_PROFILES } from '../src/config.ts';

test('normalizeColor maps hex, rgba with full alpha and spacing variants to one rgb() form', () => {
  assert.equal(normalizeColor('#111827'), 'rgb(17, 24, 39)');
  assert.equal(normalizeColor('#fff'), 'rgb(255, 255, 255)');
  assert.equal(normalizeColor('rgba(17,24,39,1)'), 'rgb(17, 24, 39)');
  assert.equal(normalizeColor(' RGB(17 , 24 , 39) '), 'rgb(17, 24, 39)');
  assert.equal(normalizeColor('rgba(0, 0, 0, 0.5)'), 'rgba(0, 0, 0, 0.5)');
});

test('deviations use the tolerance for their kind from the profile', () => {
  const check = evaluateExpectations(
    [{ selector: 'h1', width: 100, paddingTop: 10, fontSize: 32, color: '#111827' }],
    [{ selector: 'h1', found: true, values: { width: 103, paddingTop: 13, fontSize: 33, color: 'rgb(17, 24, 39)' } }],
    DEFAULT_PROFILES.standard
  );
  assert.equal(check.checked, true);
  assert.deepEqual(check.missingSelectors, []);
  const byProperty = Object.fromEntries(check.deviations.map((d) => [d.property, d]));
  assert.deepEqual(
    { kind: byProperty.width.kind, delta: byProperty.width.delta, tolerance: byProperty.width.tolerance, ok: byProperty.width.withinTolerance },
    { kind: 'geometry', delta: 3, tolerance: 3, ok: true }
  );
  assert.deepEqual(
    { kind: byProperty.paddingTop.kind, delta: byProperty.paddingTop.delta, tolerance: byProperty.paddingTop.tolerance, ok: byProperty.paddingTop.withinTolerance },
    { kind: 'spacing', delta: 3, tolerance: 2, ok: false }
  );
  assert.equal(byProperty.fontSize.withinTolerance, true);
  assert.deepEqual(
    { kind: byProperty.color.kind, tolerance: byProperty.color.tolerance, ok: byProperty.color.withinTolerance },
    { kind: 'color', tolerance: null, ok: true }
  );
});

test('pixel-perfect has zero tolerance', () => {
  const check = evaluateExpectations(
    [{ selector: 'h1', x: 10 }],
    [{ selector: 'h1', found: true, values: { x: 10.5 } }],
    DEFAULT_PROFILES['pixel-perfect']
  );
  assert.equal(check.deviations[0].withinTolerance, false);
});

test('a selector that matched nothing goes to missingSelectors instead of deviations', () => {
  const check = evaluateExpectations(
    [{ selector: '.nope', width: 10 }],
    [{ selector: '.nope', found: false, values: {} }],
    DEFAULT_PROFILES.standard
  );
  assert.deepEqual(check.missingSelectors, ['.nope']);
  assert.deepEqual(check.deviations, []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=packages/mcp-server`
Expected: FAIL — `Cannot find module '../src/geometry.ts'`.

- [ ] **Step 3: Implement `src/geometry.ts`**

```ts
import type { Page } from 'playwright';
import type { ValidationProfile } from './config.js';

export interface ElementExpectation {
  selector: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  gap?: number;
  fontSize?: number;
  color?: string;
}

export interface ElementMeasurement {
  selector: string;
  found: boolean;
  values: Record<string, number | string>;
}

export type DeviationKind = 'geometry' | 'spacing' | 'fontSize' | 'color';

export interface Deviation {
  selector: string;
  property: string;
  kind: DeviationKind;
  expected: number | string;
  actual: number | string;
  delta: number | null;
  tolerance: number | null;
  withinTolerance: boolean;
}

export interface GeometryCheck {
  checked: boolean;
  deviations: Deviation[];
  missingSelectors: string[];
}

const PROPERTY_KINDS: Record<string, DeviationKind> = {
  x: 'geometry',
  y: 'geometry',
  width: 'geometry',
  height: 'geometry',
  paddingTop: 'spacing',
  paddingRight: 'spacing',
  paddingBottom: 'spacing',
  paddingLeft: 'spacing',
  gap: 'spacing',
  fontSize: 'fontSize',
  color: 'color'
};

export function normalizeColor(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const hex = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].split('').map((d) => d + d).join('') : hex[1];
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16));
    return `rgb(${r}, ${g}, ${b})`;
  }
  const fn = trimmed.match(/^rgba?\(([^)]*)\)$/);
  if (fn) {
    const parts = fn[1].split(',').map((part) => part.trim());
    if (parts.length === 4 && Number(parts[3]) === 1) parts.pop();
    return parts.length === 4 ? `rgba(${parts.join(', ')})` : `rgb(${parts.join(', ')})`;
  }
  return trimmed;
}

function toleranceFor(kind: DeviationKind, profile: ValidationProfile): number | null {
  if (kind === 'geometry') return profile.geometryTolerancePx;
  if (kind === 'spacing') return profile.spacingTolerancePx;
  if (kind === 'fontSize') return profile.fontSizeTolerancePx;
  return null;
}

export function evaluateExpectations(
  expectations: ElementExpectation[],
  measurements: ElementMeasurement[],
  profile: ValidationProfile
): GeometryCheck {
  const deviations: Deviation[] = [];
  const missingSelectors: string[] = [];

  expectations.forEach((expectation, index) => {
    const measurement = measurements[index];
    if (!measurement?.found) {
      missingSelectors.push(expectation.selector);
      return;
    }
    for (const [property, kind] of Object.entries(PROPERTY_KINDS)) {
      const expected = expectation[property as keyof ElementExpectation];
      if (expected === undefined) continue;
      const actual = measurement.values[property];
      const tolerance = toleranceFor(kind, profile);
      if (kind === 'color') {
        const withinTolerance = normalizeColor(String(expected)) === normalizeColor(String(actual));
        deviations.push({ selector: expectation.selector, property, kind, expected, actual, delta: null, tolerance, withinTolerance });
      } else {
        const delta = Math.abs(Number(actual) - Number(expected));
        deviations.push({
          selector: expectation.selector,
          property,
          kind,
          expected,
          actual,
          delta,
          tolerance,
          withinTolerance: delta <= (tolerance ?? 0)
        });
      }
    }
  });

  return { checked: true, deviations, missingSelectors };
}

export async function measureElements(page: Page, selectors: string[]): Promise<ElementMeasurement[]> {
  const measurements: ElementMeasurement[] = [];
  for (const selector of selectors) {
    const element = page.locator(selector).first();
    if ((await element.count()) === 0) {
      measurements.push({ selector, found: false, values: {} });
      continue;
    }
    const box = await element.boundingBox();
    if (!box) {
      measurements.push({ selector, found: false, values: {} });
      continue;
    }
    const styles = await element.evaluate((el) => {
      const computed = getComputedStyle(el);
      const px = (value: string) => (value === 'normal' ? 0 : parseFloat(value) || 0);
      return {
        paddingTop: px(computed.paddingTop),
        paddingRight: px(computed.paddingRight),
        paddingBottom: px(computed.paddingBottom),
        paddingLeft: px(computed.paddingLeft),
        gap: px(computed.rowGap),
        fontSize: px(computed.fontSize),
        color: computed.color
      };
    });
    measurements.push({
      selector,
      found: true,
      values: { x: box.x, y: box.y, width: box.width, height: box.height, ...styles }
    });
  }
  return measurements;
}
```

- [ ] **Step 4: Run the geometry tests to verify they pass**

Run: `npm test --workspace=packages/mcp-server`
Expected: 42 tests passing (38 + 4 new).

- [ ] **Step 5: Write the failing tests for `compare.ts`**

`packages/mcp-server/tests/compare.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareScreenshots, decideVerdict } from '../src/compare.ts';
import { DEFAULT_PROFILES } from '../src/config.ts';
import type { PixelDiffResult } from '../src/pixel-diff.ts';
import { startFixtureServer, FIXTURE_HTML } from './fixtures/server.ts';
import { writeSolidPng } from './fixtures/png.ts';

const WHITE: [number, number, number] = [255, 255, 255];

async function withProjectRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'frontend-agent-compare-'));
  const previous = process.env.FRONTEND_AGENT_PROJECT_ROOT;
  process.env.FRONTEND_AGENT_PROJECT_ROOT = root;
  try {
    return await fn(root);
  } finally {
    if (previous === undefined) delete process.env.FRONTEND_AGENT_PROJECT_ROOT;
    else process.env.FRONTEND_AGENT_PROJECT_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

const samePixels: PixelDiffResult = {
  dimensionsMatch: true, baselineSize: { width: 10, height: 10 }, actualSize: { width: 10, height: 10 },
  diffPixels: 0, totalPixels: 100, similarity: 1, diffOutputPath: null
};
const noGeometry = { checked: false, deviations: [], missingSelectors: [] };

test('decideVerdict: perfect pixels without a geometry check is incomplete, never pass (spec §7)', () => {
  const decision = decideVerdict(samePixels, noGeometry, DEFAULT_PROFILES.standard);
  assert.equal(decision.verdict, 'incomplete');
  assert.deepEqual(decision.failures, []);
  assert.ok(decision.notes.some((note) => /geometry/.test(note)));
});

test('decideVerdict: similarity below a numeric target fails; pixel-perfect treats it as informational', () => {
  const low = { ...samePixels, diffPixels: 10, similarity: 0.9 };
  const geometryOk = { checked: true, deviations: [], missingSelectors: [] };
  assert.equal(decideVerdict(low, geometryOk, DEFAULT_PROFILES.standard).verdict, 'fail');
  assert.equal(decideVerdict(low, geometryOk, DEFAULT_PROFILES.relaxed).verdict, 'pass');
  const perfect = decideVerdict(low, geometryOk, DEFAULT_PROFILES['pixel-perfect']);
  assert.equal(perfect.verdict, 'pass');
  assert.ok(perfect.notes.some((note) => /informational/.test(note)));
});

test('decideVerdict: mismatched dimensions fail under a numeric target', () => {
  const mismatch = { ...samePixels, dimensionsMatch: false, actualSize: { width: 12, height: 10 }, diffPixels: null, totalPixels: null, similarity: null };
  const decision = decideVerdict(mismatch, { checked: true, deviations: [], missingSelectors: [] }, DEFAULT_PROFILES.standard);
  assert.equal(decision.verdict, 'fail');
  assert.ok(decision.failures.some((failure) => /10x10.*12x10/.test(failure)));
});

test('decideVerdict: an out-of-tolerance deviation or a missing selector fails', () => {
  const deviation = {
    selector: 'h1', property: 'width', kind: 'geometry' as const, expected: 100, actual: 110,
    delta: 10, tolerance: 3, withinTolerance: false
  };
  assert.equal(decideVerdict(samePixels, { checked: true, deviations: [deviation], missingSelectors: [] }, DEFAULT_PROFILES.standard).verdict, 'fail');
  assert.equal(decideVerdict(samePixels, { checked: true, deviations: [], missingSelectors: ['.x'] }, DEFAULT_PROFILES.standard).verdict, 'fail');
});

test('compareScreenshots rejects paths outside the project root before reading anything', async () => {
  await withProjectRoot(async () => {
    await assert.rejects(
      () => compareScreenshots({ baselinePath: '../a.png', actualPath: 'b.png' }),
      /compare_screenshots: baselinePath "\.\.\/a\.png" resolves outside the project root/
    );
    await assert.rejects(
      () => compareScreenshots({ baselinePath: 'a.png', actualPath: 'b.png', diffOutputPath: '/tmp/x.png' }),
      /compare_screenshots: diffOutputPath "\/tmp\/x\.png" resolves outside the project root/
    );
  });
});

test('compareScreenshots with only PNGs returns an incomplete verdict and writes the diff inside the root', async () => {
  await withProjectRoot(async (root) => {
    writeSolidPng(join(root, 'a.png'), 10, 10, WHITE);
    writeSolidPng(join(root, 'b.png'), 10, 10, WHITE);
    const result = await compareScreenshots({ baselinePath: 'a.png', actualPath: 'b.png', diffOutputPath: 'out/diff.png' });
    assert.equal(result.validationProfile, 'standard');
    assert.equal(result.pixel.similarity, 1);
    assert.equal(result.geometry.checked, false);
    assert.equal(result.verdict, 'incomplete');
    assert.equal(result.pixel.diffOutputPath, join(root, 'out', 'diff.png'));
    assert.ok(existsSync(join(root, 'out', 'diff.png')));
  });
});

test('compareScreenshots measures elements on an allowed page and reports missing selectors', async () => {
  const fixture = await startFixtureServer(FIXTURE_HTML);
  try {
    await withProjectRoot(async (root) => {
      writeSolidPng(join(root, 'a.png'), 800, 600, WHITE);
      writeSolidPng(join(root, 'b.png'), 800, 600, WHITE);
      const result = await compareScreenshots({
        baselinePath: 'a.png',
        actualPath: 'b.png',
        url: fixture.url,
        elements: [
          { selector: '[data-testid="hero-title"]', fontSize: 32, color: '#111827' },
          { selector: '.does-not-exist', width: 10 }
        ]
      });
      assert.equal(result.geometry.checked, true);
      assert.ok(result.geometry.deviations.every((d) => d.withinTolerance));
      assert.deepEqual(result.geometry.missingSelectors, ['.does-not-exist']);
      assert.equal(result.verdict, 'fail');
    });
  } finally {
    await fixture.close();
  }
});

test('compareScreenshots rejects elements without a url, and a disallowed url', async () => {
  await withProjectRoot(async (root) => {
    writeSolidPng(join(root, 'a.png'), 10, 10, WHITE);
    writeSolidPng(join(root, 'b.png'), 10, 10, WHITE);
    await assert.rejects(
      () => compareScreenshots({ baselinePath: 'a.png', actualPath: 'b.png', elements: [{ selector: 'h1', width: 1 }] }),
      /compare_screenshots: "elements" requires "url"/
    );
    await assert.rejects(
      () => compareScreenshots({ baselinePath: 'a.png', actualPath: 'b.png', url: 'http://example.com/', elements: [{ selector: 'h1', width: 1 }] }),
      /host not allowed/
    );
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npm test --workspace=packages/mcp-server`
Expected: FAIL — `Cannot find module '../src/compare.ts'`.

- [ ] **Step 7: Implement `src/compare.ts`**

```ts
import { resolveProjectPath } from './paths.js';
import { withAllowedPages, type Viewport } from './browser.js';
import { loadProjectConfig, type ValidationProfile, type ValidationProfileName } from './config.js';
import { diffPngFiles, type PixelDiffResult } from './pixel-diff.js';
import { evaluateExpectations, measureElements, type ElementExpectation, type GeometryCheck } from './geometry.js';

const TOOL = 'compare_screenshots';

export interface CompareScreenshotsInput {
  baselinePath: string;
  actualPath: string;
  diffOutputPath?: string;
  url?: string;
  elements?: ElementExpectation[];
  viewport?: Viewport;
}

export type Verdict = 'pass' | 'fail' | 'incomplete';

export interface CompareScreenshotsResult {
  validationProfile: ValidationProfileName;
  profile: ValidationProfile;
  pixel: PixelDiffResult;
  geometry: GeometryCheck;
  verdict: Verdict;
  failures: string[];
  notes: string[];
}

function size(s: { width: number; height: number }): string {
  return `${s.width}x${s.height}`;
}

export function decideVerdict(
  pixel: PixelDiffResult,
  geometry: GeometryCheck,
  profile: ValidationProfile
): { verdict: Verdict; failures: string[]; notes: string[] } {
  const failures: string[] = [];
  const notes: string[] = [];
  const target = profile.pixelSimilarityTarget;

  if (target === 'informational') {
    notes.push('pixel similarity is informational under this profile (rendering noise varies by OS/browser); it does not gate the verdict');
    if (!pixel.dimensionsMatch) {
      notes.push(`screenshot dimensions differ: baseline ${size(pixel.baselineSize)} vs actual ${size(pixel.actualSize)}`);
    }
  } else if (!pixel.dimensionsMatch) {
    failures.push(`screenshot dimensions differ: baseline ${size(pixel.baselineSize)} vs actual ${size(pixel.actualSize)}`);
  } else if ((pixel.similarity ?? 0) < target) {
    failures.push(`pixel similarity ${pixel.similarity} is below the profile target ${target}`);
  }

  for (const selector of geometry.missingSelectors) {
    failures.push(`selector "${selector}" matched no rendered element`);
  }
  for (const d of geometry.deviations) {
    if (d.withinTolerance) continue;
    failures.push(
      d.kind === 'color'
        ? `${d.selector} ${d.property}: expected ${d.expected}, got ${d.actual}`
        : `${d.selector} ${d.property}: expected ${d.expected}, got ${d.actual} (delta ${d.delta}, tolerance ${d.tolerance})`
    );
  }

  if (failures.length > 0) return { verdict: 'fail', failures, notes };
  if (!geometry.checked) {
    notes.push('geometry was not checked (pass "url" and "elements"); pixel similarity alone never approves a screen (spec §7)');
    return { verdict: 'incomplete', failures, notes };
  }
  return { verdict: 'pass', failures, notes };
}

export async function compareScreenshots(input: CompareScreenshotsInput): Promise<CompareScreenshotsResult> {
  const baselinePath = resolveProjectPath(input.baselinePath, { toolName: TOOL, label: 'baselinePath', extension: '.png' });
  const actualPath = resolveProjectPath(input.actualPath, { toolName: TOOL, label: 'actualPath', extension: '.png' });
  const diffOutputPath = input.diffOutputPath
    ? resolveProjectPath(input.diffOutputPath, { toolName: TOOL, label: 'diffOutputPath', extension: '.png' })
    : null;
  const elements = input.elements ?? [];
  if (elements.length > 0 && !input.url) {
    throw new Error(`${TOOL}: "elements" requires "url" (the page to measure).`);
  }

  const config = loadProjectConfig();
  const pixel = diffPngFiles(baselinePath, actualPath, diffOutputPath, TOOL);

  let geometry: GeometryCheck = { checked: false, deviations: [], missingSelectors: [] };
  if (input.url && elements.length > 0) {
    const viewport = input.viewport ?? pixel.baselineSize;
    const measurements = await withAllowedPages(TOOL, input.url, async (open) => {
      const page = await open(viewport);
      return measureElements(page, elements.map((element) => element.selector));
    });
    geometry = evaluateExpectations(elements, measurements, config.profile);
  }

  const decision = decideVerdict(pixel, geometry, config.profile);
  return {
    validationProfile: config.validationProfile,
    profile: config.profile,
    pixel,
    geometry,
    ...decision
  };
}
```

- [ ] **Step 8: Run the full suite and typecheck**

Run: `npm test --workspace=packages/mcp-server && npm run typecheck --workspace=packages/mcp-server`
Expected: 50 tests passing (42 + 8 new), no type errors.

- [ ] **Step 9: Commit**

```bash
git add packages/mcp-server/src/geometry.ts packages/mcp-server/src/compare.ts packages/mcp-server/tests/geometry.test.ts packages/mcp-server/tests/compare.test.ts
git commit -m "Add compare_screenshots logic: pixel + geometry diff with profile-driven verdict"
```

---

### Task 5: `run_accessibility_audit` logic

**Files:**
- Modify: `packages/mcp-server/package.json` (add `@axe-core/playwright` via npm)
- Create: `packages/mcp-server/src/a11y.ts`
- Create: `packages/mcp-server/tests/a11y.test.ts`

**Interfaces:**
- Consumes: `withAllowedPages`, `Viewport` (Task 1); `loadProjectConfig`, `ValidationProfileName` (Task 2); test helpers `startFixtureServer`, `FIXTURE_HTML`.
- Produces: `interface A11yViolation { id: string; impact: string | null; description: string; helpUrl: string; nodeCount: number; targets: string[] }`, `interface AccessibilityAuditResult { url: string; validationProfile: ValidationProfileName; countsByImpact: { critical: number; serious: number; moderate: number; minor: number }; criticalCount: number; maxCriticalA11yIssues: number; passed: boolean; violations: A11yViolation[] }`, and `runAccessibilityAudit(input: { url: string; viewport?: Viewport }): Promise<AccessibilityAuditResult>` in `src/a11y.ts` — consumed by Task 7.

- [ ] **Step 1: Add the dependency**

Run from the worktree root: `npm install @axe-core/playwright@^4.13.0 --workspace=packages/mcp-server`

- [ ] **Step 2: Write the failing tests**

`packages/mcp-server/tests/a11y.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAccessibilityAudit } from '../src/a11y.ts';
import { startFixtureServer, FIXTURE_HTML } from './fixtures/server.ts';

const BROKEN_HTML = `<!doctype html>
<html lang="en">
  <head><title>Broken</title></head>
  <body>
    <main>
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
      <button></button>
    </main>
  </body>
</html>`;

test('runAccessibilityAudit fails a page with critical violations and names them', async () => {
  const fixture = await startFixtureServer(BROKEN_HTML);
  try {
    const result = await runAccessibilityAudit({ url: fixture.url });
    assert.equal(result.passed, false);
    assert.ok(result.criticalCount >= 2, `expected >= 2 critical, got ${result.criticalCount}`);
    assert.equal(result.countsByImpact.critical, result.criticalCount);
    const ids = result.violations.map((v) => v.id);
    assert.ok(ids.includes('image-alt'));
    assert.ok(ids.includes('button-name'));
    const imageAlt = result.violations.find((v) => v.id === 'image-alt')!;
    assert.equal(imageAlt.impact, 'critical');
    assert.ok(imageAlt.targets.length >= 1);
  } finally {
    await fixture.close();
  }
});

test('runAccessibilityAudit passes a page whose only violations are below critical', async () => {
  const fixture = await startFixtureServer(FIXTURE_HTML);
  try {
    const result = await runAccessibilityAudit({ url: fixture.url });
    assert.equal(result.criticalCount, 0);
    assert.equal(result.maxCriticalA11yIssues, 0);
    assert.equal(result.passed, true);
  } finally {
    await fixture.close();
  }
});

test('runAccessibilityAudit rejects a disallowed host', async () => {
  await assert.rejects(() => runAccessibilityAudit({ url: 'http://example.com/' }), /run_accessibility_audit: host not allowed/);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test --workspace=packages/mcp-server`
Expected: FAIL — `Cannot find module '../src/a11y.ts'`.

- [ ] **Step 4: Implement `src/a11y.ts`**

```ts
import AxeBuilder from '@axe-core/playwright';
import { withAllowedPages, type Viewport } from './browser.js';
import { loadProjectConfig, type ValidationProfileName } from './config.js';

const TOOL = 'run_accessibility_audit';
const MAX_TARGETS_PER_VIOLATION = 5;

export interface A11yViolation {
  id: string;
  impact: string | null;
  description: string;
  helpUrl: string;
  nodeCount: number;
  targets: string[];
}

export interface AccessibilityAuditResult {
  url: string;
  validationProfile: ValidationProfileName;
  countsByImpact: { critical: number; serious: number; moderate: number; minor: number };
  criticalCount: number;
  maxCriticalA11yIssues: number;
  passed: boolean;
  violations: A11yViolation[];
}

export async function runAccessibilityAudit(input: { url: string; viewport?: Viewport }): Promise<AccessibilityAuditResult> {
  const config = loadProjectConfig();

  const axeViolations = await withAllowedPages(TOOL, input.url, async (open) => {
    const page = await open(input.viewport);
    const results = await new AxeBuilder({ page }).analyze();
    return results.violations;
  });

  const countsByImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const violations: A11yViolation[] = axeViolations.map((violation) => {
    const impact = violation.impact ?? null;
    if (impact && impact in countsByImpact) {
      countsByImpact[impact as keyof typeof countsByImpact] += violation.nodes.length;
    }
    return {
      id: violation.id,
      impact,
      description: violation.description,
      helpUrl: violation.helpUrl,
      nodeCount: violation.nodes.length,
      targets: violation.nodes.slice(0, MAX_TARGETS_PER_VIOLATION).map((node) => node.target.join(' '))
    };
  });

  const criticalCount = countsByImpact.critical;
  const maxCriticalA11yIssues = config.profile.maxCriticalA11yIssues;
  return {
    url: input.url,
    validationProfile: config.validationProfile,
    countsByImpact,
    criticalCount,
    maxCriticalA11yIssues,
    passed: criticalCount <= maxCriticalA11yIssues,
    violations
  };
}
```

Note: counts are per affected node (two unlabeled buttons = 2 critical issues). If `import AxeBuilder from '@axe-core/playwright'` fails to typecheck or resolves to a module object at runtime under NodeNext, switch to the named import `import { AxeBuilder } from '@axe-core/playwright'` (the package exports both) and note it in the report.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test --workspace=packages/mcp-server && npm run typecheck --workspace=packages/mcp-server`
Expected: 53 tests passing (50 + 3 new), no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp-server/package.json package-lock.json packages/mcp-server/src/a11y.ts packages/mcp-server/tests/a11y.test.ts
git commit -m "Add run_accessibility_audit logic (axe-core) gated by the profile's critical-issue limit"
```

---

### Task 6: `run_responsive_suite` logic

**Files:**
- Create: `packages/mcp-server/src/responsive.ts`
- Create: `packages/mcp-server/tests/responsive.test.ts`

**Interfaces:**
- Consumes: `withAllowedPages` (Task 1); `resolveProjectPath` (Task 1); `loadProjectConfig`, `Breakpoint`, `ValidationProfileName` (Task 2); test helpers `startFixtureServer`, `FIXTURE_HTML`.
- Produces: `interface BreakpointResult { name: string; width: number; height: number; hasHorizontalOverflow: boolean; scrollWidth: number; clientWidth: number; overflowingElements: string[]; screenshotPath: string | null }`, `interface ResponsiveSuiteResult { url: string; validationProfile: ValidationProfileName; required: boolean; passed: boolean; breakpoints: BreakpointResult[] }`, and `runResponsiveSuite(input: { url: string; outputDir?: string; breakpoints?: Breakpoint[] }): Promise<ResponsiveSuiteResult>` in `src/responsive.ts` — consumed by Task 7.

- [ ] **Step 1: Write the failing tests**

`packages/mcp-server/tests/responsive.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runResponsiveSuite } from '../src/responsive.ts';
import { startFixtureServer, FIXTURE_HTML } from './fixtures/server.ts';

const WIDE_HTML = `<!doctype html>
<html lang="en">
  <head><title>Wide</title><style>body { margin: 0; }</style></head>
  <body>
    <div class="banner" style="width: 1000px; height: 20px; background: #eee;"></div>
  </body>
</html>`;

async function withProjectRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'frontend-agent-responsive-'));
  const previous = process.env.FRONTEND_AGENT_PROJECT_ROOT;
  process.env.FRONTEND_AGENT_PROJECT_ROOT = root;
  try {
    return await fn(root);
  } finally {
    if (previous === undefined) delete process.env.FRONTEND_AGENT_PROJECT_ROOT;
    else process.env.FRONTEND_AGENT_PROJECT_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

test('a page that fits every default breakpoint passes, and screenshots land in outputDir', async () => {
  const fixture = await startFixtureServer(FIXTURE_HTML);
  try {
    await withProjectRoot(async (root) => {
      const result = await runResponsiveSuite({ url: fixture.url, outputDir: 'responsive' });
      assert.deepEqual(result.breakpoints.map((b) => b.name), ['desktop', 'laptop', 'tablet', 'mobile']);
      assert.equal(result.required, true);
      assert.equal(result.passed, true);
      for (const breakpoint of result.breakpoints) {
        assert.equal(breakpoint.hasHorizontalOverflow, false);
        assert.equal(breakpoint.screenshotPath, join(root, 'responsive', `${breakpoint.name}.png`));
        assert.ok(existsSync(breakpoint.screenshotPath!));
      }
    });
  } finally {
    await fixture.close();
  }
});

test('overflow is reported only at the breakpoints where it happens, naming the offending element', async () => {
  const fixture = await startFixtureServer(WIDE_HTML);
  try {
    await withProjectRoot(async () => {
      const result = await runResponsiveSuite({ url: fixture.url });
      const byName = Object.fromEntries(result.breakpoints.map((b) => [b.name, b]));
      assert.equal(byName.desktop.hasHorizontalOverflow, false);
      assert.equal(byName.laptop.hasHorizontalOverflow, false);
      assert.equal(byName.tablet.hasHorizontalOverflow, true);
      assert.equal(byName.mobile.hasHorizontalOverflow, true);
      assert.ok(byName.mobile.overflowingElements.some((el) => el.includes('div.banner')));
      assert.equal(byName.mobile.screenshotPath, null);
      assert.equal(result.passed, false);
    });
  } finally {
    await fixture.close();
  }
});

test('explicit breakpoints override the configured set', async () => {
  const fixture = await startFixtureServer(WIDE_HTML);
  try {
    await withProjectRoot(async () => {
      const result = await runResponsiveSuite({ url: fixture.url, breakpoints: [{ name: 'huge', width: 1600, height: 900 }] });
      assert.deepEqual(result.breakpoints.map((b) => b.name), ['huge']);
      assert.equal(result.passed, true);
    });
  } finally {
    await fixture.close();
  }
});

test('runResponsiveSuite rejects an outputDir outside the project root and a disallowed host', async () => {
  await withProjectRoot(async () => {
    await assert.rejects(
      () => runResponsiveSuite({ url: 'http://127.0.0.1:1/', outputDir: '../out' }),
      /run_responsive_suite: outputDir "\.\.\/out" resolves outside the project root/
    );
    await assert.rejects(() => runResponsiveSuite({ url: 'http://example.com/' }), /run_responsive_suite: host not allowed/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=packages/mcp-server`
Expected: FAIL — `Cannot find module '../src/responsive.ts'`.

- [ ] **Step 3: Implement `src/responsive.ts`**

```ts
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { resolveProjectPath } from './paths.js';
import { withAllowedPages } from './browser.js';
import { loadProjectConfig, type Breakpoint, type ValidationProfileName } from './config.js';

const TOOL = 'run_responsive_suite';
const MAX_OVERFLOWING_ELEMENTS = 10;

export interface BreakpointResult {
  name: string;
  width: number;
  height: number;
  hasHorizontalOverflow: boolean;
  scrollWidth: number;
  clientWidth: number;
  overflowingElements: string[];
  screenshotPath: string | null;
}

export interface ResponsiveSuiteResult {
  url: string;
  validationProfile: ValidationProfileName;
  required: boolean;
  passed: boolean;
  breakpoints: BreakpointResult[];
}

export async function runResponsiveSuite(input: {
  url: string;
  outputDir?: string;
  breakpoints?: Breakpoint[];
}): Promise<ResponsiveSuiteResult> {
  const outputDir = input.outputDir
    ? resolveProjectPath(input.outputDir, { toolName: TOOL, label: 'outputDir' })
    : null;
  const config = loadProjectConfig();
  const breakpoints = input.breakpoints ?? config.breakpoints;

  const results = await withAllowedPages(TOOL, input.url, async (open) => {
    const collected: BreakpointResult[] = [];
    for (const breakpoint of breakpoints) {
      const page = await open({ width: breakpoint.width, height: breakpoint.height });
      const measured = await page.evaluate((limit) => {
        const doc = document.documentElement;
        const clientWidth = doc.clientWidth;
        const scrollWidth = doc.scrollWidth;
        const offenders: string[] = [];
        if (scrollWidth > clientWidth) {
          for (const el of Array.from(document.body.querySelectorAll('*'))) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.right > clientWidth + 1) {
              const id = el.id ? `#${el.id}` : '';
              const classes = Array.from(el.classList).slice(0, 2).map((c) => `.${c}`).join('');
              offenders.push(`${el.tagName.toLowerCase()}${id}${classes} (right edge ${Math.round(rect.right)}px)`);
              if (offenders.length >= limit) break;
            }
          }
        }
        return { clientWidth, scrollWidth, offenders };
      }, MAX_OVERFLOWING_ELEMENTS);

      let screenshotPath: string | null = null;
      if (outputDir) {
        mkdirSync(outputDir, { recursive: true });
        screenshotPath = path.join(outputDir, `${breakpoint.name}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
      }
      await page.close();

      collected.push({
        name: breakpoint.name,
        width: breakpoint.width,
        height: breakpoint.height,
        hasHorizontalOverflow: measured.scrollWidth > measured.clientWidth,
        scrollWidth: measured.scrollWidth,
        clientWidth: measured.clientWidth,
        overflowingElements: measured.offenders,
        screenshotPath
      });
    }
    return collected;
  });

  return {
    url: input.url,
    validationProfile: config.validationProfile,
    required: config.profile.requireResponsivePass,
    passed: results.every((result) => !result.hasHorizontalOverflow),
    breakpoints: results
  };
}
```

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npm test --workspace=packages/mcp-server && npm run typecheck --workspace=packages/mcp-server`
Expected: 57 tests passing (53 + 4 new), no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server/src/responsive.ts packages/mcp-server/tests/responsive.test.ts
git commit -m "Add run_responsive_suite logic: per-breakpoint overflow detection and screenshots"
```

---

### Task 7: Register the v0.3 tools, bump to 0.3.0, and document

**Files:**
- Modify: `packages/mcp-server/src/index.ts`
- Modify: `packages/mcp-server/package.json` (`"version": "0.3.0"`)
- Create: `packages/mcp-server/tests/tools.test.ts`
- Modify: `README.md`
- Modify: `skills/visual-validation/SKILL.md`

**Interfaces:**
- Consumes: `compareScreenshots` (Task 4), `runAccessibilityAudit` (Task 5), `runResponsiveSuite` (Task 6), `BREAKPOINT_NAME_PATTERN` (Task 2), plus the v0.2 `captureScreenshot` / `inspectDom`.
- Produces: an MCP server exposing exactly five tools: `capture_screenshot`, `inspect_dom`, `compare_screenshots`, `run_responsive_suite`, `run_accessibility_audit`.

- [ ] **Step 1: Write the failing registration test**

`packages/mcp-server/tests/tools.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/index.ts';

async function connectClient() {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

test('the server exposes exactly the five v0.3 tools and reports version 0.3.0', async () => {
  const { client, server } = await connectClient();
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      ['capture_screenshot', 'compare_screenshots', 'inspect_dom', 'run_accessibility_audit', 'run_responsive_suite']
    );
    assert.equal(client.getServerVersion()?.version, '0.3.0');
  } finally {
    await client.close();
    await server.close();
  }
});

test('tool errors come back as isError results, not transport failures', async () => {
  const { client, server } = await connectClient();
  try {
    const result = await client.callTool({
      name: 'run_accessibility_audit',
      arguments: { url: 'http://example.com/' }
    });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /host not allowed/);
  } finally {
    await client.close();
    await server.close();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=packages/mcp-server`
Expected: FAIL — the tool list has only two names and the version is `0.2.0`.

- [ ] **Step 3: Register the tools in `src/index.ts`**

Replace the import block at the top of `packages/mcp-server/src/index.ts` with:
```ts
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { captureScreenshot } from './screenshot.js';
import { inspectDom } from './dom.js';
import { compareScreenshots } from './compare.js';
import { runAccessibilityAudit } from './a11y.js';
import { runResponsiveSuite } from './responsive.js';
import { BREAKPOINT_NAME_PATTERN } from './config.js';

const viewportSchema = z.object({
  width: z.number().int().positive().max(7680),
  height: z.number().int().positive().max(7680)
});

function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}
```

Change `new McpServer({ name: 'frontend-agent', version: '0.2.0' })` to `new McpServer({ name: 'frontend-agent', version: '0.3.0' })`. In the two existing handlers, replace `return { content: [{ type: 'text', text: JSON.stringify(result) }] };` with `return jsonResult(result);`.

Then insert, directly before `return server;` inside `createServer()`:
```ts
  server.registerTool(
    'compare_screenshots',
    {
      title: 'Compare Screenshots',
      description:
        'Pixel-diff a baseline PNG (e.g. the Figma frame exported at 1x) against an actual PNG, and optionally measure elements on a local or allowed page against expected Figma values. Returns a verdict (pass | fail | incomplete) under the project validationProfile; pixel similarity alone never yields pass.',
      inputSchema: {
        baselinePath: z.string(),
        actualPath: z.string(),
        diffOutputPath: z.string().optional(),
        url: z.string().url().optional(),
        viewport: viewportSchema.optional(),
        elements: z
          .array(
            z
              .object({
                selector: z.string().min(1),
                x: z.number().optional(),
                y: z.number().optional(),
                width: z.number().optional(),
                height: z.number().optional(),
                paddingTop: z.number().optional(),
                paddingRight: z.number().optional(),
                paddingBottom: z.number().optional(),
                paddingLeft: z.number().optional(),
                gap: z.number().optional(),
                fontSize: z.number().optional(),
                color: z.string().optional()
              })
              .strict()
          )
          .max(200)
          .optional()
      }
    },
    async (args) => jsonResult(await compareScreenshots(args))
  );

  server.registerTool(
    'run_responsive_suite',
    {
      title: 'Run Responsive Suite',
      description:
        'Load a local or allowed page at each breakpoint (project config, or the spec defaults 1440x900, 1280x800, 768x1024, 390x844), report horizontal overflow and the offending elements, and optionally save one screenshot per breakpoint under outputDir.',
      inputSchema: {
        url: z.string().url(),
        outputDir: z.string().optional(),
        breakpoints: z
          .array(
            z.object({
              name: z.string().regex(BREAKPOINT_NAME_PATTERN),
              width: z.number().int().positive().max(7680),
              height: z.number().int().positive().max(7680)
            })
          )
          .min(1)
          .max(20)
          .optional()
      }
    },
    async (args) => jsonResult(await runResponsiveSuite(args))
  );

  server.registerTool(
    'run_accessibility_audit',
    {
      title: 'Run Accessibility Audit',
      description:
        'Run axe-core on a local or allowed page and report violations by impact. Passes when critical-impact issues do not exceed the profile maxCriticalA11yIssues (0 in every default profile).',
      inputSchema: {
        url: z.string().url(),
        viewport: viewportSchema.optional()
      }
    },
    async (args) => jsonResult(await runAccessibilityAudit(args))
  );
```

- [ ] **Step 4: Bump the package version**

In `packages/mcp-server/package.json`, change `"version": "0.2.0"` to `"version": "0.3.0"`.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test --workspace=packages/mcp-server && npm run typecheck --workspace=packages/mcp-server`
Expected: 59 tests passing (57 + 2 new), no type errors.

- [ ] **Step 6: Update `README.md`**

Read `README.md` first. Make these edits:
1. Replace the sentence that begins `The kit's own MCP server now ships two tools` (the whole sentence, through `(v0.4).`) with:
   `The kit's own MCP server ships five tools: \`capture_screenshot\` and \`inspect_dom\` (v0.2), plus \`compare_screenshots\`, \`run_responsive_suite\` and \`run_accessibility_audit\` with per-project validation profiles (v0.3). Not yet included: the CLI installer (v0.4).`
   Keep the sentence that follows it (the pointer to the design spec) unchanged.
2. In the MCP server section, after the existing tool descriptions and before the next `## ` heading, add a `### Validation tools and profiles (v0.3)` subsection containing:
   - one bullet per new tool, taken from its `description` in Step 3;
   - this config example and the rules below it:

````markdown
```yaml
# .frontend-agent/config.yml (in the target project root)
validationProfile: standard      # pixel-perfect | standard (default) | relaxed
profiles:
  standard:
    pixelSimilarityTarget: 0.97  # override single fields; the rest keep spec defaults
breakpoints:                     # replaces the default set entirely when present
  desktop: 1440x900
  mobile: 390x844
allowedHosts:
  - staging.example.com
```
````

   - Rules, one bullet each: pixel similarity alone never approves a screen — `compare_screenshots` returns `incomplete` unless `url` + `elements` are given; export the Figma baseline at 1× so its size matches the viewport; a "critical" accessibility issue means axe-core impact `critical` (serious and lower are reported, not gating); every path a tool reads or writes (`baselinePath`, `actualPath`, `diffOutputPath`, `outputDir`, `outputPath`) must resolve inside the project root; an invalid config file is an error, not a silent fallback.

- [ ] **Step 7: Update `skills/visual-validation/SKILL.md`**

Insert a new section directly before `## Fix priority order`:
```markdown
## Tools (frontend-agent MCP, v0.3+)

When the frontend-agent MCP server is registered, use it instead of eyeballing:

- `compare_screenshots` — pass the Figma frame export (1×) as `baselinePath`, your `capture_screenshot` output as `actualPath`, and `url` + `elements` with the exact Figma values (x, y, width, height, padding*, gap, fontSize, color). Only a `pass` verdict counts; `incomplete` means you skipped the geometry check.
- `run_responsive_suite` — covers the desktop/tablet/mobile items of the Definition of Done and flags unexpected horizontal overflow.
- `run_accessibility_audit` — covers "accessibility sem erro crítico"; fix every critical violation it reports.

The tools read `validationProfile`, tolerances and breakpoints from `.frontend-agent/config.yml`, so the verdicts already follow the table above.
```

- [ ] **Step 8: Validate skills and re-run everything**

Run: `npm run validate:skills && npm test --workspace=packages/mcp-server && npm run typecheck --workspace=packages/mcp-server`
Expected: skill validator passes; 59 tests passing; no type errors.

- [ ] **Step 9: Commit**

```bash
git add packages/mcp-server/src/index.ts packages/mcp-server/package.json packages/mcp-server/tests/tools.test.ts README.md skills/visual-validation/SKILL.md
git commit -m "Register compare_screenshots, run_responsive_suite and run_accessibility_audit; document v0.3"
```

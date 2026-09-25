# Visual validation: Figma MCP and the kit's MCP server

The frontend workflow uses the official Figma MCP for design context and the kit's own MCP server for browser validation. `dev-agent install` configures both; this page has the details and the manual steps.

## Configure the Figma MCP

Claude Code, current project:

```bash
claude mcp add --transport http figma https://mcp.figma.com/mcp
```

Claude Code, all projects (user scope):

```bash
claude mcp add --scope user --transport http figma https://mcp.figma.com/mcp
```

Codex CLI:

```bash
codex mcp add figma --url https://mcp.figma.com/mcp
```

After adding, authenticate when prompted and confirm the server is connected (`/mcp` in Claude Code, `codex mcp list` in Codex).

## Register the kit's own MCP server (v0.2)

The CLI above does this for you per project; the manual steps below remain for custom setups.

The kit ships its own MCP server (`packages/mcp-server`) with five tools: `capture_screenshot` and `inspect_dom` (v0.2), plus `compare_screenshots`, `run_responsive_suite` and `run_accessibility_audit` (v0.3). Install its dependencies once from the repo root:

```bash
npm install
npx --workspace=packages/mcp-server playwright install chromium   # from a checkout
# installed globally: cd "$(npm root -g)/dev-agent-kit" && npx playwright install chromium
```

The server resolves its **project root** — where it looks for `.frontend-agent/config.yml` and where `outputPath` for screenshots must stay inside — from the `FRONTEND_AGENT_PROJECT_ROOT` environment variable if set, otherwise from its own current working directory. Because the server is normally launched from the kit's own checkout (not from the target project), **always set `FRONTEND_AGENT_PROJECT_ROOT` explicitly to the target project's absolute path**, and use absolute paths for the launch command too — a plain `npx tsx packages/mcp-server/src/index.ts` resolved from a different cwd will not find the target project's config or be able to write into it.

In an installed copy the `tsx` binary may be hoisted to a parent `node_modules/.bin`; `dev-agent install` finds it and writes the working path into `.mcp.json`, so copy the command from there if the one below does not exist on your machine.

Register it with `--scope user` so it's available in every project, pointing `FRONTEND_AGENT_PROJECT_ROOT` at whichever project you're validating:

Claude Code:

```bash
claude mcp add --scope user frontend-agent \
  -e FRONTEND_AGENT_PROJECT_ROOT=/absolute/path/to/target-project \
  -- /absolute/path/to/dev-agent-kit/node_modules/.bin/tsx \
     /absolute/path/to/dev-agent-kit/packages/mcp-server/src/index.ts
```

Codex CLI (`~/.codex/config.toml`):

```toml
[mcp_servers.frontend-agent]
command = "/absolute/path/to/dev-agent-kit/node_modules/.bin/tsx"
args = ["/absolute/path/to/dev-agent-kit/packages/mcp-server/src/index.ts"]
env = { FRONTEND_AGENT_PROJECT_ROOT = "/absolute/path/to/target-project" }
```

Confirm the tools appear (`/mcp` in Claude Code, `codex mcp list` in Codex).

Without `FRONTEND_AGENT_PROJECT_ROOT`, the server falls back to its own process cwd as the project root, which is almost never what you want when it's registered once and reused across projects.

Every tool that navigates a page only reaches `localhost`/`127.0.0.1`/`[::1]` by default. To allow another host (e.g. a staging server), add it under `.frontend-agent/config.yml` **in the target project root** (i.e. `FRONTEND_AGENT_PROJECT_ROOT`, not the kit's checkout):

```yaml
allowedHosts:
  - staging.example.com
```

The config file is parsed as real YAML (via `yaml` + a `zod` schema), so any valid YAML shape for `allowedHosts:` works, including an inline array (`allowedHosts: [staging.example.com, preview.example.com]`). A config with the wrong shape (e.g. `allowedHosts` as a map, or a value that isn't a string) or an unknown top-level/profile key is a hard error naming the config file — never a silent fallback to defaults.

### Testing the MCP server without a model

```bash
npm run mcp:inspect
```

This opens the MCP Inspector against the server so you can call any of the five tools (`capture_screenshot`, `inspect_dom`, `compare_screenshots`, `run_responsive_suite`, `run_accessibility_audit`) directly and see their raw output before wiring a model into the loop.

### Validation tools and profiles (v0.3)

- `compare_screenshots` — pixel-diff a baseline PNG (e.g. the Figma frame exported at 1x) against an actual PNG, and optionally measure elements on a local or allowed page against expected Figma values. Returns a verdict (pass | fail | incomplete) under the project validationProfile; pixel similarity alone never yields pass.
- `run_responsive_suite` — load a local or allowed page at each breakpoint (project config, or the spec defaults 1440x900, 1280x800, 768x1024, 390x844), report horizontal overflow and the offending elements, and optionally save one screenshot per breakpoint under outputDir.
- `run_accessibility_audit` — run axe-core on a local or allowed page and report violations by impact. Passes when critical-impact issues do not exceed the profile maxCriticalA11yIssues (0 in every default profile).

Configure tolerances, breakpoints and allowed hosts per project:

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

- Pixel similarity alone never approves a screen — `compare_screenshots` returns `incomplete` unless `url` + `elements` are given.
- Export the Figma baseline at 1× so its size matches the viewport.
- `capture_screenshot` takes an optional `fullPage` (default `true`, keeping v0.2 behaviour and capturing the whole scrollable page). For a frame-for-frame comparison against a Figma export, capture the *actual* screenshot with `fullPage: false` at the Figma frame's own size, so its dimensions match the baseline exactly.
- When `compare_screenshots` measures `elements` and no `viewport` is passed, it defaults the width to the baseline PNG's width and the height to the configured breakpoint whose width matches it (else `900`). If the baseline width looks like a 2x/3x export of a configured breakpoint, the result carries a note suggesting an export at 1x or an explicit `viewport`.
- If the baseline and actual PNGs have the same width but different heights, `compare_screenshots` still diffs the overlapping top region (width × the smaller height) instead of refusing to compare: `dimensionsMatch` stays `false`, but `pixel.comparedRegion` reports the region size, a note explains the height mismatch, and the profile's similarity target applies to that overlap. Only a **width** mismatch is treated as a hard dimension failure.
- A "critical" accessibility issue means axe-core impact `critical` (serious and lower are reported, not gating).
- Every path a tool reads or writes (`baselinePath`, `actualPath`, `diffOutputPath`, `outputDir`, `outputPath`) must resolve inside the project root.
- An invalid config file is an error, not a silent fallback.

# Dev Agent Kit

> This repository is the evolution of `andre-zaguette/frontend-agent-kit` (history restarted at v0.5). The kit is growing from a frontend-only agent into a provider-neutral engineering agent; see `docs/superpowers/specs/2026-09-24-dev-agent-kit-evolution.md`. The `frontend-agent` CLI, the seven frontend skills and the MCP tool names are unchanged until v1.0.

Portable Figma-to-code agent kit for Claude Code and Codex: skills, stack references and (from v0.2 onward) an own MCP server for visual validation.

## What's in v0.1

- 7 canonical skills under `skills/`, covering the full Figma-to-code workflow, component reuse, responsive design, motion, accessibility and visual validation (v0.6 adds 7 shared engineering skills and v0.7 the `task-orchestrator` skill, for 15 in total).
- 8 pre-populated stack references (`skills/figma-to-code/references/`): React, Next.js, Vue 3, Nuxt, Angular, Tailwind CSS, PHP/Laravel, plain HTML/CSS/JS. New stacks are bootstrapped automatically the first time a task needs them (see `skills/component-selection/SKILL.md`).
- Manual installation into Claude Code and Codex (a CLI installer was added in v0.4 — see below).
- Documented setup for Figma's official MCP server (design context, screenshots, variables, assets).

The kit's own MCP server ships five tools: `capture_screenshot` and `inspect_dom` (v0.2), plus `compare_screenshots`, `run_responsive_suite` and `run_accessibility_audit` with per-project validation profiles (v0.3). The `frontend-agent` CLI (v0.4) installs all of it into a project. See `docs/superpowers/specs/2026-09-23-frontend-agent-kit-design.md` for the full roadmap.

## Install into a target project (CLI, v0.4)

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

(Without `npm link`: `node /path/to/frontend-agent-kit/packages/cli/bin/frontend-agent.mjs install …`, or `npm run frontend-agent -- install …` from the kit root — the latter resolves a relative `--project` from the shell's original working directory via `INIT_CWD`, e.g. `npm run frontend-agent -- install --project ../my-app`, not from the kit root that npm changes into.)

What `install` writes — only inside the target project:

| Host | Skills | Instructions | MCP servers |
|---|---|---|---|
| Claude Code | `.claude/skills/` | `CLAUDE.md` (managed block) | `.mcp.json` (`frontend-agent`, `figma`) |
| Codex | `.agents/skills/` | `AGENTS.md` (managed block) | `.codex/config.toml` (managed block) |

- Re-running `install` updates the kit's skills and never touches skills it didn't install; a kit skill you edited locally is kept and reported (`--force` overwrites it).
- Your own content in `CLAUDE.md`/`AGENTS.md`, other MCP servers, and anything outside the managed blocks is preserved. `--no-figma` skips the Figma server.
- `verify` checks the files and starts the MCP server to confirm the five tools respond. It exits 1 on any failure.
- `verify` also compares installed skill files with the kit: kit files newer than the installed copy fail the check (run install); local edits are reported but accepted.
- Claude Code asks you to approve project MCP servers from `.mcp.json` on first start. Codex loads `.codex/config.toml` only for trusted projects, so trust the project when Codex asks, and `verify` tells you when it isn't trusted yet.
- `.mcp.json` and `.codex/config.toml` contain absolute paths to your kit checkout. Keep them out of version control in shared repos.
- Cursor and VS Code adapters are stubs for now.

## Install into a target project (manual fallback)

From your target project's root:

```bash
mkdir -p .claude/skills .agents/skills
cp -r /path/to/frontend-agent-kit/skills/* .claude/skills/
cp -r /path/to/frontend-agent-kit/skills/* .agents/skills/
cp /path/to/frontend-agent-kit/integrations/claude/CLAUDE.md ./CLAUDE.md
cp /path/to/frontend-agent-kit/integrations/codex/AGENTS.md ./AGENTS.md
```

If `CLAUDE.md`/`AGENTS.md` already exist in the target project, merge the kit's workflow instructions manually instead of overwriting.

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
npx --workspace=packages/mcp-server playwright install chromium
```

The server resolves its **project root** — where it looks for `.frontend-agent/config.yml` and where `outputPath` for screenshots must stay inside — from the `FRONTEND_AGENT_PROJECT_ROOT` environment variable if set, otherwise from its own current working directory. Because the server is normally launched from the kit's own checkout (not from the target project), **always set `FRONTEND_AGENT_PROJECT_ROOT` explicitly to the target project's absolute path**, and use absolute paths for the launch command too — a plain `npx tsx packages/mcp-server/src/index.ts` resolved from a different cwd will not find the target project's config or be able to write into it.

Register it with `--scope user` so it's available in every project, pointing `FRONTEND_AGENT_PROJECT_ROOT` at whichever project you're validating:

Claude Code:

```bash
claude mcp add --scope user frontend-agent \
  -e FRONTEND_AGENT_PROJECT_ROOT=/absolute/path/to/target-project \
  -- /absolute/path/to/frontend-agent-kit/node_modules/.bin/tsx \
     /absolute/path/to/frontend-agent-kit/packages/mcp-server/src/index.ts
```

Codex CLI (`~/.codex/config.toml`):

```toml
[mcp_servers.frontend-agent]
command = "/absolute/path/to/frontend-agent-kit/node_modules/.bin/tsx"
args = ["/absolute/path/to/frontend-agent-kit/packages/mcp-server/src/index.ts"]
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

## Validate the kit's own skills

```bash
node scripts/validate-skill.mjs skills
```

Checks every `SKILL.md` has valid frontmatter (`name`, `description`) and a non-trivial body, and every `references/*.md` has the required frontmatter (`name`, `description`, `status`) and sections (`Princípio`, `Quando aplicar`, `Quando não aplicar`, `Exemplo`, `Fonte`).

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

- Claude Code: `claude -p … --strict-mcp-config --setting-sources project --permission-mode acceptEdits --allowedTools "Read(<ws>/**),Edit(<ws>/**),Write(<ws>/**),Glob(<ws>/**),Grep(<ws>/**),Skill,ToolSearch,mcp__frontend-agent,mcp__figma"` (no Bash; file tools are scoped to the workspace — a bare `Edit`/`Write` would let the agent write anywhere the invoking user can).
- Codex: `codex exec --json --ignore-user-config --sandbox workspace-write --ephemeral`, MCP servers passed with `-c` (no project trust needed) and their tools auto-approved.

Results land in `evals/results/<timestamp>/` (`report.md`, `summary.json`, transcripts). A timeout, a crash, a missing/unauthenticated host or a truncated transcript is `error`, never `pass`. `--keep` keeps the workspaces for inspection.

## v0.6 — shared engineering core

Seven provider-neutral skills (`engineering-architecture`, `repository-investigation`, `verification`, `root-cause-analysis`, `surgical-diff`, `context-efficiency`, `repo-memory`) now ship with the frontend skills, and `packages/core` provides deterministic project inspection, repo-memory freshness and a context audit. The frontend workflow, the `frontend-agent` CLI and the MCP tool names are unchanged; the managed instructions now also ask the agent to run the project's tests, typecheck and lint when configured. See `docs/context-efficiency.md` and `docs/superpowers/specs/2026-09-24-dev-agent-kit-evolution.md`.

## v0.7 — task orchestrator

The `task-orchestrator` skill runs a work item from any configured task source: it resolves the source, normalizes the item into one canonical `WorkItem`, keeps a local ledger under `.dev-agent/tasks/` and `.dev-agent/state/`, prepares a safe Git branch (fast-forward only, never on a dirty tree) and hands off to the domain skills. Sources are declared in `.dev-agent/config.yml` with a field mapping, so a new MCP-backed source needs no code. `packages/core` holds the deterministic parts: source resolution, the mapping engine, the generic MCP adapter, the config parser, the ledger, Git preparation, branch naming and resume validation. The `frontend-agent` CLI, the seven frontend skills and the MCP tool names are unchanged. See `docs/task-orchestrator.md`.

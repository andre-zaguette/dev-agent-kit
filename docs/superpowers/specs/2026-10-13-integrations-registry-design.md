# Integrations registry (dev-agent-kit v1.2, block E)

Date: 2026-10-13 · Status: draft for review · Parent: v1.2 decomposition (blocks A–E)

## Context

v1.2 is split into independent blocks, each with its own spec, plan and implementation:

| Block | Scope | Depends on |
|-------|-------|------------|
| **E** | Integrations registry: Figma (refactor), Headroom, claude-mem, Cartographer | none |
| D | A third host beyond Claude Code and Codex | E |
| A | Native task-source adapters (GitHub Issues, Linear, Jira) | none |
| C | Orchestrator improvements (ledger, review, PR, resume) | none |
| B | Stack skills (FastAPI, NestJS, Vue/Nuxt, Next.js) | none |

This spec covers **block E only**. OmniRoute was considered and dropped: it holds provider credentials and sees every prompt, and the gain for the kit is small today.

## Problem

Figma MCP is a special case: `McpConfig.includeFigma` is threaded through `cli.ts`, `types.ts` and each host adapter (`adapters/claude.ts`, `adapters/codex.ts`). Adding three more integrations the same way would triple the conditionals and make every future host (block D) re-implement them.

## Goals

1. Replace `includeFigma` with a registry of integrations. Figma becomes its first instance with **identical output**.
2. Add Headroom, claude-mem, Cartographer and Graphify as integrations.
3. Keep the kit's safety model: `dev-agent install` writes only inside the project and never installs software on the machine. `dev-agent verify` reports what is missing and prints the install command.
4. Keep `repo-index`, `repo similar`, `diff review` untouched. Cartographer is added beside them, not instead.

## Non-goals

- Installing claude-mem, Headroom or Cartographer (no `npx`, `uv`, `docker`, `/plugin` execution).
- Replacing `repo-index` with Cartographer. `repo-index` stays the deterministic, model-free, host-neutral base; Cartographer is a Claude Code-only semantic layer.
- A `dev-agent setup-machine` command (possible later, separate spec).
- OmniRoute.

## Findings from the tools' own docs (checked 2026-10-13)

These shape the design; the integrations differ more than expected.

| Tool | Project footprint | Machine footprint | Consequence |
|------|-------------------|-------------------|-------------|
| **Headroom** | MCP entry: Codex documents `[mcp_servers.headroom]`, `command = <abs path to headroom>`, `args = ["mcp", "serve"]`. The Claude Code `.mcp.json` form is **not documented**; the stdio entry with the same command/args is the working assumption. | `uv tool install "headroom-ai[all]"` (or `[mcp]` extra) | The only integration with a real project write. Needs an absolute binary path because MCP clients often do not inherit `PATH`. |
| **claude-mem** | **None documented.** Everything lives in `~/.claude-mem/` plus a hook launcher in `~/.local/bin/claude-mem`. | `npx claude-mem install` or `/plugin install claude-mem` | Verify-only integration. The kit writes nothing. |
| **Cartographer** | The plugin itself writes `docs/CODEBASE_MAP.md` and edits `CLAUDE.md` (markers **not documented**). | Plugin from marketplace `kingbootoshi/cartographer`; needs `tiktoken` | Verify-only. The kit must not write its own Cartographer block and must not collide with the plugin's `CLAUDE.md` edit. |

## Design

### Registry

New module `packages/cli/src/integrations/` with one file per integration and an `index.ts` registry.

```ts
export type IntegrationId = 'figma' | 'headroom' | 'claude-mem' | 'cartographer' | 'graphify';

export interface Integration {
  readonly id: IntegrationId;
  readonly hosts: readonly HostName[];   // hosts where it applies
  readonly defaultOn: boolean;           // figma: true; the others: false
  /** Best-effort, read-only, never throws. */
  detect(ctx: AdapterContext): Promise<Detection>;
  /** Pure: what to write inside the project for this host. Empty for verify-only integrations. */
  plan(host: HostName, ctx: AdapterContext, detection: Detection): Change[];
  verify(host: HostName, ctx: AdapterContext, detection: Detection): Check[];
  /** Install hints for what is missing on the machine. */
  notes(host: HostName, detection: Detection): string[];
}

export type Detection =
  | { state: 'present'; detail?: string; binPath?: string }
  | { state: 'absent' }
  | { state: 'unknown'; reason: string };

export type Change =
  | { kind: 'mcp-server'; name: string; config: McpServerConfig }
  | { kind: 'managed-block'; file: string; id: string; body: string };
```

`McpConfig` (host adapters' input) becomes `{ kitRoot, projectRoot, integrations: Integration[] }`. Host adapters apply `Change[]` generically: `mcp-server` into `.mcp.json` (Claude) or `.codex/config.toml` (Codex), `managed-block` into the host's instruction file. Adapters keep their existing preserve-user-content behavior (an existing entry with the same name is kept and reported).

### The five integrations

- **figma** (`defaultOn: true`, hosts claude, codex). `detect` is always `present` (remote HTTP server). `plan` returns the same `{ type: 'http', url: FIGMA_MCP_URL }` entry as today. Behavior and output do not change.
- **headroom** (`defaultOn: false`, hosts claude, codex).
  - `detect`: look up `headroom` on `PATH` (no execution beyond a path lookup).
  - `plan`: `mcp-server` named `headroom`, `command` = resolved absolute path, `args = ['mcp', 'serve']`.
  - Install-time rule: `--with headroom` when the binary is **not found** is a usage error (exit 1) with the install command. An entry pointing nowhere is worse than no entry.
  - `verify`: configured entry present and well-formed → `ok`; binary at the recorded path no longer exists → `warn`; entry malformed → `fail`.
- **claude-mem** (`defaultOn: false`, host claude only; Codex support is out of scope here).
  - `detect`: read-only checks of `~/.claude-mem/.worker.port` and `~/.local/bin/claude-mem`; if a port is recorded, one `GET http://127.0.0.1:<port>/api/health` with a 1 s timeout. No default port is assumed.
  - `plan`: empty (no project footprint).
  - `verify`: worker healthy → `ok`; launcher present but worker down, or not installed → `warn` with `npx claude-mem install`; nothing can `fail`.
- **cartographer** (`defaultOn: false`, host claude only).
  - `detect`: a skill/plugin directory named `cartographer` under `<project>/.claude/skills/` or `~/.claude/skills/`; otherwise `unknown` (plugin-managed installs have no documented location).
  - `plan`: empty. The kit writes nothing for Cartographer.
  - `verify`: skill found → `ok`; `docs/CODEBASE_MAP.md` present → extra `ok` ("map generated"); neither → `warn` with `/plugin marketplace add kingbootoshi/cartographer` and `/plugin install cartographer`.
  - `CLAUDE.md` coexistence: the kit's managed block is delimited by its own markers and `findManagedBlock` only ever replaces its own span. Cartographer's edit lives outside that span. Mitigation for unknown markers: a test that runs `install` on a `CLAUDE.md` containing arbitrary Cartographer-style text before and after the kit block and asserts it is preserved byte for byte.

- **graphify** (`defaultOn: false`, hosts claude, codex; verify-only).
  - Why Graphify and not Understand Anything: parsing is local (tree-sitter), no LLM tokens, which matches the deterministic spirit of `repo-index`. Understand Anything needs a paid LLM budget on large repos.
  - `detect`: `graphify` on `PATH` (path lookup only, no execution) → `present`; otherwise `absent`.
  - `plan`: empty. The kit writes nothing.
  - `verify`: binary found → `ok`; `graphify-out/GRAPH_REPORT.md` present → extra `ok` ("graph generated"); binary missing → `warn` with the install hint `uv tool install graphifyy` (PyPI package `graphifyy`, command `graphify`, Python 3.10+).
  - The kit never runs `graphify install`. That command registers a global `/graphify` skill, edits `CLAUDE.md` and adds PreToolUse hooks that steer Claude toward the graph before grep; those are machine-level changes and may compete with `repo-index`. The `notes` output says so, so the user opts in knowingly.

### CLI surface

```
dev-agent install [hosts] [--with <id>]... [--no-<id>]... [--no-figma]
```

- `--with <id>` enables a non-default integration; `--no-<id>` disables a default one. `--no-figma` keeps working exactly as today; it is simply the `--no-<id>` form applied to `figma` (no behavior change).
- `--with` on a host the integration does not support (for example `--with cartographer` with only `codex`) is a usage error, exit 1, naming the supported hosts.
- `dev-agent verify` checks the integrations the project has enabled. How "enabled" is known: install records the selected ids in a managed field of `.dev-agent/config.yml` under `integrations:`; verify reads that list. Projects with no list behave as today (Figma only).
- `install` never executes an installer. It prints `notes` for anything missing.

### Check states and exit codes

| State | Meaning | Exit |
|-------|---------|------|
| `ok` | Project config correct and tool present | 0 |
| `warn` | Project config correct (or nothing to configure) but the tool is missing or unhealthy on this machine | 0, with install note |
| `fail` | Project config broken: invalid JSON/TOML, malformed entry, corrupted managed block | 2 |

A missing tool is `warn` because the kit does not install software and the checkout may run on another machine or in CI. Only configuration the kit wrote (or should have written) can fail `verify`.

### Safety

- Every `Change` target goes through the existing `assertInsideRoot`.
- Host `preflight` runs `plan` for all selected integrations as a dry run. Any failure aborts before anything is written, in every host (fail closed, as today).
- `detect()` never throws and never writes. Detection reads outside the project (`~/.claude-mem`, `~/.claude/skills`) are read-only and limited to the paths above; this is the only code that reads outside the project root, and it lives in the integration, not in the host adapters.
- Network access is limited to one loopback request (`127.0.0.1`) in the claude-mem health check.
- Existing user MCP entries and instruction content are preserved, as today.

## Error handling

| Situation | Behavior |
|-----------|----------|
| `--with <unknown id>` | exit 1, list valid ids |
| `--with headroom`, binary not found | exit 1, print `uv tool install "headroom-ai[all]"` |
| `--with <id>` unsupported on selected host | exit 1, name supported hosts |
| Existing `headroom` MCP entry | kept, reported as "already configured" |
| Unparseable `.mcp.json` / `.codex/config.toml` | preflight error, nothing written (unchanged) |
| claude-mem port file missing or health check times out | `warn`, never `fail` |

## Testing

1. **Figma regression first.** Snapshot `.mcp.json`, `.codex/config.toml` and `CLAUDE.md`/`AGENTS.md` produced by `install` on the current code; after the refactor the output must be byte-identical. This test lands and passes before any new integration.
2. **Per integration:** `plan` on a temp project produces the expected change, is idempotent (two runs, no duplicates) and preserves user entries.
3. **Safety:** a path escaping the project root is rejected; invalid JSON aborts preflight with nothing written in any host.
4. **Verify:** one case per state (`ok`, `warn`, `fail`) per integration, with `detect` stubbed so no real tool is needed. claude-mem health is tested against a local stub HTTP server.
5. **CLI:** `--with`, `--no-<id>`, `--no-figma` alias, unsupported-host error, unknown-id error, Headroom-not-found error.
6. **CLAUDE.md coexistence:** Cartographer-style text around the kit block survives `install` and a second `install` unchanged.

Not automated (manual checklist in the plan, because the tools move quickly): real installs of claude-mem, Cartographer and Headroom, and confirming the Headroom entry loads in Claude Code.

## Open items to settle during implementation

1. **Claude Code form of the Headroom entry.** Codex's `[mcp_servers.headroom]` is documented; the `.mcp.json` equivalent is assumed (`command` + `args`, stdio). Confirm with `headroom mcp install` output or `server.json` before release.
2. **Cartographer detection for marketplace installs.** No documented plugin location. Until confirmed, `unknown` plus the `docs/CODEBASE_MAP.md` signal is the fallback.
3. **`integrations:` field in `.dev-agent/config.yml`.** *Resolved 2026-10-13:* `parseDevAgentConfig` rejects any top-level key outside `TOP_LEVEL_KEYS` ("is not a recognized setting"), so the field needs real support: add `integrations` to `TOP_LEVEL_KEYS`, a `parseIntegrations` that accepts a list of known ids (unknown id → config error naming valid ids), and `integrations: IntegrationId[]` in `DevAgentConfig` (default `[]`, meaning Figma only, as today). Projects without the key parse unchanged. Consequence: a project whose config lists `integrations:` fails on a CLI older than v1.2, which is acceptable for an opt-in field but goes in the release notes. Still to confirm in the plan: whether `install` already writes `config.yml`; if not, it only writes the file when at least one non-default integration is selected, preserving existing content and comments.

4. **Graphify canonical source.** Search results disagree on the GitHub owner (several forks and organizations share the name). Only the PyPI name `graphifyy` is used in the spec. Before release, confirm the official repository and that the PyPI package belongs to it (typosquatting risk), and read what `graphify install` writes before documenting it.

## Out of scope for this spec

Blocks A, B, C and D, each with its own spec. Block D reuses this registry for the third host.

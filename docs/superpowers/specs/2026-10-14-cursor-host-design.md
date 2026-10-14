# Cursor as the third host (dev-agent-kit v1.2, block D)

Date: 2026-10-14 · Status: draft for review · Parent: v1.2 decomposition (blocks A–E) · Depends on: block E (integrations registry, merged)

## Context

`dev-agent install` and `verify` support two real hosts, Claude Code and Codex. `HostName` already lists `cursor` and `vscode`, and `ALL_HOSTS` accepts them, but both are `StubAdapter`s that throw "not supported yet". Block D turns **Cursor** into a real host. VS Code stays a stub.

## What Cursor reads (official docs, checked 2026-10-14)

Source: cursor.com/docs/context/{rules,mcp,skills}. Cursor is not installed on the machine where this spec was written, so none of this was exercised in a real Cursor.

| Piece | Cursor behavior | What the kit already writes |
|-------|-----------------|-----------------------------|
| Skills | Reads `.agents/skills/` and `.cursor/skills/` (project), the same two under `~` (user), and for compatibility `.claude/skills/` and `.codex/skills/`. A skill is a folder with `SKILL.md`. | Codex adapter: `.agents/skills/` |
| Instructions | Supports `AGENTS.md` in the project root and subdirectories (plain markdown, no metadata). Project rules live in `.cursor/rules/*.mdc` and need frontmatter; a plain `.md` there is ignored. | Codex adapter: `AGENTS.md` managed block |
| MCP | Project config `.cursor/mcp.json`, global `~/.cursor/mcp.json`. Top-level `mcpServers`. Stdio entries: `type` (required by the docs), `command`, optional `args`, `env`, `envFile`. Remote entries: `url`, optional `headers`. `${env:NAME}`, `${userHome}`, `${workspaceFolder}` are interpolated. The docs describe no approval step for project servers, only per-tool-call approval. | nothing |

Consequence: skills and instructions can be shared with the Codex adapter; the only new project file is `.cursor/mcp.json`.

## Decisions (made with the project owner on 2026-10-14)

1. **Target host: Cursor.** (VS Code, Gemini CLI, OpenCode were the alternatives.)
2. **Share skills and instructions with Codex**: `.agents/skills/` and the `AGENTS.md` managed block, not `.cursor/skills/` and `.cursor/rules/*.mdc`.
3. **`--all` keeps its current meaning (claude + codex).** Cursor is selected by naming it (`install cursor`) or by detection when no host is named.

## Goals

1. `dev-agent install cursor` and `dev-agent verify cursor` behave like they do for `claude` and `codex`: fail-closed preflight, preserve user content, idempotent, nothing written outside the project.
2. Installing `codex` and `cursor` together (either order, any number of times) produces no conflicts and no duplicate content.
3. The integrations from block E work on Cursor where their entry shape is documented.
4. Output for `claude` and `codex` (including `install --all`) stays byte-identical.

## Non-goals

- `.cursor/rules/*.mdc` and `.cursor/skills/` (decision 2).
- A VS Code adapter (stays a stub).
- Writing the user-level `~/.cursor/mcp.json`; the kit writes only inside the project.
- Using `${workspaceFolder}` to make `.cursor/mcp.json` portable. The file holds absolute paths to the kit checkout and the project, like `.mcp.json` and `.codex/config.toml`; the notes say to keep it out of version control in shared repos.
- Verifying that a real Cursor loads the file (manual checklist, below).

## Design

### Files

- **Create `packages/cli/src/mcp-json.ts`**: shared helpers for a JSON file with a top-level `mcpServers` object.
  - `readMcpJsonFile(file: string): McpJson`: the logic now private to `ClaudeCodeAdapter.readMcpJson` (missing file → `{}`; unparsable, non-object, or non-object `mcpServers` → `Error('frontend-agent: ...')`) with the **same messages**.
  - `applyExtraServers(servers, extras, file): string[]`: for each `McpServerChange`, keep an existing entry (action `"<name> MCP server already configured in <file> — kept"`) or add it (`"<name> MCP server registered in <file>"`, plus ` (<hint>)` when present). Same action strings the Claude adapter emits today.
  - `ClaudeCodeAdapter` is refactored to call them. Its behavior and messages do not change.
- **Create `packages/cli/src/adapters/cursor.ts`**: `CursorAdapter implements HostAdapter`, standalone like the other two.
- **Modify `adapters/index.ts`**: `createAdapter('cursor')` returns `CursorAdapter`; `REAL_HOSTS = ['claude', 'codex', 'cursor']` (every supported host; used for detection); new `ALL_FLAG_HOSTS = ['claude', 'codex']` (what `--all` selects); `ALL_HOSTS` unchanged.
- **Modify `adapters/stub.ts`**: `StubAdapter` only for `'vscode'`.
- **Modify `cli.ts`**: `--all` uses `ALL_FLAG_HOSTS`; `HELP` text; the "no supported host detected" error mentions cursor. `dev-cli.ts` `DEV_HELP` likewise.
- **Modify the integrations** (`figma.ts`, `headroom.ts`, `graphify.ts`): see below.

### `CursorAdapter`

| Member | Behavior |
|--------|----------|
| `name` / `supported` | `'cursor'` / `true` |
| `skillsDir` | `<project>/.agents/skills` (shared with Codex) |
| `instructionsFile` | `<project>/AGENTS.md` (shared with Codex) |
| `mcpFile` | `<project>/.cursor/mcp.json` |
| `detect()` | `~/.cursor` exists, or `cursor` is on `PATH`. Best-effort: the binary and directory names come from general knowledge of Cursor, not from the docs; `install cursor` named explicitly always works. |
| `preflight(config)` | `assertRealDirInsideRoot(skillsDir)`, `readManifest(skillsDir)`, `preflightMarkdownFile(AGENTS.md)`, `assertRealDirInsideRoot(<project>/.cursor)`, `assertInsideRoot(mcpFile)`, and a dry parse of the JSON (`readMcpJsonFile`). Writes nothing. |
| `installSkills(src)` | `syncSkills(src, skillsDir, ...)` exactly as Codex. |
| `installInstructions()` | `upsertMarkdownBlock(AGENTS.md, instructionsContent(ctx, 'codex'))`. The Codex template only points at `.agents/skills/` and never names Codex, so it is valid for Cursor; using the same text keeps both hosts from rewriting each other's block. |
| `installMcp(config)` | `mkdir .cursor`, then write `mcpServers['frontend-agent'] = { type: 'stdio', command, args, env }` plus `applyExtraServers`. Other servers and top-level keys are preserved. |
| `configuredServers()` | `readMcpJsonFile(mcpFile).mcpServers`, `null` on error. |
| `verify()` | `checkSkills(skillsDir, kit skills)`, `checkInstructions(AGENTS.md)`, `mcp-config` (`checkLaunchConfig` against `.cursor/mcp.json`), `mcp-server` (`probeServer`). No trust check (the docs describe none). |
| `notes()` | Cursor loads `.cursor/mcp.json` for the project and asks for approval before using MCP tools. The file holds absolute paths to this kit checkout and the project; keep it out of version control in shared repos. Skills and `AGENTS.md` are shared with Codex. |

Sharing is safe because both adapters call `syncSkills` with the same source and version and write the same `AGENTS.md` block text: the second run reports "unchanged". `--force` behaves as today.

### Integrations on Cursor

| Integration | Hosts after block D | Cursor entry |
|-------------|---------------------|--------------|
| `figma` | claude, codex, **cursor** | `{ url: FIGMA_MCP_URL }` (remote form, as for Codex; no authentication hint, none is documented for Cursor) |
| `headroom` | claude, codex, **cursor** | `{ type: 'stdio', command: <abs>, args: ['mcp','serve'] }` (the Claude shape, which matches the documented Cursor stdio schema). The "binary moved" hint names `.cursor/mcp.json` and, as on Claude, says to remove the entry before re-running install (existing entries are kept). |
| `claude-mem` | claude | unchanged |
| `cartographer` | claude | unchanged |
| `graphify` | claude, codex, **cursor** | verify-only |

A `--with <id>` on `cursor` alone for an integration that does not list it (for example `--with claude-mem`) is the existing usage error naming the supported hosts.

### CLI behavior

- `dev-agent install cursor [--with ...] [--no-figma] [--force] [--project <dir>]` and `verify cursor`.
- No host named: install/verify use every **detected** host among `claude`, `codex`, `cursor`. A machine with Cursor installed now also gets Cursor on a plain `install`; this follows from detection and is called out in the release notes.
- `--all`: still `claude` + `codex` only.
- `unknown host "x" (expected one of: claude, codex, cursor, vscode)`; `install vscode` still fails with "not supported yet".
- Fail-closed across hosts is unchanged: preflight runs for every selected host before any host writes.

### Safety

- Every write goes through `assertInsideRoot` / `assertRealDirInsideRoot`; a `.cursor` symlink pointing outside the project is refused before anything is written, in any host.
- The kit never writes `~/.cursor`. `detect()` only checks that it exists.
- An existing user entry with the same name in `.cursor/mcp.json` is kept and reported.

## Testing

1. **Unchanged output first.** The existing golden tests for `install --all` and `--no-figma` must keep passing without any fixture change (proves decision 3 and goal 4). This is checked before and after the `mcp-json.ts` refactor of the Claude adapter, together with the existing Claude adapter tests.
2. **New golden:** `install cursor` (files `.cursor/mcp.json`, `AGENTS.md`, stdout) with the same path normalization.
3. **Adapter tests (`cursor-adapter.test.ts`):** detect (home dir, `PATH`, neither); `installMcp` creates `.cursor/` and the file, merges into an existing file keeping other servers and a same-name extra, refuses unparsable JSON and a non-object `mcpServers`; `.cursor` symlink outside the project is refused; `verify` states (all ok; missing skills; missing entry; broken JSON).
4. **Sharing with Codex:** `install codex` then `install cursor` and the reverse, then a repeat: `AGENTS.md` and `.agents/skills/` identical after each run, `verify` ok for both, the manifest not rewritten.
5. **`mcp-json.ts` unit tests** for the helper (the same cases the Claude adapter tests cover, now at the helper level).
6. **CLI tests:** `install cursor` end to end; `--all` creates no `.cursor/`; detection with `~/.cursor` present picks up Cursor; unknown-host error lists cursor; `install vscode` still fails; `--with claude-mem` with `cursor` only is a usage error.
7. **Integrations on Cursor:** figma entry shape; headroom entry shape, kept user entry, sticky re-install, verify ok/warn/fail; graphify verify.
8. **Docs:** `docs.test.ts` stays green with the new help text.

Manual checklist (not automated, Cursor is not available on the dev server): open a project installed with `install cursor` in a real Cursor and confirm (a) the `frontend-agent` server loads from `.cursor/mcp.json`, (b) the skills in `.agents/skills/` are listed, (c) `AGENTS.md` is picked up, (d) `headroom` loads when installed with `--with headroom`, (e) the detection heuristic matches a real installation.

## Open items

1. **Cursor detection.** `~/.cursor` and the `cursor` binary are assumptions (see `detect`); confirm on a real install and adjust.
2. **`type` on the Figma remote entry.** The docs show remote entries with `url` only; the kit follows that. If Cursor requires a `type`, add it.
3. **Loading in a real Cursor** (checklist above).

## Out of scope

Blocks A, B and C, each with its own spec. VS Code stays a stub.

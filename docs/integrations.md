# Integrations

## What an integration is

An integration is an optional tool the kit knows how to wire into a project or check on the machine. The kit never installs software: `install` writes only inside the project and prints what is missing, and `verify` reports it.

## Available integrations

| id | Hosts | What the kit writes | How `verify` checks it | Install command |
|---|---|---|---|---|
| `figma` (default on) | claude, codex, cursor | The remote HTTP MCP server entry, as before | Not checked by `verify` | none (remote server) |
| `headroom` | claude, codex, cursor | An MCP entry `headroom` with the absolute path of the binary and `mcp serve` args | Entry present and well-formed: ok. Binary at the recorded path gone: warn. Entry missing and the binary absent from this machine: warn. Entry missing while the binary is present, or entry malformed: fail | `uv tool install "headroom-ai[all]"` |
| `claude-mem` | claude | Nothing | Worker health on loopback (`127.0.0.1`): ok. Launcher present but worker down, or not installed: warn | `npx claude-mem install` |
| `cartographer` | claude | Nothing | Skill found: ok. `docs/CODEBASE_MAP.md` or `.cartographer/manifest.json` (v2 index) present: extra ok. None of them: warn | `/plugin marketplace add kingbootoshi/cartographer` then `/plugin install cartographer` |
| `graphify` | claude, codex, cursor | Nothing | Binary on `PATH`: ok. `graphify-out/GRAPH_REPORT.md` present: extra ok. Binary missing: warn | `uv tool install graphifyy` |

Notes:

- `--with headroom` when the `headroom` binary is not on `PATH` is a usage error (exit 1) that prints the install command. The Claude entry (`{"type":"stdio","command":"<abs path>","args":["mcp","serve"]}`) was checked on 2026-10-14 against Headroom 0.40.0: it is the same entry `headroom mcp install` writes (that command writes it to the user scope, `~/.claude.json`, while the kit writes it to the project's `.mcp.json`), and the server started from that entry answered with the tools `headroom_compress`, `headroom_retrieve` and `headroom_stats`. Registering the server is not enough to compress anything: Headroom also needs `headroom proxy` running and `ANTHROPIC_BASE_URL` pointing at it (see Headroom's own docs). The `[mcp]` extra (`uv tool install "headroom-ai[mcp]"`) is enough for `mcp serve`. The Cursor entry has the same typed stdio shape as the Claude one. As on Claude, an existing entry is kept, so if the binary moved, remove the `headroom` entry from `.cursor/mcp.json` before re-running `install --with headroom`.
- The Cursor entries follow Cursor's documented MCP schema but were not exercised in a real Cursor.
- Confirm the Graphify install source before using it; the kit does not point to a repository for it.

## Selecting integrations

```bash
dev-agent install claude --with headroom
dev-agent install --all --with graphify --no-figma
```

`--with <id>` enables an integration that is off by default; `--no-<id>` disables one that is on. `--no-figma` keeps working as before. An unknown id exits 1 and lists the valid ones. `--with` on a host that does not support the integration (for example `--with cartographer` with only `codex`) exits 1 and names the supported hosts.

## Verify states

| State | Meaning | Exit |
|---|---|---|
| `ok` | Project config is correct and the tool is present | 0 |
| `warn` | Project config is correct (or there is nothing to configure) but the tool is missing or unhealthy on this machine | 0, with an install note |
| `fail` | Project config is broken: invalid JSON/TOML, a malformed entry, or a missing entry whose tool is present | 1 |

A missing tool is only a warning because the kit does not install software and the checkout may run on another machine or in CI. Only configuration the kit wrote (or should have written) can fail `verify`.

## State file

`install` records the selected ids in `.dev-agent/integrations.json` (`{"enabled": [...]}`). `verify` checks the integrations listed there; a project without the file gets no integration checks. The selection is sticky: a later `install` without flags keeps the ids recorded earlier, and `install` does not re-require the tool for an id recorded earlier (`verify` still warns when it is missing). Only `--no-<id>` drops one. `--no-<id>` for a default-on integration (for example `--no-figma`) is not sticky: repeat it on each install. Dropping an id never removes an entry from `.mcp.json`; existing entries there are only ever kept. Codex is different: its managed block in `.codex/config.toml` is regenerated on every install, so `install codex --no-headroom` (or re-installing without the `headroom` binary on `PATH`) removes the headroom entry from `.codex/config.toml`.

## Safety

- Every file an integration writes goes through the same project-root check as the rest of the installer.
- Before anything is written, the selected integrations are planned as a dry run for every host. Any failure aborts the whole install (fail closed).
- Detection never throws and never writes. The only reads outside the project are read-only and limited to `~/.claude-mem`, `~/.claude/skills`, `~/.local/bin/claude-mem` and the directories on `PATH` (stat only, used to find `headroom` and `graphify`; nothing is executed).
- The only network access is one loopback request (`127.0.0.1`) in the claude-mem health check.
- Existing user MCP entries and instruction content are preserved.
- The kit never runs `graphify install` or any other graphify command. Per the official README, `graphify install` registers the skill, `graphify claude install` adds an always-on config plus a hook that steers Claude toward the graph before search-style tool calls, and `graphify hook install` adds git hooks. Those are machine-level changes and may compete with `repo index`, so run them only if you want that. The official source is the `Graphify-Labs/graphify` repository (its README names the PyPI package `graphifyy` and warns that other `graphify*` packages are not affiliated).

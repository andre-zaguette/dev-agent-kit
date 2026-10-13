# Integrations

## What an integration is

An integration is an optional tool the kit knows how to wire into a project or check on the machine. The kit never installs software: `install` writes only inside the project and prints what is missing, and `verify` reports it.

## Available integrations

| id | Hosts | What the kit writes | How `verify` checks it | Install command |
|---|---|---|---|---|
| `figma` (default on) | claude, codex | The remote HTTP MCP server entry, as before | The entry is present and well-formed | none (remote server) |
| `headroom` | claude, codex | An MCP entry `headroom` with the absolute path of the binary and `mcp serve` args | Entry present and well-formed: ok. Binary at the recorded path gone: warn. Entry malformed: fail | `uv tool install "headroom-ai[all]"` |
| `claude-mem` | claude | Nothing | Worker health on loopback (`127.0.0.1`): ok. Launcher present but worker down, or not installed: warn | `npx claude-mem install` |
| `cartographer` | claude | Nothing | Skill found: ok. `docs/CODEBASE_MAP.md` present: extra ok. Neither: warn | `/plugin marketplace add kingbootoshi/cartographer` then `/plugin install cartographer` |
| `graphify` | claude, codex | Nothing | Binary on `PATH`: ok. `graphify-out/GRAPH_REPORT.md` present: extra ok. Binary missing: warn | `uv tool install graphifyy` |

Notes:

- `--with headroom` when the `headroom` binary is not on `PATH` is a usage error (exit 1) that prints the install command. The Claude `.mcp.json` form of the Headroom entry is an assumption that still needs a manual check against a real install.
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
| `fail` | Project config is broken: invalid JSON/TOML, a malformed or missing entry | 1 |

A missing tool is only a warning because the kit does not install software and the checkout may run on another machine or in CI. Only configuration the kit wrote (or should have written) can fail `verify`.

## State file

`install` records the selected ids in `.dev-agent/integrations.json` (`{"enabled": [...]}`). `verify` checks the integrations listed there; a project without the file gets no integration checks. The selection is sticky: a later `install` without flags keeps the ids recorded earlier, and a recorded id is not checked against the machine again. Only `--no-<id>` drops one. Dropping an id never removes an entry already written to `.mcp.json` or `.codex/config.toml`; the adapters never remove entries.

## Safety

- Every file an integration writes goes through the same project-root check as the rest of the installer.
- Before anything is written, the selected integrations are planned as a dry run for every host. Any failure aborts the whole install (fail closed).
- Detection never throws and never writes. The only reads outside the project are read-only and limited to `~/.claude-mem` and `~/.claude/skills`.
- The only network access is one loopback request (`127.0.0.1`) in the claude-mem health check.
- Existing user MCP entries and instruction content are preserved.
- The kit never runs `graphify install`. That command registers a global `/graphify` skill, edits `CLAUDE.md` and adds PreToolUse hooks that steer Claude toward the graph before grep. Those are machine-level changes and may compete with `repo index`, so run it only if you want that.

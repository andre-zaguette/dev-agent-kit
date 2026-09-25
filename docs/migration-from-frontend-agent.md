# Migrating from `frontend-agent`

v1.0.0 turns the frontend-only kit into Dev Agent Kit. **Nothing you use today was removed.** This page lists what changed, what did not, and how to upgrade.

## What did not change

- `frontend-agent install` and `frontend-agent verify` work as before, with the same flags and exit codes (`0` ok, `1` on a failed check).
- The seven frontend skills keep their names: `figma-to-code`, `component-selection`, `frontend-design`, `responsive-design`, `motion-design`, `accessibility`, `visual-validation`.
- The five MCP tools keep their names, and the server is still registered as `frontend-agent`.
- `.frontend-agent/config.yml` (`validationProfile`, `profiles`, `breakpoints`, `allowedHosts`) keeps working and is still read by the MCP server.
- The 36 offline eval scenarios stay valid.

## What changed

- The package is now `dev-agent-kit` and installs three commands: `dev-agent`, `frontend-agent` and `frontend-agent-kit`. The last two are compatibility aliases.
- `dev-agent` is the new CLI. `dev-agent install` and `dev-agent verify` are aliases of the `frontend-agent` commands; it adds `inspect`, `context audit`, `sources`, `task`, `contract`, `repo` and `diff review`.
- Project configuration for the new features lives in `.dev-agent/config.yml` (task sources, base branch, branch pattern, directories). It coexists with `.frontend-agent/config.yml`; neither replaces the other.
- New skills (shared engineering, task orchestrator, backend, fullstack) are installed alongside the frontend ones; the managed block in `CLAUDE.md`/`AGENTS.md` mentions them.

## Command mapping

| Before | Now (either works) |
|---|---|
| `frontend-agent install --project <dir>` | `dev-agent install --project <dir>` |
| `frontend-agent verify --project <dir>` | `dev-agent verify --project <dir>` |
| `frontend-agent-kit ...` | `dev-agent ...` |

## Upgrade steps

1. Install the new package (`npm install -g dev-agent-kit-1.0.0.tgz`, or update your checkout and run `npm install`).
2. In each project run `dev-agent install --project <dir>`. It updates the kit's skills and managed blocks, never touches skills it did not install, and keeps a kit skill you edited locally and reports it. Add `--force` only if you want your local edits overwritten.
3. Run `dev-agent verify --project <dir>`.
4. Optional: create `.dev-agent/config.yml` to use task sources (see [generic-mcp.md](generic-mcp.md)).
5. Re-check `.mcp.json`/`.codex/config.toml`: they hold absolute paths to the kit. If you moved from a checkout to a global install, rerunning `install` rewrites them.

## Rolling back

Reinstall the previous version of the kit and run its `install`; the managed blocks are replaced in place and your own content is untouched. The v0.11.0 tag and earlier remain on GitHub.

## Deprecation policy

`frontend-agent` is a permanent compatibility alias, with **no removal date**. If it is ever removed, that release will ship with a migration plan and a documented transition window.

# Task orchestrator (v0.7)

Work from any task source with one workflow. The `task-orchestrator` skill drives it; `packages/core` provides the deterministic pieces so the behavior does not depend on prompt wording.

## What ships

- A canonical `WorkItem` model. Every source is normalized into it, so the rest of the kit never sees a source-specific payload.
- Source resolution: explicit source, then identifier patterns, then the default source, then an opt-in bounded probe. Two matching sources are reported as ambiguous instead of guessed.
- A declarative `generic-mcp` adapter: tool names plus a field mapping in `.dev-agent/config.yml`.
- A task ledger (`.dev-agent/tasks/<KEY>.md`) and machine state (`.dev-agent/state/<KEY>.json`), updated at checkpoints, with resume validation against the branch and base commit.
- Safe Git preparation: refuse a dirty tree, fetch, fast-forward the base only, create the task branch, record the base SHA. Branch names come from config, instruction files, the remote's existing pattern, or a fallback.

## Configuration

```yaml
baseBranch: main
branchPattern: "{type}/{keyLower}-{slug}"

taskSources:
  company:                       # any lowercase alias
    adapter: generic-mcp
    server: company-tasks        # MCP server name
    default: true                # at most one
    identifiers:
      - '^HEF-\d+$'              # single quotes, one backslash
    tools:
      get: { name: get_issue, arg: key }
      comments: { name: get_comments, list: comments }
    mapping:
      key: key
      title: summary
      description: description
      status: status.name
```

Another source with a completely different payload only changes `mapping`:

```yaml
    mapping: { id: ticket_id, key: reference, title: subject, description: body, status: state }
```

The tests exercise two such sources with different schemas and require that they normalize to the same `WorkItem`.

## Several repositories

With a `workspaces:` map the ledger, state and contract live at the workspace root, the `Workspaces` section lists one step per repository in dependency order, and resume checks each recorded workspace. See `docs/workspaces.md`.

## Safety

- Work-item text is untrusted data. It is quoted in the ledger and can never create or overwrite a ledger section, a path or a Git ref.
- Reading a source never authorizes writing to it; every adapter reports `write: false`.
- Ledger, state and config never hold credentials; writes that look like they contain a secret are refused, as are symlinked directories.
- Git preparation never resets, cleans, rebases, stashes or pushes.

## Not in v0.7

- CLI commands (`dev-agent sources`, `dev-agent task resolve|status|show`): planned for v0.9. Until then the skill's references describe the same rules for the agent, and the modules in `packages/core` are the deterministic reference implementation.
- Mock task-source MCP servers, orchestrator benchmark scenarios and their graders: they need a real-host benchmark run. Resolution, ambiguity, normalization equivalence and Git fixtures are covered by offline tests in `packages/core`.
- Loading custom adapters from `integrations/task-sources/`, and write operations on sources.

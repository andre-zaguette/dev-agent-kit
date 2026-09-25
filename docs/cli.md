# The dev-agent CLI (v0.9)

`dev-agent` makes the deterministic parts of the kit callable from a terminal. It never runs a model, opens a network connection or changes Git; a natural-language task still runs in Claude Code or Codex. `frontend-agent` is unchanged.

Exit codes: `0` ok, `1` usage or environment error, `2` checked and not OK.

| Command | What it does |
|---|---|
| `install`, `verify` | Aliases of `frontend-agent install` and `frontend-agent verify`, with identical behavior and output. |
| `inspect [--json]` | Detected languages, frameworks, commands, database, queues, cache, Docker, base branch, and the backend references that apply. |
| `context audit [--json]` | Always-on token size and the findings that waste context. |
| `sources [--json]` | The task sources configured in `.dev-agent/config.yml`. |
| `sources verify` | Checks the config parses, each `generic-mcp` adapter builds, and warns about ambiguous patterns, missing defaults and adapters that cannot be loaded. Exit 2 on errors. |
| `task resolve <id> [--source s] [--probe]` | Which source an identifier resolves to, or why it does not (ambiguous, unknown, unresolved). |
| `task status <KEY>` | Whether the repository still matches the task's saved state (branch, base commit, stale knowledge). Exit 2 with the reasons to reconcile. |
| `task show <KEY>` | Prints the task ledger. |
| `contract show <KEY>` | Prints the persisted API contract. |
| `contract verify <KEY> --exchange f... --openapi f` | Checks captured exchanges and an OpenAPI description against the contract. |
| `contract usage <KEY> --client dir... [--strict]` | Text evidence that client source calls the route with the contract's method and handles its error codes. Prints `files` (route called with the method), `path only` (route mentioned, method not confirmed) and `unhandled error codes`. Exit 2 when no file calls it with the method; `--strict` also requires every error code to be mentioned. |
| `repo index [--write]` | A bounded, path-only map of the repository: layers by role, features, naming and test conventions. `--write` regenerates the derived knowledge files (repository, commands, architecture, backend/frontend) stamped with the source SHA; needs a commit. |
| `repo similar <words...> [--limit n]` | The existing features closest to a described change, with their files grouped by role. Read them and copy their structure. |
| `diff review [--base ref]` | Reviews the branch (merge-base with the base branch, plus the working tree): edited migrations and secrets in added lines are errors (exit 2); dependency, lockfile, missing-test, generated-file and new-directory findings are warnings or notes. Secret values are never printed. |

Evidence files (`--exchange`, `--openapi`) must be regular files of at most 5 MB. `--client` directories must be directories inside the project (`.` means the project root); symlinks are skipped and `node_modules`, `.git`, `dist`, `build` and `coverage` are not scanned.

Every command accepts `--project <dir>` (default: the current directory) and, where it prints results, `--json`.

`install` and `verify` keep the exit codes of `frontend-agent` (1 when a check fails).

Not in this version: `repo index` and `diff review`.

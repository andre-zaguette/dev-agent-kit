# Workspaces (v1.1)

One workspace root holds several projects, each its own Git repository, so a single work item can span them. The root is a plain folder, not a repository.

```text
altave/   cloud-back  cloud-front  edge-back  edge-front
pumpkin/  models  backend  policy-api  client  admin
```

## Configuration

`.dev-agent/config.yml` at the root gains a `workspaces:` map. Without it every command behaves as in v1.0.

```yaml
workspaces:
  models:     { path: models, role: library }
  backend:    { path: backend, role: backend, dependsOn: [models] }
  policy-api: { path: policy-api, role: api, dependsOn: [backend] }
  client:     { path: client, role: frontend, dependsOn: [policy-api], baseBranch: develop }
```

| Key | Meaning |
|---|---|
| `path` | Required. Relative POSIX path inside the root. No `..`, no absolute path, no symlink at or above it, no two workspaces equal or nested. |
| `role` | Optional: `library`, `backend`, `api`, `frontend`, `infra`, `other`. |
| `dependsOn` | Optional list of workspace names this one needs. Self-dependencies, unknown names and cycles are errors. |
| `baseBranch` | Optional base for `diff review`; falls back to the root's `baseBranch`. |

Names match `^[a-z][a-z0-9-]{0,31}$`, `all` is reserved, and at most 30 workspaces are allowed. An unknown key or a malformed value is a parse error, never a silent default.

## Where things live

The ledger (`.dev-agent/tasks/<KEY>.md`), the state and the contract stay at the root, so they never land in a commit. The state holds each workspace's base branch, base SHA, working branch and status; the ledger's `Workspaces` section lists the steps in dependency order. The agent uses one branch name per work item in every touched repository and creates the branches with the safe procedure in `skills/task-orchestrator/references/git-workflow.md`. The CLI only reports.

## Commands

```bash
dev-agent workspaces --project <root>
dev-agent workspaces verify --project <root>
dev-agent workspaces order --only client --with-deps --project <root>
dev-agent diff review --workspace all --project <root>
dev-agent inspect --workspace backend --project <root>
```

- `workspaces`: one row per workspace in dependency order: path, role, `dependsOn`, detected languages and frameworks, and its Git state (`repo` with branch and clean or dirty, `not a repository`, `missing`).
- `workspaces verify`: each path is a real directory (exit 2 otherwise), each is a repository (a warning if not), and one `pin` line per `dependsOn` edge.
- `workspaces order [--only a,b] [--with-deps]`: the implementation order, one name per line. Dependencies come first, ties alphabetical; `--with-deps` adds what a change needs only when asked.
- `--workspace <name>` on `inspect`, `repo index`, `repo similar` and `diff review` runs the command inside that workspace. `--workspace all` exists only for `diff review`: it reviews every repository, prints `skipped <name>: not a repository` for the others and exits 2 if any review has an error, 1 if none could be reviewed.
- `task status <KEY>` prints a report per recorded workspace.

## Version pins

`workspaces verify` reads `pyproject.toml` (`[project]` or `[tool.poetry]`) or `package.json` and reports, for each `dependsOn` edge:

| Status | Meaning |
|---|---|
| `ok` | The dependency's current version satisfies the dependent's constraint. |
| `behind` | The dependency is newer than the constraint allows: the dependent must bump its pin. |
| `ahead` | The dependent needs a version that is not released yet: publish first. |
| `not-declared` | The dependent does not list the package. |
| `unknown` | A form the parser does not understand (`!=`, ranges with commas, `*`, markers, URL, path or git dependencies, pre-release versions) or a missing manifest or version. Never reported as `ok`. |

Understood constraints: `==x.y.z`, `>=x.y.z`, `~=x.y[.z]`, `^x.y.z`, `~x.y.z` and a bare `x.y.z`. Credentials in a dependency specifier are never printed. Pins are checked, not changed, and publishing a package version is always a stop-and-ask.

## Contract between services

An API contract may name `producer` and `consumers` (workspace names). `dev-agent contract usage <KEY>` then scans each consumer workspace without `--client` and exits 2 if any consumer never calls the route with the method. An explicit `--client` still wins.

## Worked example: Altave

Four repositories, no `dependsOn`: Cloud and Edge talk over HTTP.

```yaml
workspaces:
  cloud-back:  { path: cloud-back,  role: backend }
  cloud-front: { path: cloud-front, role: frontend }
  edge-back:   { path: edge-back,   role: backend }
  edge-front:  { path: edge-front,  role: frontend }
```

The contract for a route that Cloud serves and Edge calls:

```json
{ "method": "POST", "path": "/api/sync", "response": { "ok": "boolean" }, "errors": {}, "producer": "cloud-back", "consumers": ["edge-back"] }
```

Flow: order the touched workspaces (`dev-agent workspaces order --only cloud-back,edge-back`), create the same branch name in each, implement the producer, then the consumer, run `dev-agent contract verify <KEY> --exchange <file>`, then `dev-agent contract usage <KEY> --strict`, and finish with `dev-agent diff review --workspace all`.

## Worked example: Pumpkin

Five repositories in a chain: `models` ← `backend` ← `policy-api` ← `client` and `admin`. `models` and `backend` are packages pinned in `pyproject.toml`.

1. One tracker item per feature. The ledger's `Workspaces` section splits it into steps in dependency order: `models`, `backend`, `policy-api`, `admin`, `client`. For independent release cadences, an item with parent and child links works the same way: each child is a step.
2. Change `models` and test it. `backend` pins `models>=1.3.0` but `models` is still 1.2.0, so `workspaces verify` prints `pin backend -> models: ahead`.
3. Stop and ask the user to publish `models` 1.3.0. Until then, local testing may use an editable install that is not committed.
4. After the publish, `verify` prints `ok`; continue with `backend`, and so on down the chain. A `behind` row means the dependent still pins an older version than the one that exists: bump the pin.
5. Run `diff review --workspace <name>` after each step and `--workspace all` at the end.

The HTTP boundary `policy-api` ↔ `client`/`admin` can carry a contract with `producer` and `consumers`. The Python boundary `backend` ↔ `policy-api` is covered by pins and each repository's own tests.

## What is not covered

In-process contracts between packages, monorepos with one Git root, automatic branch creation, publishing or version bumps from the CLI, a tracker adapter that creates child items, and benchmark scenarios spanning several repositories (multi-repo behavior is covered by deterministic tests over temporary trees).

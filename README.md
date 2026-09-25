# Dev Agent Kit

Dev Agent Kit is a provider-neutral engineering agent kit for **Claude Code** and **Codex**. It gives an agent portable skills (frontend, backend, fullstack and shared engineering), a deterministic `dev-agent` CLI that inspects and verifies but never runs a model, and its own MCP server for visual validation. A work item from your tracker goes in; a resumable ledger, a safe Git branch, a verified change and a reviewed diff come out.

> This repository is the evolution of `andre-zaguette/frontend-agent-kit` (history restarted at v0.5). The design is in `docs/superpowers/specs/2026-09-24-dev-agent-kit-evolution.md`.

## Install

Requires Node.js 20 or newer.

```bash
# from the tarball attached to the GitHub release
npm install -g dev-agent-kit-1.0.0.tgz

# or from a checkout
git clone https://github.com/andre-zaguette/dev-agent-kit.git
cd dev-agent-kit && npm install && npm link
```

The visual-validation tools drive a browser. Install one once: `npx playwright install chromium`.

Then, for each project:

```bash
dev-agent install --project /path/to/project          # every detected host (Claude Code, Codex)
dev-agent verify --project /path/to/project
```

`install` writes only inside the project: skills (`.claude/skills/`, `.agents/skills/`), a managed block in `CLAUDE.md`/`AGENTS.md`, and the MCP server entries (`.mcp.json`, `.codex/config.toml`). Your own content and other MCP servers are preserved; a skill you edited locally is kept and reported (`--force` overwrites it); `--no-figma` skips the Figma server. Claude Code asks you to approve project MCP servers on first start, and Codex loads `.codex/config.toml` only for trusted projects. `.mcp.json` and `.codex/config.toml` contain absolute paths to the installed kit; keep them out of version control in shared repositories. Without the CLI, see `docs/manual-install.md`.

## Quick start

1. Declare your task source in `.dev-agent/config.yml` (no code for an MCP-backed tracker):

   ```yaml
   baseBranch: main
   taskSources:
     company:
       adapter: generic-mcp
       server: company-tasks
       default: true
       identifiers:
         - '^HEF-\d+$'
       tools:
         get: { name: get_issue, arg: key }
       mapping:
         key: key
         title: summary
         description: description
         status: status.name
   ```

2. Check it: `dev-agent sources verify`, then `dev-agent task resolve HEF-123`.
3. In Claude Code or Codex, ask: *"Analyze and execute HEF-123."* The `task-orchestrator` skill reads the work item through your MCP server, writes a ledger to `.dev-agent/tasks/HEF-123.md`, prepares a branch (fast-forward only, never on a dirty tree), classifies the work as frontend, backend or fullstack and hands off to the matching skills.
4. Before the agent reports done, it can run `dev-agent diff review`; `dev-agent task status HEF-123` tells you whether the repository still matches the saved state.

## What is in the box

**26 skills** under `skills/`, loaded on demand:

| Domain | Skills |
|---|---|
| Frontend (7) | `figma-to-code`, `component-selection`, `frontend-design`, `responsive-design`, `motion-design`, `accessibility`, `visual-validation` |
| Shared engineering (7) | `engineering-architecture`, `repository-investigation`, `verification`, `root-cause-analysis`, `surgical-diff`, `context-efficiency`, `repo-memory` |
| Task orchestration (1) | `task-orchestrator` |
| Backend (10) | `backend-architecture`, `api-design`, `data-modeling`, `database-migrations`, `backend-testing`, `auth-security`, `external-integrations`, `async-jobs`, `observability`, `backend-performance` |
| Fullstack (1) | `fullstack-contract` |

Stack references load lazily: Python, Node.js, PHP, C#, Java and Ruby backends with their frameworks, databases, queues and caches (`docs/backend.md`), plus the frontend stacks.

**The `dev-agent` CLI** is deterministic: no model, no network, no Git mutation beyond safe branch preparation. `inspect`, `context audit`, `sources`, `sources verify`, `task resolve|status|show`, `contract show|verify|usage`, `repo index`, `repo similar`, `diff review`, plus `install` and `verify`. Exit codes: 0 ok, 1 usage or environment error, 2 checked and not OK. See `docs/cli.md`.

**The MCP server** exposes five tools: `capture_screenshot`, `inspect_dom`, `compare_screenshots`, `run_responsive_suite`, `run_accessibility_audit`. See `docs/visual-validation.md`.

Guides: `docs/task-orchestrator.md`, `docs/fullstack.md`, `docs/backend.md`, `docs/patterns.md`, `docs/context-efficiency.md`.

## Task sources

A task source is where work items live. Most trackers with an MCP server need only a declarative mapping: [docs/generic-mcp.md](docs/generic-mcp.md). When a source needs more (pagination, unusual authentication, computed fields), write an adapter against the contract in [docs/task-source-adapters.md](docs/task-source-adapters.md). Several sources can coexist and are routed by identifier pattern or an explicit `--source`. Read is separate from write: no shipped adapter writes to a tracker.

## Repository patterns and diff review

`dev-agent repo index --write` drafts repository knowledge from paths only; `dev-agent repo similar <words>` lists the existing features closest to a change so new code copies their structure; `dev-agent diff review` flags edited migrations, secrets in added lines, dependency changes, missing tests and new top-level directories. See `docs/patterns.md`.

## Compatibility

The original `frontend-agent` CLI is kept as a permanent alias: `frontend-agent` and `frontend-agent-kit` are installed next to `dev-agent` and run the same install and verify code with the same commands and exit codes. There is no removal date; removing it later would come with its own migration plan. The seven frontend skills, the five MCP tool names and `.frontend-agent/config.yml` are unchanged. Upgrading from the frontend-only kit: [docs/migration-from-frontend-agent.md](docs/migration-from-frontend-agent.md).

## Benchmarks

Offline validation works today: `npm run evals:validate` checks all 36 eval scenarios without a model, and `npm test` runs every package's tests.

The real Claude and Codex benchmarks are **not yet run** for v1.0.0. They are run by the project owner with `npm run bench -- --host claude` and `npm run bench -- --host codex` (they cost tokens); results land in `evals/results/<timestamp>/`. This README makes no benchmark claims until they exist. Details: `docs/evals.md`.

## Contributing

```bash
npm test                      # every package, offline
npm run typecheck --workspaces --if-present
npm run validate:skills       # frontmatter and structure of every skill
npm run evals:validate        # the 36 scenarios, offline
npm run verify:package        # what the npm tarball would contain
npm run smoke:package         # installs the tarball into a temp prefix (needs network)
```

Skills stay under 60 lines and name no framework, host or tracker; detail lives in lazily loaded `references/`.

## Version history

- **v1.0.0** — installable package `dev-agent-kit`, compatibility policy, adapter, generic-MCP and migration guides. See `docs/release-notes/v1.0.0.md`.
- **v0.11** — repository index, similar-feature search and diff review.
- **v0.10** — backend languages: PHP, C#, Java and Ruby next to Python and Node.js.
- **v0.9** — fullstack contract and the `dev-agent` CLI (v0.9.1: review debt).
- **v0.8** — backend domain: ten skills and lazy references.
- **v0.7** — task orchestrator and declarative task sources.
- **v0.6** — shared engineering core.
- **v0.5** — evals and benchmark harness. Earlier: v0.4 CLI installer, v0.3 validation tools, v0.2 MCP server, v0.1 frontend skills.

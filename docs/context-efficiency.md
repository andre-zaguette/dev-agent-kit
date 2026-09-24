# Context efficiency

Rule: use the minimum context required to make the correct decision — not the fewest tokens possible.

## What v0.6 adds

- **Seven shared skills** (`engineering-architecture`, `repository-investigation`, `verification`, `root-cause-analysis`, `surgical-diff`, `context-efficiency`, `repo-memory`). They are framework-, host- and task-source-neutral and are installed with the frontend skills.
- **Short managed instructions.** `CLAUDE.md` / `AGENTS.md` blocks hold only the generic principles and a compact frontend section. Detailed workflows live in skills, loaded on demand.
- **`packages/core`.** Deterministic helpers: `detectProjectProfile`, `headSha`/`changedSince`/`detectBaseBranch`, repo-memory read/write/freshness, and `auditContext`.

## Repo memory

Stable facts live in `.dev-agent/knowledge/{repository,architecture,frontend,backend,commands}.md`. Each file starts with `sourceSha` and `updatedAt`. When HEAD differs from `sourceSha`, revalidate only the sections touching `git diff --name-only <sourceSha> HEAD`. Writes whose body matches common secret patterns are refused, and the knowledge directory and file must not themselves be symlinks. Deeper containment (parent-directory symlinks) and broader secret patterns are planned before the first automated caller lands in v0.7; in v0.6 agents write these files with their own tools, so the repo-memory skill's "Never cache secrets" rule is the primary guard.

## Context audit

`auditContext(root)` (from `packages/core`) reports: instruction files over ~1500 tokens, paragraphs duplicated across instructions and skills, framework detail in always-on files, skills over ~2500 tokens, and stale repo memory — with an estimated removable token count (`chars / 4`). The estimated removable token total is an upper bound because findings can overlap; `formatAuditReport` (from `packages/core`) renders it as "removable: up to ~N tokens (findings may overlap)". A CLI command (`dev-agent context audit`) is planned with the v0.9 CLI work.

## Not in v0.6

Task sources, the task ledger and Git branch preparation (v0.7); backend skills (v0.8); fullstack contract and the `dev-agent` CLI alias (v0.9).

---
name: git-workflow
description: Safe Git preparation for a task branch: base discovery, fast-forward-only update, branch naming and the actions that are never automatic.
type: contract
---

# Git workflow

## Base branch, in order

`.dev-agent/config.yml` (`baseBranch`), repository instructions, `origin/HEAD`, local `main`, local `master`.

## Steps (execute mode only)

1. `git status --porcelain`. Not empty: stop before touching anything and report the files.
2. Refuse an invalid or already existing task branch name.
3. `git fetch --prune origin`. Failure: stop and report.
4. Compare base with `origin/<base>`. Local and remote both moved (diverged): stop and report; do not hide it.
5. `git switch <base>`, then `git merge --ff-only origin/<base>` when behind. A base only ahead of the remote is fine; note it.
6. `git switch -c <task-branch>`.
7. Record base branch, base SHA and working branch in the ledger and state.

Without an `origin` remote, use the local base as-is and say so.

## Never, automatically

`reset --hard`, discarding changes, force-push, rebasing user work, `stash` (an auto-stash gets forgotten), `clean`.

## Branch naming, in order

1. `branchPattern` in `.dev-agent/config.yml`.
2. A backticked pattern with placeholders in AGENTS.md / CLAUDE.md / CONTRIBUTING.md (`Branch pattern: \`{type}/{keyLower}-{slug}\``).
3. A clearly consistent pattern on the remote's topic branches.
4. Fallback `{type}/{keyLower}-{slug}`, e.g. `feat/hef-123-biometric-report`, `fix/pay-34-duplicate-payment`.

Placeholders: `{type}` (feat, fix, chore, docs, refactor), `{key}`, `{keyLower}`, `{slug}`. If several remote topic branches exist and follow no consistent pattern and nothing is configured, ask once instead of inventing a convention.

## Several repositories

With a `workspaces:` map the root is not a repository, so the steps above run inside each touched workspace, one at a time, in dependency order. The base is the workspace's `baseBranch`, else the root's. Use the same branch name in every repository. A refusal (dirty tree, diverged base, existing branch) in one repository stops the run and is reported. Details: `workspaces.md`.

Deterministic implementation: `prepareTaskBranch`, `resolveBranchName` in `packages/core`.

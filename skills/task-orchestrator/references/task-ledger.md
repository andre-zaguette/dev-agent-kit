---
name: task-ledger
description: The per-work-item Markdown ledger and JSON state, the checkpoints that update them, resume, classification and how to record local run and test instructions.
type: contract
---

# Task ledger

    .dev-agent/tasks/<KEY>.md      human-readable
    .dev-agent/state/<KEY>.json    machine-resumable

## Markdown sections, in order

Source, Requirement, Acceptance criteria, Relevant comments / decisions, Classification, Repository analysis, Visual source, Implementation plan, Git, Implementation log, Verification, How to run locally, How to test this work item manually, Risks / known differences, Final status.

External text (requirement, comments) is stored as a blockquote or a single line so it can never form a heading. `Final status` is derived from the phase: planned, blocked, implementing, verifying, done.

## State

    workItemKey, source, classification?, phase, baseBranch?, baseSha?, workingBranch?, visualSource?, skills[], updatedAt

`phase` is one of ingestion, investigation, git, implementation, verification, done, blocked. `source` is the logical id. No secrets, tokens or transport details.

## Checkpoints (and only these)

1. after ingestion, 2. after repository investigation, 3. after Git preparation, 4. after implementation, 5. after verification, 6. final status. Short factual entries.

## Classification

frontend, backend, fullstack, investigation-only, infrastructure. Decide after reading the work item and the repository. Classification selects which skills to load; do not load every domain.

- frontend: `figma-to-code`, `component-selection`, `responsive-design`, `accessibility`, `visual-validation` (plus `frontend-design`, `motion-design` when relevant).
- backend: `backend-architecture` first, then only what the change needs: `api-design`, `data-modeling`, `database-migrations`, `backend-testing`, `auth-security`, `external-integrations`, `async-jobs`, `observability`, `backend-performance`. Detect the stack, then read only its references.
- fullstack: both sets, after one API contract is written down (see the fullstack workflow in a later version).
- investigation-only: `repository-investigation` and `root-cause-analysis`; change no code.
- infrastructure: `repository-investigation`, `verification`, `surgical-diff`; production stays read-only.

## Resume ("Continue HEF-123")

Read state, read the ledger, compare the current branch and HEAD with the recorded ones, resolve the saved source, refresh the item only if needed, revalidate stale repo-memory, continue from the recorded phase. If the source no longer exists, keep the ledger and stop only when fresh external data is required. If the repository no longer matches the state, stop and reconcile.

## Local run and test notes

At the end, write exact commands taken from the real repository (install, run, automated verification) and a manual scenario with the expected result. Do not write commands you did not verify.

Deterministic implementation: `ingestWorkItem`, `recordCheckpoint`, `checkResume` in `packages/core`.

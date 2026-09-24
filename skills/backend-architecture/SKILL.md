---
name: backend-architecture
description: Plan backend changes from the existing service architecture, domain invariants, transactions and concurrency before writing code, then verify against a Definition of Done. Use for any backend work item that adds or changes endpoints, jobs, persistence or integrations.
---

# Backend Architecture

Detect the repository's stack first (`repository-investigation`, `repo-memory`). Then load only the matching file from `references/`; never assume a stack the repository does not use.

## Workflow

1. Read the closest existing feature: entry point, domain logic, persistence, tests.
2. Model the data and the domain rules the change must protect.
3. Define the contract at the boundary: API, job message or integration.
4. Analyse transactions, concurrency and security before coding.
5. Implement, then static checks, tests, a runtime smoke test, and a `surgical-diff` review.

## Before coding, when applicable

- transaction boundary; concurrent writers; idempotency (can this run twice?)
- authorization; unique constraints; indexes
- retry policy; duplicate message processing; external API timeout
- rollback or forward-fix migration strategy

## Rules

- Follow the architecture that exists. A new layer, dependency or convention needs a reason the current ones cannot cover.
- Protect invariants at the boundary that owns the data, not in every caller.
- Production is read-only unless explicitly authorized. Never put credentials, tokens or keys in code, logs or the task ledger.

## Definition of Done

- [ ] existing architecture followed
- [ ] domain invariants protected
- [ ] request/message boundaries validated
- [ ] authorization checked
- [ ] concurrency considered
- [ ] idempotency considered
- [ ] migrations reviewed when applicable
- [ ] tests added/updated
- [ ] static checks pass
- [ ] runtime smoke test performed when practical
- [ ] external failure paths considered
- [ ] sensitive data is not logged
- [ ] final diff is task-scoped

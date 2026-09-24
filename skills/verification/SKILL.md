---
name: verification
description: Prove behavior with the surface's real mechanism instead of compilation alone - render UIs, call APIs, run migrations, consume jobs, reproduce bugs before and after. Use before reporting any task as done.
---

# Verification

Compilation and unit tests are necessary and never sufficient. Compilation alone is never runtime proof.

## What counts as proof

| Surface | Proof |
|---|---|
| User interface | Render it and interact with it |
| API | A real request against a running service when practical, checking status, body and side effects |
| Database | Run the migration and the query against a real database |
| Background job | Enqueue and consume a message when practical |
| Bug fix | Reproduce before the fix and again after it |
| Refactor | The same tests pass before and after, unchanged |

## Rules

- Run the repository's own test, lint and typecheck commands first (see `repository-investigation`).
- Then exercise the changed behavior for real. If you cannot (no service, no credentials, no browser), say exactly what was not run and why.
- Never claim "works" from reading code. Evidence is a command and its observed result.
- A failure you did not expect is a finding, not noise: stop and diagnose it (see `root-cause-analysis`).

## Report

For each check: the command or action, the observed result, and anything left unverified.

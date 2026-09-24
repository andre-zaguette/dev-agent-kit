---
name: backend-testing
description: Test backend behavior at its boundaries, including error paths, authorization, concurrency and idempotency, against real infrastructure when practical. Use when adding or changing backend behavior, or when a backend test is missing, flaky or too mocked.
---

# Backend Testing

Prove behavior, not implementation. Use the repository's test runner, fixtures and layout.

## What to cover

- The happy path through the real boundary (HTTP, message, command).
- Each error path: invalid input, unauthenticated, unauthorized, not found, conflict, dependency failure.
- Authorization on the specific resource, not just "logged in".
- Concurrency and idempotency where writes can repeat or race: run the operation twice and assert one effect.
- Database side effects: rows written, constraints enforced, transactions rolled back on failure.

## Rules

- Prefer a real database and real queue for integration tests when the project can run them; mock only the network edge you do not own.
- A test asserts an outcome a user or another service can observe. Do not assert on private calls or on mocks talking to mocks.
- Reproduce a bug with a failing test before fixing it, and keep that test.
- Keep tests deterministic: no wall-clock sleeps, no shared state between tests, no dependence on order.
- After tests pass, do a runtime smoke test when practical: start the service and make one real request.

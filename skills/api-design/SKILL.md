---
name: api-design
description: Design and implement HTTP API changes that match the existing conventions, with explicit request, response and error contracts, authorization, idempotency and a real request as proof. Use when adding or changing an endpoint.
---

# API Design

Match the API that exists. Load the stack's file from `references/` after detecting the stack.

## Workflow

1. Inspect neighboring endpoints: naming, versioning, pagination, filtering.
2. Identify request/response conventions and the authentication and authorization pattern.
3. Define the request schema, the response schema and the error contract (status, code, shape).
4. Decide transaction, idempotency and concurrency needs.
5. Implement the domain behavior, then expose it at the API boundary.
6. Update the API description (OpenAPI or equivalent) when the project keeps one.
7. Add tests, start the application, make a real request when practical, and check the database side effects.

## Rules

- Validate at the boundary; never trust client-supplied identifiers, ownership fields or roles.
- One error shape for the whole API. Use the status codes the neighbors use for the same situations.
- Writes that clients may retry need an idempotency answer (key, natural unique constraint, or safe repeat).
- Never expose internal identifiers, stack traces or raw vendor errors.
- Prefer additive changes; a breaking change needs a version or a migration plan.

## Definition of Done

- [ ] request validated
- [ ] response contract verified
- [ ] status codes correct
- [ ] authentication checked
- [ ] resource authorization checked
- [ ] transaction/concurrency considered
- [ ] error path tested
- [ ] runtime request verified

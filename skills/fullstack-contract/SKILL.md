---
name: fullstack-contract
description: Run a work item that spans a user interface and an API by persisting one explicit API contract first, then implementing both sides against it and proving they agree. Use when a task changes both the client and the service, or adds an endpoint plus the screen that calls it.
---

# Fullstack Contract

One contract, two implementations, one proof that they agree.

## Workflow

1. Investigate both areas (`repository-investigation`): the neighboring endpoint and the neighboring screen or client call.
2. Persist the contract before either side is written, at `.dev-agent/tasks/<KEY>.contract.json`. Format: `references/contract-format.md`. Declare the method, path, request and response fields, every error status with its error codes, and the success status.
3. Implement the service side with `backend-architecture` and `api-design`, exactly as the contract says.
4. Implement the client side with the client skills the classification loads, using the same paths, field names and error codes.
5. Run each side's own tests, static checks and, when a design source exists, its visual validation.
6. Prove the two agree with real evidence, not with prose:
   - capture a real request and response (success and each declared error) and run `dev-agent contract verify <KEY> --exchange <file>`;
   - if the project keeps an API description, add `--openapi <file>`;
   - run `dev-agent contract usage <KEY> --client <dir> --strict` on the client code. With several workspaces, name `producer` and `consumers` in the contract and omit `--client`: each consumer is scanned.
7. Record both domains, the contract path, the commands run and any known difference in the task ledger.

## Rules

- The contract changes only by an explicit decision. If one side needs a different shape, change the contract first, then both sides, and say so in the ledger.
- Error codes are part of the contract: the service returns them, the client handles them.
- `contract usage` is text evidence from client source; back it with a real client test or run when practical.
- Never put credentials, tokens or personal data in the contract, in captured exchanges or in the ledger.

## Definition of Done

- [ ] explicit API contract persisted
- [ ] frontend and backend use the same contract
- [ ] backend tests pass
- [ ] frontend tests pass
- [ ] integration path verified
- [ ] visual validation passes when applicable
- [ ] task ledger documents both domains

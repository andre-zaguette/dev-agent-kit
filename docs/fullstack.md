# Fullstack orchestration (v0.9)

A work item that touches both a screen and an API gets one contract, two implementations and one proof that they agree.

## The flow

1. Investigate both areas, then persist the API contract at `.dev-agent/tasks/<KEY>.contract.json` **before** either side is written.
2. Implement the service side and the client side against that same file: same path, same field names, same error codes.
3. Run each side's own tests and checks (and visual validation when a design source exists).
4. Prove the sides agree with evidence, using `dev-agent`:
   - `contract verify <KEY> --exchange <file>`: a captured real request and response (success and each declared error) is checked against the contract.
   - `contract verify <KEY> --openapi <file>`: the project's published API description must describe the same route, fields, types and error statuses.
   - `contract usage <KEY> --client <dir> --strict`: the client source calls the route with the right method and mentions every declared error code.
5. Record both domains, the contract path and the commands run in the task ledger.

## The contract

One JSON file per endpoint: `method`, `path` (with `{params}`), `request`, `response`, `errors` (status to error codes) and an optional `successStatus`. Field types are `string`, `uuid`, `email`, `integer`, `number`, `boolean`, `datetime`, `date`, `object`, `any`, with `?` for optional and `[]` for arrays, and objects may nest. A one-element array is an array of that type (`[{ "id": "uuid" }]`), a key ending in `?` makes any field optional (`"profile?": { ... }`), and `request`/`response` may themselves be an array when the body is a list. The full grammar is in `skills/fullstack-contract/references/contract-format.md`.

## What each verifier proves

| Verifier | Proves | Does not prove |
|---|---|---|
| exchange | the running service answered the way the contract says, for the exchanges you captured | behavior for requests you did not capture |
| OpenAPI | the published description agrees with the contract | that the service really behaves like its description |
| client usage | client source calls the route **with the contract's method** (judged file by file) and mentions the error codes (text evidence) | that the client behaves correctly at runtime |

## Several repositories

When the client and the service live in different repositories under one workspace root, the contract names `producer` and `consumers` (workspace names) and `contract usage` scans each consumer without `--client`. See `docs/workspaces.md`.

## Not automated

Running the application, generating a client from the contract, and contract tests against a live service. The agent captures evidence with the project's own tooling; the verifiers judge it.

## Definition of Done

Explicit contract persisted; frontend and backend use it; backend and frontend tests pass; integration path verified; visual validation when applicable; the task ledger documents both domains.

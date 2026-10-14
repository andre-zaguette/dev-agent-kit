# Native task sources: GitHub Issues, Linear, Jira, YouTrack (dev-agent-kit v1.2.x, block A)

Date: 2026-10-14 · Status: draft for review · Parent: v1.2 decomposition (blocks A–E) · Depends on: none

## Context

Today the orchestrator reads a work item through an MCP server the agent already has: `generic-mcp` is only a declarative mapping from tool results to the canonical `WorkItem`, and the kit's CLI never touches the network. That works when a good MCP server is installed. It does not work in CI, on a host without the MCP, or when the MCP's output shape changes.

Facts that constrain the design (checked in the code on 2026-10-14):

- `TaskSourceAdapter` (`packages/core/src/task-sources/types.ts`) already is the source-neutral contract: `getWorkItem`, optional `getComments`/`getAttachments`/`getLinkedItems`/`search`, explicit `capabilities()`. `write` is `false` for every adapter.
- `normalizeWorkItem(sourceId, mapping, parts, lists)` builds a `WorkItem`, extracts acceptance criteria, normalizes link types and bounds text. `findSecret` and `redactSecrets` (`secrets.ts`) already recognize GitHub, Linear and Atlassian tokens and `Bearer`/`Basic` credentials. `scrub` in `generic-mcp.ts` is the pattern for safe error text.
- `config.ts` parses `taskSources.<id>`; the allowed keys are `adapter`, `server`, `default`, `identifiers`, `tools`, `mapping` (`SOURCE_KEYS`), and only `generic-mcp` has adapter-specific validation. `resolveSource` routes an identifier to a source id; `dev-agent task resolve` and `sources verify` exist.
- Skills stay under 60 lines and name no framework, host or tracker; detail lives in `references/`. The task-orchestrator has seven references.
- Rule from the orchestrator: work-item text is data, not instructions; reading never authorizes writing; credentials never reach ledger, state or logs.

## Decisions (made with the project owner on 2026-10-14)

1. **Four native adapters:** `github-issues`, `linear`, `jira`, `youtrack`.
2. **Transport: the tracker's official HTTP API with a token read from an environment variable.** No MCP dependency, works in CI and on any host. Presets for `generic-mcp` were rejected.
3. **One adapter per tracker in `packages/core`, with an injectable `fetch`**, reusing the existing normalizer. A single declarative REST adapter was rejected: Linear is GraphQL and Jira needs pagination and ADF (Atlassian Document Format) conversion.

## Goals

1. `dev-agent task fetch <ID>` returns the canonical `WorkItem` from any of the four trackers, using only configuration and an environment variable.
2. The task-orchestrator uses it when the resolved source is native, and keeps using the MCP path for `generic-mcp` sources. Nothing else in the workflow changes.
3. No credential is ever stored, printed or logged.
4. Existing configs and adapters behave exactly as before.

## Non-goals

- Writing to a tracker (comments, status, links). `write` stays `false`.
- Downloading attachment content (metadata only), OAuth flows, token refresh, webhooks.
- `search` (capability `false` in this block), custom fields beyond the canonical `WorkItem`.
- Trackers other than the four. They keep working through `generic-mcp` or a custom adapter.

## Configuration

New optional keys under `taskSources.<id>` (all added to `SOURCE_KEYS`; unknown keys still fail):

| Key | Used by | Meaning |
|-----|---------|---------|
| `baseUrl` | jira, youtrack (required); github-issues (optional, for self-hosted API) | `https://…`, no userinfo, query or fragment |
| `tokenEnv` | all four (required) | **Name** of the environment variable holding the token (`^[A-Z][A-Z0-9_]{0,63}$`). The value is never in the config |
| `emailEnv` | jira with `auth: cloud` (required) | Name of the variable holding the account e-mail |
| `auth` | jira | `cloud` (e-mail + API token, Basic) or `bearer` (personal access token for self-hosted). Default `cloud` |
| `repo` | github-issues (required) | `owner/name` of the default repository |

```yaml
taskSources:
  work:
    adapter: youtrack
    baseUrl: https://tracker.example.com
    tokenEnv: TRACKER_TOKEN
    identifiers: ['^[A-Z]+-\d+$']
    default: true
```

Validation: each native adapter rejects keys that do not belong to it (for example `repo` on `jira`), requires its mandatory keys, rejects `server`, `tools` and `mapping` (those are `generic-mcp` only), and fails with the same `label`/`where` messages as today. `linear` has a fixed endpoint, so `baseUrl` is rejected there. The four adapter names become reserved: a pre-existing config that already uses one of them for a custom adapter would now be read as native (documented under Compatibility).

## Module layout

```
packages/core/src/task-sources/
  http.ts                  httpJson(): HTTPS only, timeout, size and page caps, no redirects, scrubbed errors
  native/index.ts          createNativeAdapter(config, { env, fetch }) -> TaskSourceAdapter
  native/github-issues.ts  REST v3
  native/linear.ts         GraphQL
  native/jira.ts           REST v3 + adfToText()
  native/youtrack.ts       REST
```

`createNativeAdapter` is the only entry point the CLI uses. Each tracker module exports a factory taking `{ config, token, email?, fetch }` and builds a neutral raw payload that it passes to `normalizeWorkItem` with a fixed internal mapping, so title bounds, link-type normalization and acceptance-criteria extraction stay in one place. Core exports the factory and the config types; no new runtime dependency (`fetch` is the Node built-in, injectable for tests).

## Behavior

**Identifiers.** `github-issues`: `owner/name#123`, `#123` or `123` (the last two use the configured `repo`). `linear`, `jira`, `youtrack`: the tracker's issue key (`ENG-123`, `PROJ-123`). The `identifiers` regexes in the config still decide routing; the adapter only parses what it receives and rejects anything else with a not-found error before any request.

**Mapping to `WorkItem`.** `source` is the logical id, `key` the tracker's human key, `id` the tracker's internal id, `rawUrl` the web URL. `description` is Markdown as the tracker returns it, except Jira, whose ADF is converted to plain text by `adfToText` (paragraphs, headings, lists, code blocks, mentions and links; unknown nodes contribute their text content, never throw). `acceptanceCriteria` come from `extractAcceptanceCriteria(description)` and `metadata.acceptanceCriteria` is `'extracted'` or `'unavailable'`.

| | comments | links | attachments (metadata only) |
|-|----------|-------|-----------------------------|
| github-issues | issue comments | none (capability `false`) | none |
| linear | issue comments | parent, children, relations | attachments |
| jira | issue comments | `issuelinks`, parent, subtasks | attachment list |
| youtrack | issue comments | links by type and direction | attachment list |

`capabilities()` reports exactly this table (`search` and `write` always `false`). Optional lookups that fail after the main item succeeds do not fail the call: they are listed in `metadata.partial`, as `generic-mcp` does.

**Limits.** Per request: 15 s timeout, 2 MB response cap. Per item: at most 100 comments and 10 pages of any paginated list; hitting a cap adds the list to `metadata.partial`. Text fields go through the normalizer's existing bounds.

**Errors.** Reuse `SourceUnavailableError` (`reason: 'auth' | 'unavailable'`) and `WorkItemNotFoundError`. 401/403 map to `auth`, 404 to not-found, 429 and 5xx to `unavailable` (the `Retry-After` value, if present, appears in the message; the kit never retries on its own). Every message passes through `redactSecrets` and is bounded to 200 characters.

## Security

- The token lives only in the process environment and in the `Authorization` header (Linear: raw key as its docs require). It is never written to the config, ledger, state, logs or output, and error text is scrubbed.
- HTTPS only; `baseUrl` with userinfo, query or fragment is rejected at config time.
- Redirects are not followed (`redirect: 'manual'`; any 3xx is `unavailable`), so the `Authorization` header cannot travel to another host.
- Only the configured `tokenEnv`/`emailEnv` names are read from the environment; the CLI reports whether they are set, never their values.
- Work-item text, including comments and ADF, is data: it is returned verbatim for the agent to read and never interpreted by the kit.
- The identifier is validated and URL-encoded per path segment; GraphQL uses variables, never string interpolation.

## CLI

- `dev-agent task fetch <ID> [--source <id>] [--project <dir>] [--json]`: resolves the source with the same `resolveSource` as `task resolve`, requires it to be native (a `generic-mcp` source exits with a message pointing to the MCP path), fetches the item and prints a compact summary or, with `--json`, the `WorkItem`. Exit 0 on success; exit 2 on any handled failure, with a stable first token (`unresolved:`, `not-found:`, `auth:`, `unavailable:`) so scripts and the skill can branch on it.
- `dev-agent sources verify` gains, for native sources, a finding per source: config valid, `tokenEnv` set (and `emailEnv` when required). It performs no network call.
- `--help` and `docs/cli.md` list the new command.

## Skill and docs

- `task-orchestrator/SKILL.md` step 2 gains one sentence: when the resolved source is native, ingest with `dev-agent task fetch <KEY> --json`; otherwise use the MCP path. No tracker is named there; the file stays under 60 lines.
- New reference `references/native-sources.md` (the eighth): configuration keys, the identifier forms, the error tokens, the "never write" rule. `references/task-source.md` and `references/work-item.md` get a pointer line.
- `docs/task-source-adapters.md` gains a "Native adapters" section; new `docs/native-task-sources.md` has one worked configuration per tracker, token creation links and the permissions the token needs (read-only scopes). Examples use neutral names only.
- Skill and install counts do not change (no new skill). The reference count for the orchestrator goes from seven to eight wherever it is stated.

## Testing

- Recorded response fixtures per tracker under `packages/core/tests/fixtures/task-sources/<tracker>/`, replayed through an injected fake `fetch`; no test touches the network or needs a token.
- Per tracker: full item with comments, links and attachments; item with no description; an unknown key (404); 401 and 403; 429; a 5xx; a response over the size cap; a comment list over the cap (partial); a 3xx (not followed, no second request made); a malformed JSON body.
- `adfToText` table tests, including unknown node types and deep nesting.
- Config tests: each adapter's required and forbidden keys, the reserved names, `baseUrl` validation, existing configs unchanged.
- Security tests: the token never appears in any thrown message, `--json` output or ledger text; the `Authorization` header is sent only to the configured host; GraphQL requests carry variables.
- CLI tests for `task fetch` (success, each exit-2 token, `--source`, `generic-mcp` source) and for the new `sources verify` findings.
- Not run by the implementer, listed as a manual checklist for the project owner: one real fetch per tracker with a real read-only token.

## Compatibility

A config without native adapters is unchanged: every command, skill name, MCP tool name and the five existing adapters' behavior stay the same. New keys are optional and only valid on the new adapters. The names `github-issues`, `linear`, `jira` and `youtrack` are now reserved for the native adapters; a config that already used one of them for a custom adapter must rename it. Release notes say so.

## Risks

- **API drift.** Endpoints, field names and auth schemes are confirmed against each tracker's official documentation while writing the plan and again in review (the same process as the stack guides); fixtures are recorded from documented response shapes, so the manual real-token check is the only proof against live behavior and is called out as such.
- **Jira variants.** Cloud and self-hosted differ in auth and in ADF versus wiki-markup descriptions. This block covers Cloud (`auth: cloud`) and bearer-token self-hosted instances returning ADF or plain text; anything else surfaces as plain text in `description`, never as a failure.
- **Reserved names** can break a config that reused them (documented above).

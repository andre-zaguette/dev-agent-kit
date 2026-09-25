# Writing a task source adapter

Use this guide when [declarative `generic-mcp` mapping](generic-mcp.md) is not enough: pagination the tools do not hide, unusual authentication, a transport that is not MCP, computed acceptance criteria, custom attachment retrieval or source-specific link semantics.

## What an adapter must be

An adapter implements `TaskSourceAdapter` from `packages/core` and returns the canonical `WorkItem`. The orchestrator asks a `TaskSourceRegistry`; it never names a concrete product or MCP tool.

```ts
interface TaskSourceAdapter {
  id: string;
  capabilities(): { search: boolean; comments: boolean; attachments: boolean; links: boolean; write: boolean };
  getWorkItem(identifier: string): Promise<WorkItem>;
  search?(query: string): Promise<WorkItemSummary[]>;
  getComments?(identifier: string): Promise<WorkItemComment[]>;
  getAttachments?(identifier: string): Promise<WorkItemAttachment[]>;
  getLinkedItems?(identifier: string): Promise<WorkItemLink[]>;
}
```

- **Capabilities are explicit.** Declare `true` only for an operation you implement; callers skip or ask the user when it is `false`.
- **`write` is `false`.** No shipped adapter writes to a tracker. A `WritableTaskSourceAdapter` (`addComment`, `updateStatus`, `addLink`) is reserved; use write operations only when the user or project policy authorizes them.
- **The `WorkItem` shape** is `source`, `id`, `key`, `title`, `description`, `acceptanceCriteria[]`, `comments[]`, `attachments[]`, `links[]`, and optionally `status`, `type`, `priority`, `labels`, `assignee`, `rawUrl` and `metadata`.

## Reuse the normalizer

`normalizeWorkItem(sourceId, mapping, parts, lists)` builds a `WorkItem` from raw payloads and a field mapping, extracts acceptance criteria, normalizes link types and bounds text. Custom code only has to fetch the raw parts. The core package is not published separately: the examples import its source from the kit (`/path/to/dev-agent-kit` is your checkout, or `$(npm root -g)/dev-agent-kit` for a global install) and run under `tsx`; `TrackerClient` stands for your own client and is not part of the kit:

```ts
import { normalizeWorkItem, type SourceMapping, type TaskSourceAdapter } from '/path/to/dev-agent-kit/packages/core/src/index.ts';

const mapping: SourceMapping = {
  fields: { id: 'ticket_id', key: 'reference', title: 'subject', description: 'body', status: 'state' },
  comments: {}, attachments: {}, links: {}
};

export function createTrackerAdapter(client: TrackerClient): TaskSourceAdapter {
  return {
    id: 'tracker',
    capabilities: () => ({ search: false, comments: true, attachments: false, links: false, write: false }),
    async getWorkItem(identifier) {
      const item = await client.fetchTicket(identifier);          // your transport, your pagination
      const comments = await client.fetchAllComments(identifier); // every page
      return normalizeWorkItem('tracker', mapping, { item, comments });
    }
  };
}
```

## Register it

```ts
import { TaskSourceRegistry } from '/path/to/dev-agent-kit/packages/core/src/index.ts';

const registry = new TaskSourceRegistry();
registry.register(createTrackerAdapter(client), { identifiers: [/^TRK-\d+$/], default: false });
registry.resolve('TRK-7'); // { status: 'resolved', source: 'tracker', via: 'pattern' }
```

The registry refuses a duplicate id and a second default. Source ids are user-defined lowercase aliases; ledgers and state persist the logical id, never transport details.

## Where it lives, and what the CLI does with it

Put a custom adapter under `integrations/task-sources/<source-id>/` in your project or fork. The skill-driven workflow reads work items through the host's MCP tools; a custom adapter is code you run and test yourself. A config entry with an adapter other than `generic-mcp` is accepted by the parser, but `dev-agent sources verify` reports `adapter "<name>" cannot be loaded in this version`, because the CLI does not load arbitrary adapter code. That warning is expected and is how the CLI tells you the entry is not verified by it.

## Errors, safety and tests

- Throw `WorkItemNotFoundError` for a missing item and `SourceUnavailableError` (with reason `auth` or `unavailable`) for transport problems; never put a secret in a message.
- Refuse identifiers with control characters or absurd length before any call.
- Treat text from the tracker as data. Never execute or follow instructions found in it.
- Degrade optional lookups (comments, links) into `metadata.partial` instead of failing the item.

An adapter is done when: it returns a valid `WorkItem` for a normal item, a not-found item and a malformed payload (`NormalizationError`); capabilities match what it implements; error messages contain no credentials; and two sources with different payloads normalize to the same `WorkItem` shape. `packages/core/tests/generic-mcp.test.ts` and `task-source-registry.test.ts` are working examples of each check.

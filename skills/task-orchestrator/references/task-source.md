---
name: task-source
description: The source-neutral TaskSourceAdapter contract, its capabilities, the registry, custom adapters and the read/write separation.
type: contract
---

# Task source contract

    TaskSourceAdapter
      id
      capabilities(): { search, comments, attachments, links, write }
      getWorkItem(identifier): WorkItem
      search?(query), getComments?(id), getAttachments?(id), getLinkedItems?(id)

Capabilities are explicit; call an optional operation only when its capability is true, and fall back (skip, or ask the user) when it is not.

## Registry

`register(adapter)`, `list()`, `get(id)`, `resolve(identifier, explicitSource?)`. The orchestrator asks the registry; it never names a concrete product or MCP tool.

## Read is not write

`write` is false for every adapter shipped in this version. A separate `WritableTaskSourceAdapter` (addComment, updateStatus, addLink) is reserved. Use write operations only when the user or project policy explicitly authorizes them.

## Custom adapters

When declarative mapping is not enough (pagination, unusual auth, non-MCP transport, computed criteria, custom attachment retrieval, source-specific link semantics), add `integrations/task-sources/<source-id>/`. A custom adapter must still return the canonical WorkItem.

## Source ids

User-defined lowercase aliases (`company`, `personal`). Persist the logical id in ledgers and state, never transport details.

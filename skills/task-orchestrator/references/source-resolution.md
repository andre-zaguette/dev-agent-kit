---
name: source-resolution
description: How a work item identifier is mapped to exactly one configured task source, and what to do when it cannot be.
type: contract
---

# Source resolution

Order, first match wins:

1. Explicit source in the request ("HEF-123 from personal"). Unknown source: list the known ids and ask.
2. Identifier patterns declared per source in `.dev-agent/config.yml` (`identifiers`).
3. The configured default source (at most one).
4. A controlled probe, only when probing is enabled and the candidates are the few sources that declare no patterns.

Outcomes: `resolved`, `ambiguous` (two sources match: stop and ask which), `unknown-source`, `unresolved` (say why: nothing configured, or no match and no default), `probe` (try only the listed candidates).

Never spray one identifier across every configured system. Never guess between two matches, even when one of them is the default.

Deterministic implementation: `resolveSource` / `TaskSourceRegistry.resolve` in `packages/core`.

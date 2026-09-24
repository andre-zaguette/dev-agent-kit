---
name: engineering-architecture
description: Inspect the existing architecture before designing anything, reuse local patterns, and define boundaries, states and concurrency rules explicitly. Use before adding a module, service, data model or any change that crosses a boundary.
---

# Engineering Architecture

Design from what the repository already does, not from a preferred style.

## Before designing

1. Find the closest existing feature (see `repository-investigation`) and read how it is layered: entry point, domain logic, persistence, tests.
2. List the boundaries the change touches: modules, processes, network calls, storage.
3. Write down the invariants the change must protect: data that must stay consistent, states that must never coexist.

## Rules

- Reuse a local pattern before introducing an abstraction. A new layer, interface or helper needs a concrete second caller or a stated reason.
- Give each boundary one owner. If two modules can both write the same state, decide which one does.
- Model states explicitly: name them, list the allowed transitions, reject the rest at the boundary.
- For every write path ask: can two writers act at once? Can this run twice? What makes it safe (transaction, unique constraint, idempotency key, lock)?
- Keep the change minimal: no new dependency, folder or convention unless the existing ones cannot cover the need.
- Record the decision and the rejected alternative in one or two lines; do not write an essay.

## Output

A short design note: boundaries touched, existing pattern followed, invariants, concurrency/idempotency answer, files expected to change.

---
name: backend-performance
description: Find and fix backend slowness by measuring first, then addressing queries, round trips, payload size and missing timeouts. Use when a backend path is slow, a query plan looks wrong, or before adding caching or indexes.
---

# Backend Performance

Measure, change one thing, measure again.

## Look for

- N+1 queries and per-item round trips; load related data in bulk
- unbounded result sets: pagination and limits on every list
- missing or unused indexes, checked against the actual query plan when the database offers one
- work done inside a transaction that does not need to be, holding locks longer than necessary
- large payloads and serialization cost
- missing timeouts on calls to other services and the database
- repeated work that could be computed once

## Rules

- No optimization without a measurement that shows the problem; record before and after.
- Do not add indexes blindly. Each index maps to an observed query pattern and costs write time.
- A cache needs an owner, an expiry and an invalidation rule; say what happens when it is stale.
- Preserve behavior: performance work keeps the same tests green and adds one for the case that was slow.
- Production stays read-only. Reproduce on disposable data.

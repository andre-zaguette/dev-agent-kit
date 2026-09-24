---
name: data-modeling
description: Model tables, relations and constraints so the database enforces the domain rules, with indexes only for real query patterns. Use when adding or changing entities, columns, relations or queries against stored data.
---

# Data Modeling

Let the database enforce what it can. Load the database's file from `references/` when the repository uses one.

## Checklist

- primary and foreign keys; what happens to children on delete
- unique constraints for every natural key and every "only one of" rule
- nullability: null only when absence is a real state
- types and precision (money, time zones, identifiers)
- expected data volume and growth
- how the data is queried and written, and by whom

## Rules

- Model from the existing schema's conventions: naming, key types, timestamps, soft delete.
- Every new index maps to an observed or required query pattern. Do not add indexes blindly; each one costs writes and space.
- Constraints belong in the database and in validation; one without the other drifts.
- Store secrets and tokens hashed or encrypted, never in plain columns or logs.
- A model change that alters existing data needs `database-migrations`.

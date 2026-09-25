---
name: postgresql
description: Baseline conventions for PostgreSQL: types, constraints, indexes, query plans and safe schema changes.
status: baseline
---

## Princípio

Use the database's strengths: precise types, constraints that enforce the domain, indexes chosen from query plans, and schema changes that avoid long locks.

## Quando aplicar

Projects using PostgreSQL directly or through an ORM.

## Quando não aplicar

Other databases, or SQL that must stay portable. Do not add extensions the project does not already use.

## Exemplo

```sql
ALTER TABLE notes ADD COLUMN archived_at timestamptz;

CREATE INDEX CONCURRENTLY notes_owner_active_idx
    ON notes (owner_id)
    WHERE archived_at IS NULL;

EXPLAIN ANALYZE
SELECT id, title FROM notes WHERE owner_id = 42 AND archived_at IS NULL ORDER BY id LIMIT 50;
```

Use `timestamptz` for instants, `numeric` for money, `uuid` or `bigint` keys as the project does. `CREATE INDEX CONCURRENTLY` avoids blocking writes (it cannot run inside a transaction block, so the migration tool needs an option for it). Adding a nullable column is cheap; adding a column with a volatile default or a `NOT NULL` without a default rewrites or fails. A failed `CREATE INDEX CONCURRENTLY` leaves an INVALID index behind: check `pg_index.indisvalid`, drop the invalid index and retry, or later queries and writes pay for an index that is never used. Check the plan with `EXPLAIN` (and `EXPLAIN ANALYZE` on disposable data) before and after adding an index.

## Fonte

PostgreSQL documentation (data types, indexes, ALTER TABLE, EXPLAIN); refined per project conventions.

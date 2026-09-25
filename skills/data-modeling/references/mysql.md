---
name: mysql
description: Baseline conventions for MySQL and MariaDB: InnoDB, character sets, types, indexes, online schema changes and query plans.
status: baseline
---

## Princípio

Use InnoDB with `utf8mb4`, model exact types (`DECIMAL` for money, `DATETIME`/`TIMESTAMP` chosen on purpose), let constraints enforce the domain, and change large tables with online DDL after reading the query plan.

## Quando aplicar

Projects using MySQL or MariaDB directly or through an ORM.

## Quando não aplicar

PostgreSQL or SQL Server projects, or SQL that must stay portable. Do not change a table's engine or character set as a side effect of an unrelated task.

## Exemplo

```sql
ALTER TABLE notes
  ADD COLUMN archived_at DATETIME NULL,
  ALGORITHM=INPLACE, LOCK=NONE;

CREATE INDEX notes_user_active ON notes (user_id, archived_at) ALGORITHM=INPLACE LOCK=NONE;

EXPLAIN ANALYZE
SELECT id, title FROM notes WHERE user_id = 42 AND archived_at IS NULL ORDER BY id LIMIT 50;
```

`TIMESTAMP` is stored in UTC and limited to 2038; `DATETIME` is not converted, so decide which one you mean and store instants in UTC. Index column order follows the query (equality first, then range, then sort). Avoid `SELECT *` and deep `OFFSET`; page with `WHERE id > ? ORDER BY id LIMIT`. The default isolation level is `REPEATABLE READ`; use `SELECT ... FOR UPDATE` for contended rows. On MySQL 8.0.12+ `ADD COLUMN` can use `ALGORITHM=INSTANT` (metadata only, no rebuild), which is preferable to `INPLACE`. Online DDL still waits for a metadata lock, so a long-running transaction on the table can queue the `ALTER` and every statement behind it; check for open transactions first. If the requested online algorithm is not supported, MySQL raises an error instead of blocking, which is the safe behavior: fall back to a tool such as `gh-ost` or `pt-online-schema-change` on large tables.

## Fonte

MySQL reference manual (InnoDB, online DDL, EXPLAIN, data types); refined per project conventions.

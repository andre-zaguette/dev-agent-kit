---
name: sqlserver
description: Baseline conventions for SQL Server: types, indexes, execution plans, online operations and snapshot isolation.
status: baseline
---

## Princípio

Choose precise types (`datetime2`, `decimal`, `nvarchar` only when Unicode is needed), design clustered and non-clustered indexes from the query plans, and run schema changes online where the edition supports it.

## Quando aplicar

Projects using SQL Server or Azure SQL directly or through an ORM.

## Quando não aplicar

PostgreSQL or MySQL projects. Do not enable database-level options (snapshot isolation, compatibility level) as a side effect of an unrelated task.

## Exemplo

```sql
ALTER TABLE dbo.Notes ADD ArchivedAt datetime2 NULL;

CREATE NONCLUSTERED INDEX IX_Notes_UserId_Active
  ON dbo.Notes (UserId)
  INCLUDE (Title)
  WHERE ArchivedAt IS NULL
  WITH (ONLINE = ON);

SET STATISTICS IO ON;
SELECT TOP (50) Id, Title FROM dbo.Notes WHERE UserId = @UserId AND ArchivedAt IS NULL ORDER BY Id;
```

Use `datetime2` instead of `datetime` and `decimal` for money. Read the actual execution plan and `SET STATISTICS IO` before and after adding an index; an included column can avoid a lookup. `ONLINE = ON` needs Enterprise or Azure SQL editions; check before relying on it. `READ_COMMITTED_SNAPSHOT` reduces reader/writer blocking but is a database-wide setting. Return generated keys with `OUTPUT INSERTED.Id` or `SCOPE_IDENTITY()`, never `@@IDENTITY`. Apply schema changes through the project's migration tool and never edit an applied migration.

## Fonte

SQL Server documentation (data types, indexes, execution plans, online index operations, isolation levels); refined per project conventions.

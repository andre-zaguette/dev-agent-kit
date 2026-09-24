---
name: database-migrations
description: Write schema and data migrations that are safe to deploy: reviewed for locks, backfills, volume and rollback or forward-fix, using the repository's migration tool. Use whenever a change alters the database schema or existing rows.
---

# Database Migrations

Use the repository's migration tool and conventions. Never edit a migration that has already been applied elsewhere.

## Review before writing

- primary/foreign keys, unique constraints, nullability, indexes
- data volume: how many rows will this touch?
- backfill: does existing data need a value?
- lock risk: which operations block reads or writes, and for how long?
- transaction duration
- rollback, or a forward-fix plan when rollback is unsafe

## Safe patterns

- Expand, then contract: add the new column nullable or with a safe default, backfill in batches, switch the code, tighten the constraint later.
- Create indexes in the way the database supports without blocking writes when the table is large.
- Keep schema changes and large data backfills in separate migrations.
- Make the migration re-runnable or clearly one-way, and say which.

## Rules

- Do not add indexes blindly; tie each to a query pattern, and look at the query plan when the database offers one.
- Production stays read-only unless explicitly authorized. Run migrations against a disposable database and report what you ran.
- Verify: apply the migration to a real database, exercise the affected queries, and confirm the tool reports no pending changes.

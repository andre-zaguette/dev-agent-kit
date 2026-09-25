---
name: rails
description: Baseline conventions for Rails services: thin controllers, strong parameters, ActiveRecord scoping, reversible migrations, jobs and request specs.
status: baseline
---

## Princípio

Follow Rails conventions: thin controllers, strong parameters, models with validations backed by database constraints, lookups scoped to the current user, and migrations that are reversible and safe on large tables.

## Quando aplicar

Projects whose `Gemfile` includes `rails`. Load `ruby.md` for language conventions and `postgresql.md` or `mysql.md` for the database.

## Quando não aplicar

Sinatra, Hanami or plain Ruby projects. Do not add service-object layers, gems (`strong_migrations`, Sidekiq) or patterns the project does not already use.

## Exemplo

```ruby
class NotesController < ApplicationController
  def archive
    note = current_user.notes.find(params[:id]) # scoped: another user's id raises 404
    note.update!(archived_at: Time.current) if note.archived_at.nil?
    render json: NoteSerializer.new(note)
  end
end

# db/migrate/20240201000000_add_archived_at_to_notes.rb (schema change, transactional)
class AddArchivedAtToNotes < ActiveRecord::Migration[7.1]
  def change
    add_column :notes, :archived_at, :datetime
  end
end

# db/migrate/20240201000100_add_index_on_notes_user_archived.rb (its own migration)
class AddIndexOnNotesUserArchived < ActiveRecord::Migration[7.1]
  disable_ddl_transaction!

  def change
    add_index :notes, %i[user_id archived_at], algorithm: :concurrently
  end
end
```

Use `includes` to avoid N+1, scopes for reusable queries, `transaction` for multi-step writes, and `find_by!`/`find` on scoped relations. Generate migrations with `bin/rails g migration` and never edit one that shipped. On PostgreSQL, build a large-table index with `algorithm: :concurrently` and `disable_ddl_transaction!` in **its own migration**, separate from the column change: if the index build fails the schema change stays applied and re-runnable, instead of leaving a half-applied migration and an INVALID index. `algorithm: :concurrently` is PostgreSQL-only; on MySQL rely on online DDL or a tool such as `gh-ost`. Make jobs idempotent and set retries. Keep secrets in credentials. Test with request specs.

## Fonte

Rails Guides (controllers, Active Record, migrations, Active Job, testing); refined per project conventions.

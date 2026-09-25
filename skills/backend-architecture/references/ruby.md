---
name: ruby
description: Baseline conventions for Ruby backend work: idioms, Bundler, keyword arguments, service objects and test tooling.
status: baseline
---

## Princípio

Write plain, readable Ruby 3: small objects with one public method, keyword arguments, `frozen_string_literal`, and Bundler (`bundle exec`) as the single way to run tools.

## Quando aplicar

Any Ruby backend with a `Gemfile`, with or without Rails. Load `rails.md` for Rails projects.

## Quando não aplicar

Ruby scripts or gems outside a backend. Do not add RuboCop rules, gems or a service-object convention the project does not already follow.

## Exemplo

```ruby
# frozen_string_literal: true

class ArchiveNote
  def self.call(...) = new(...).call

  def initialize(note_id:, user_id:, clock: Time)
    @note_id = note_id
    @user_id = user_id
    @clock = clock
  end

  def call
    note = Note.find_by(id: @note_id, user_id: @user_id)
    return :not_found unless note

    note.update!(archived_at: @clock.now) if note.archived_at.nil? # idempotent
    :archived
  end
end
```

Run tests with the framework in the `Gemfile` (`bundle exec rspec` or `bin/rails test`) and lint with `bundle exec rubocop` when configured. Never build SQL or shell commands from input; use parameterized queries. Keep secrets in credentials or environment variables.

## Fonte

Ruby documentation and community style guide; refined per project tooling.

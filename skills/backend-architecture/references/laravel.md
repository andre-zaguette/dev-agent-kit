---
name: laravel
description: Baseline conventions for Laravel services: controllers, form requests, policies, Eloquent, migrations, queues and tests.
status: baseline
---

## Princípio

Follow Laravel's flow: route, thin controller, form request for validation, policy or gate for authorization, action or service for the work, Eloquent for persistence, and an API resource for the response.

## Quando aplicar

Projects that require `laravel/framework`. Load `php-backend.md` for language conventions and `mysql.md` or `postgresql.md` for the database.

## Quando não aplicar

Symfony or plain PHP projects. Do not add packages (Pest, Sanctum, Horizon) the project does not already use.

## Exemplo

```php
final class ArchiveNoteController
{
    public function __invoke(ArchiveNoteRequest $request, Note $note): NoteResource
    {
        $this->authorize('archive', $note); // policy: $user->id === $note->user_id

        DB::transaction(function () use ($note) {
            $note->archived_at ??= now(); // idempotent: a second call keeps the first timestamp
            $note->save();
        });

        return new NoteResource($note);
    }
}

// migration: nullable so existing rows stay valid; index for the new query
Schema::table('notes', function (Blueprint $table) {
    $table->timestamp('archived_at')->nullable();
    $table->index(['user_id', 'archived_at']);
});
```

Eager load with `with()` to avoid N+1 queries; list writable attributes in `$fillable`; use route model binding scoped to the user (`->scopeBindings()`) so someone else's id is a 404. Create migrations with `php artisan make:migration` and never edit one that shipped. Queue work with `ShouldQueue` jobs that are idempotent and set `$tries` and `backoff`. Read `env()` only inside `config/` files. Test with `RefreshDatabase` and `actingAs`.

## Fonte

Laravel documentation (requests, authorization, Eloquent, migrations, queues, testing); refined per project conventions.

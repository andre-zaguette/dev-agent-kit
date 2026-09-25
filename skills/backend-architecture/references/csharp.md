---
name: csharp
description: Baseline conventions for C# backend work: nullable reference types, async with cancellation, records, dependency injection and configuration.
status: baseline
---

## Princípio

Write C# so the compiler catches mistakes: nullable reference types on, async all the way down with a `CancellationToken`, records for data, constructor injection by interface, and typed configuration through options.

## Quando aplicar

Any C# backend with a `.sln` or `.csproj`, with or without ASP.NET Core. Load `aspnet-core.md` for web projects.

## Quando não aplicar

Unity or desktop projects. Do not add analyzers, a mapping library or a mediator package the solution does not already use.

## Exemplo

```csharp
public sealed record ArchiveNote(Guid NoteId, Guid UserId);

public sealed class NoteService(INoteRepository notes, TimeProvider clock, ILogger<NoteService> logger)
{
    public async Task<bool> ArchiveAsync(ArchiveNote command, CancellationToken ct)
    {
        var note = await notes.FindOwnedAsync(command.NoteId, command.UserId, ct);
        if (note is null) return false;

        note.ArchivedAt ??= clock.GetUtcNow(); // idempotent
        await notes.SaveAsync(note, ct);
        logger.LogInformation("Note {NoteId} archived by {UserId}", note.Id, command.UserId);
        return true;
    }
}
```

Never block on tasks (`.Result`, `.Wait()`); pass the cancellation token through every call. Bind configuration with `IOptions<T>` and keep secrets in user secrets or the environment. Log with message templates, not string interpolation. Run `dotnet build` and `dotnet test` (and `dotnet format` if the solution uses it).

## Fonte

Microsoft .NET documentation (C# language, async programming, dependency injection, configuration); refined per solution conventions.

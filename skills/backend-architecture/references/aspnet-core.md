---
name: aspnet-core
description: Baseline conventions for ASP.NET Core APIs: endpoints, validation, ProblemDetails, authorization policies, EF Core and testing.
status: baseline
---

## Princípio

Keep endpoints thin, validate at the boundary, return `ProblemDetails` for errors, authorize with policies and resource checks, and let EF Core migrations own schema changes.

## Quando aplicar

Projects whose `.csproj` uses `Microsoft.NET.Sdk.Web` or references `Microsoft.AspNetCore`. Load `csharp.md` for language conventions.

## Quando não aplicar

Console or worker-only projects. Follow whether the project uses minimal APIs or controllers; do not mix styles or add FluentValidation, MediatR or AutoMapper if they are absent.

## Exemplo

```csharp
app.MapPost("/notes/{id:guid}/archive", async (Guid id, ClaimsPrincipal user, NoteService notes, CancellationToken ct) =>
{
    var archived = await notes.ArchiveAsync(new ArchiveNote(id, user.GetUserId()), ct);
    return archived
        ? Results.Ok()
        : Results.Problem(statusCode: 404, title: "Note not found", extensions: new Dictionary<string, object?> { ["code"] = "NOTE_NOT_FOUND" });
})
.RequireAuthorization("NotesWrite");

// EF Core: read without tracking, load related data explicitly, migrate with the tool
var notes = await db.Notes.AsNoTracking().Include(n => n.Tags).Where(n => n.UserId == userId).ToListAsync(ct);
// dotnet ef migrations add AddNoteArchivedAt   (never edit a migration that shipped)
```

Scope every query by the current user, use `AsNoTracking()` for reads, `Include` or projections to avoid N+1, transactions for multi-step writes, and `ProblemDetails` (`AddProblemDetails`) so errors share one shape. Add health checks and structured logging. Test with `WebApplicationFactory<Program>` against a throwaway database.

## Fonte

Microsoft ASP.NET Core and EF Core documentation (minimal APIs, authorization, error handling, migrations, testing); refined per project conventions.

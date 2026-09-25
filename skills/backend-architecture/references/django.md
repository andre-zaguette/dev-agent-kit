---
name: django
description: Baseline conventions for Django backend work: apps, models, querysets, transactions, settings and migrations.
status: baseline
---

## Princípio

Follow Django's layering: models own data rules and constraints, querysets and managers own queries, views stay thin, and every schema change is a migration.

## Quando aplicar

Projects with `manage.py` or `django` in their requirements.

## Quando não aplicar

Non-Django Python services. For REST endpoints on Django also load `drf.md`.

## Exemplo

```python
from django.db import models, transaction
from django.utils import timezone


class Note(models.Model):
    owner = models.ForeignKey("auth.User", on_delete=models.CASCADE, related_name="notes")
    title = models.CharField(max_length=200)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["owner", "title"], name="uniq_note_title_per_owner")]


def archive(note: Note) -> None:
    with transaction.atomic():
        locked = Note.objects.select_for_update().get(pk=note.pk)
        locked.archived_at = locked.archived_at or timezone.now()
        locked.save(update_fields=["archived_at"])
```

Use `select_related`/`prefetch_related` to avoid N+1 queries, `transaction.atomic()` around multi-step writes, `select_for_update()` for contended rows, and constraints in `Meta` instead of only in forms. On PostgreSQL create large-table indexes with `AddIndexConcurrently` (from `django.contrib.postgres.operations`) in a migration that sets `atomic = False`. Create migrations with `makemigrations`, review the generated file, and never edit one that shipped.

## Fonte

Django documentation (models, transactions, migrations); refined per project conventions.

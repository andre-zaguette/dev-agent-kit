---
name: drf
description: Baseline conventions for Django REST Framework: serializers, viewsets, permissions, querysets and pagination.
status: baseline
---

## Princípio

Let serializers validate and shape data, viewsets hold the request flow, permission classes enforce authorization, and `get_queryset` scope every query to what the caller may see.

## Quando aplicar

Projects with `djangorestframework` in their requirements.

## Quando não aplicar

Plain Django views or other REST stacks. Load `django.md` too for model and migration conventions.

## Exemplo

```python
class IsOwner(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        return obj.owner_id == request.user.id


class NoteViewSet(viewsets.ModelViewSet):
    serializer_class = NoteSerializer
    permission_classes = [permissions.IsAuthenticated, IsOwner]

    def get_queryset(self):
        return Note.objects.filter(owner=self.request.user)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)
```

Scope the queryset by owner so a wrong id is a 404, not a leak; set `owner` from `request.user`, never from the payload (`read_only_fields`); list `fields` explicitly instead of `__all__` to avoid mass assignment. Add custom actions with `@action`, and test permissions with an authenticated non-owner.

## Fonte

Django REST Framework documentation (serializers, permissions, viewsets); refined per project conventions.

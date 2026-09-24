---
name: php
description: Baseline conventions for implementing Figma designs in PHP projects (Laravel/Blade, or plain PHP templates).
status: baseline
---

## Princípio

In Laravel projects, implement UI as Blade components/partials under `resources/views/components/`, passing typed data from controllers; avoid inline business logic in templates. In plain PHP projects, separate template files from data-fetching/business logic explicitly (no direct DB queries inside a view file).

## Quando aplicar

Projects with a `composer.json` present, or `.php` template files with no JS framework driving the UI.

## Quando não aplicar

Laravel projects using Inertia.js to render React/Vue — in that case, follow `react.md`/`vuejs.md` for the actual component code, and treat this reference only for the PHP-side controller/route conventions.

## Exemplo

```blade
{{-- resources/views/components/card.blade.php --}}
@props(['title', 'description'])
<article class="card">
  <h3 class="card__title">{{ $title }}</h3>
  <p class="card__description">{{ $description }}</p>
</article>
```

```blade
<x-card :title="$product->name" :description="$product->summary" />
```

## Fonte

Laravel docs (Blade components); refined per-project via auto-bootstrap.

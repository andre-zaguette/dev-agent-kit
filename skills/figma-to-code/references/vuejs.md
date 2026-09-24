---
name: vuejs
description: Baseline conventions for implementing Figma designs in Vue 3.
status: baseline
---

## Princípio

Use `<script setup>` with the Composition API; define props/emits with `defineProps`/`defineEmits` and TypeScript types; keep single-file components focused on one UI responsibility.

## Quando aplicar

Projects whose `package.json` lists `vue` as a dependency without `nuxt`.

## Quando não aplicar

Nuxt projects — use `nuxt.md`, since routing/SSR conventions differ (file-based pages, auto-imports).

## Exemplo

```vue
<script setup lang="ts">
interface Props {
  title: string;
  description: string;
}
defineProps<Props>();
const emit = defineEmits<{ select: [] }>();
</script>

<template>
  <article class="card">
    <h3 class="card__title">{{ title }}</h3>
    <p class="card__description">{{ description }}</p>
    <button class="card__action" type="button" @click="emit('select')">
      Select
    </button>
  </article>
</template>
```

## Fonte

Vue 3 docs (Composition API, `<script setup>`); refined per-project via auto-bootstrap.

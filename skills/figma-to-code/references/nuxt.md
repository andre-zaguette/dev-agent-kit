---
name: nuxt
description: Baseline conventions for implementing Figma designs in Nuxt 3.
status: baseline
---

## Princípio

Use file-based routing under `pages/`, shared layout in `layouts/`, rely on Nuxt's auto-imports for components/composables instead of manual imports; use `useFetch`/`useAsyncData` for data loading over raw `fetch` in components.

## Quando aplicar

Projects whose `package.json` lists `nuxt` as a dependency.

## Quando não aplicar

Plain Vue 3 projects without Nuxt — use `vuejs.md`.

## Exemplo

```vue
<!-- pages/products/[id].vue -->
<script setup lang="ts">
const route = useRoute();
const { data: product } = await useFetch(`/api/products/${route.params.id}`);
</script>

<template>
  <ProductDetail v-if="product" :product="product" />
</template>
```

`ProductDetail` here is auto-imported from `components/ProductDetail.vue` — do not add a manual import for components already under Nuxt's auto-import roots.

## Fonte

Nuxt 3 docs (auto-imports, data fetching, file-based routing); refined per-project via auto-bootstrap.

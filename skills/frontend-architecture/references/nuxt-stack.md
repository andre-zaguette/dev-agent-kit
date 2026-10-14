---
name: nuxt-stack
description: Nuxt guide: directory conventions, auto-imports, useFetch and useAsyncData versus $fetch, server routes with defineEventHandler, runtimeConfig, useState, route middleware, rendering modes and testing.
status: guide
---

Targets: Nuxt 4 (the current docs, `docs/4.x`) with Vue 3 and TypeScript; Nuxt 3 differences are noted where they matter.

## Princípio

Follow Nuxt's conventions: file-based routing, composables for data, a `server/` directory for the API, and `runtimeConfig` for configuration. Fetch data with `useFetch` or `useAsyncData` so the server result is forwarded to the client, and use `$fetch` only for requests made from the browser in response to events.

## Quando aplicar

Projects with `nuxt` in `package.json`. Check the installed major first: Nuxt 4 puts app code under `app/` (the default `srcDir`) while keeping `server/`, `shared/`, `public/` and `modules/` at the root. The upgrade guide says existing Nuxt 3 layouts are detected, so a project may still use root-level `pages/`.

## Quando não aplicar

Plain Vue components and composables are covered by `vue-stack.md`; load it as well. Do not add Pinia, `@nuxt/test-utils`, a validation library or Nuxt modules if the project does not already use them. Do not move a Nuxt 3 project into `app/` unless asked.

## Exemplo

```vue
<script setup lang="ts">
const route = useRoute();

const { data: user, status, error, refresh } = await useFetch(
  () => `/api/users/${route.params.id}`,
  { key: `user:${route.params.id}` },
);

async function rename(name: string) {
  await $fetch(`/api/users/${route.params.id}`, { method: 'PATCH', body: { name } });
  await refresh();
}
</script>

<template>
  <p v-if="status === 'pending'">Loading</p>
  <p v-else-if="error">{{ error.statusText }}</p>
  <UserCard v-else-if="user" :user="user" @rename="rename" />
</template>
```

`useFetch` runs on the server during SSR and its result reaches the client in the payload, so there is no second request on hydration. The event handler runs only in the browser, which is why `$fetch` fits there. The getter URL makes the request follow the route param. `UserCard` is the project's own component, auto-imported from `components/`; the endpoint shape is illustrative.

## Estrutura do projeto

- `app/pages/` (file-based routes), `layouts/`, `components/`, `composables/`, `middleware/`, `plugins/`, `utils/`, plus `app.vue` and `error.vue`. In Nuxt 3 these sit at the project root.
- `server/api/` for API routes (prefixed `/api`), `server/routes/` for non-`/api` routes, `server/middleware/`, `server/plugins/`, `server/utils/`.
- `nuxt.config.ts` at the root holds `runtimeConfig`, `routeRules`, `ssr` and modules.
- Auto-imports cover Vue APIs, Nuxt composables and the `components/`, `composables/` and `utils/` directories. Treat them as an implementation detail: files outside Nuxt's scanned directories (tests, shared libraries, scripts) must import explicitly, and explicit imports are always allowed.
- Rendering: universal SSR is the default; `ssr: false` gives client-side rendering; `routeRules` mixes modes per path:

```ts
export default defineNuxtConfig({
  routeRules: {
    '/': { prerender: true },
    '/products/**': { swr: 3600 },
    '/admin/**': { ssr: false },
  },
});
```

The docs note that hybrid rendering is not available with `nuxt generate`.

## Dados e estado

- `useFetch` is a wrapper around `$fetch` on top of `useAsyncData`; use `useAsyncData` with your own handler for a CMS or SDK. Both return `data`, `error`, `status` (`idle`, `pending`, `success`, `error`), `refresh`/`execute` and `clear`.
- Give `useAsyncData` an explicit string key, for example `` useAsyncData(`user:${id}`, () => getUser(id)) ``; the docs recommend your own keys, especially in custom composables. Calls sharing a key share `data`, `error` and `status`, so their `handler`, `transform` and `default` must match.
- Re-fetch with `watch: [id]` or reactive values in options; a watched ref does not change the URL, so use a getter URL. `lazy: true` does not block navigation; handle `status` yourself.
- Nuxt 4 differences from 3: `data` and `error` default to `undefined` (not `null`), `data` is a `shallowRef` (use `deep: true` for deep mutation), `pending` is true only while `status` is `pending`.
- `useState('key', () => init)` is the SSR-safe shared state; its value is serialized, so no classes or functions. Do not declare `ref()` at module scope: the docs warn it shares state across server requests and can leak memory. Pinia only if the project already uses it.
- `useRuntimeConfig()` reads configuration. Declare keys in `nuxt.config.ts`; top-level keys are server-only, `public` keys also reach the browser. Environment variables override declared keys with the `NUXT_` prefix: `NUXT_API_SECRET`, and `NUXT_PUBLIC_API_BASE` for `public.apiBase`. The `.env` file is not read by the built server.

## Erros e validação

Server handlers live in `server/api` and are wrapped in `defineEventHandler`; a `.get.ts` or `.post.ts` suffix restricts the method:

```ts
import { z } from 'zod';

const body = z.object({ name: z.string().min(1).max(100) });

export default defineEventHandler(async (event) => {
  const id = Number.parseInt(getRouterParam(event, 'id') ?? '');
  if (!Number.isInteger(id)) {
    throw createError({ status: 400, statusText: 'ID should be an integer' });
  }
  const { name } = await readValidatedBody(event, body.parse);
  const { dbUrl } = useRuntimeConfig(event);
  return renameUser(dbUrl, id, name);
});
```

Save as `server/api/users/[id].patch.ts`. `createError` produces the HTTP error; `getValidatedQuery` and `readValidatedBody` take a schema validator such as Zod or Valibot (the docs name both, with no full example, so the `body.parse` wiring is a guide convention). `renameUser` and `dbUrl` are the project's own. Pass `event` to `useRuntimeConfig` on the server so environment overrides apply at runtime.

Route middleware guards navigation: `defineNuxtRouteMiddleware((to) => { if (!loggedIn()) return navigateTo('/login'); })`, attached with `definePageMeta({ middleware: 'auth' })`. Return a value instead of calling `next`; `abortNavigation()` cancels. A `.global` suffix runs on every route. It runs on the server and again on the client for the first load; guard with `import.meta.server` or `import.meta.client` when needed.

## Testes

Only if the project uses them: `@nuxt/test-utils` with Vitest. The docs configure a Vitest project with `defineVitestProject` and `environment: 'nuxt'` for tests that need auto-imports and plugins, and plain `node` projects for unit tests.

```ts
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime';
import { expect, it } from 'vitest';
import UserPage from '~/pages/users/[id].vue';

registerEndpoint('/api/users/1', () => ({ id: 1, name: 'Ada' }));

it('renders the user', async () => {
  const wrapper = await mountSuspended(UserPage, { route: '/users/1' });
  expect(wrapper.text()).toContain('Ada');
});
```

`mountSuspended` wraps `@vue/test-utils` `mount` with async setup and Nuxt injections; `registerEndpoint` mocks a Nitro endpoint; `mockNuxtImport` replaces an auto-import and can be used once per import per file. The `nuxt` environment initializes a global app, so avoid mutating global state.

## Armadilhas

- Browser APIs (`window`, `localStorage`) during SSR; use `onMounted`, `import.meta.client` or `<ClientOnly>`, which renders its slot only on the client and accepts a `#fallback` slot for server HTML.
- Hydration mismatches from output that differs between server and client (dates, random values, browser-only state); compute them in `onMounted` or share them through `useState`.
- Fetching in `onMounted` instead of `useFetch`/`useAsyncData`: it skips SSR and the payload, and users see an empty page first.
- Calling bare `$fetch` in setup: it can fetch twice and cause hydration issues.
- Non-unique or call-site-derived `useAsyncData` keys inside shared composables, which silently share state.
- Putting a secret under `runtimeConfig.public`, or passing it to `useState` or rendering it in a component.
- Importing server-only code (database clients, secrets) into `app/` files; keep it under `server/`.
- Reading `runtimeConfig` keys that are not declared in `nuxt.config.ts`: environment variables cannot create them.

## Fonte

Nuxt documentation: https://nuxt.com/docs/4.x/getting-started/data-fetching, https://nuxt.com/docs/4.x/directory-structure, https://nuxt.com/docs/4.x/directory-structure/server, https://nuxt.com/docs/4.x/guide/going-further/runtime-config, https://nuxt.com/docs/4.x/getting-started/state-management, https://nuxt.com/docs/4.x/directory-structure/app/middleware, https://nuxt.com/docs/4.x/guide/concepts/rendering, https://nuxt.com/docs/4.x/api/components/client-only, https://nuxt.com/docs/4.x/getting-started/testing, https://nuxt.com/docs/4.x/getting-started/upgrade.

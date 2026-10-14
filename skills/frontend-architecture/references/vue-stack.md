---
name: vue-stack
description: Vue 3 guide: script setup with TypeScript, typed props and emits, defineModel, composables, reactivity rules, Pinia, Vue Router, v-for keys and testing with Vitest and Vue Test Utils.
status: guide
---

Targets: Vue 3 with TypeScript (`defineModel` needs 3.4+; destructuring props reactively needs 3.5+; Vue 2 reached end of life on 31 Dec 2023), Vue Router 4+ and Pinia when the project uses them.

## Princípio

Write components with the Composition API and `<script setup lang="ts">`. Keep reusable stateful logic in composables, derive values with `computed` instead of copying them, and let data flow down through props and up through events. Use the Options API only when the project already uses it, and match its style in those files.

## Quando aplicar

Single-file components in a Vue 3 project (Vite-based or Nuxt). Read `package.json` for the installed Vue version before using `defineModel` or destructured props: older 3.x releases lack them.

## Quando não aplicar

Nuxt-specific concerns (auto-imports, `useFetch`, `server/`) belong to `nuxt-stack.md`. Do not add Pinia, Vue Router, Vitest or a form library if the project does not already use them; follow what is installed. Do not rewrite Options API components to `<script setup>` unless asked.

## Exemplo

```vue
<script setup lang="ts">
import { computed } from 'vue';

interface Item {
  id: number;
  name: string;
  active: boolean;
}

const props = defineProps<{ items: Item[]; title?: string }>();
const emit = defineEmits<{ select: [id: number] }>();
const query = defineModel<string>({ default: '' });

const visible = computed(() =>
  props.items.filter((item) => item.active && item.name.includes(query.value)),
);
</script>

<template>
  <h2>{{ title ?? 'Items' }}</h2>
  <input v-model="query" />
  <ul>
    <li v-for="item in visible" :key="item.id" @click="emit('select', item.id)">
      {{ item.name }}
    </li>
  </ul>
</template>
```

`defineProps` and `defineEmits` take type arguments (the named-tuple emit form is Vue 3.3+). `defineModel` returns a ref synced with the parent's `v-model`; the docs warn that a `default` can desynchronize parent and child when the parent supplies no value. The filtering lives in a `computed`, not in a `v-if` on the `v-for` element. Item shape and names here are illustrative.

## Estrutura do projeto

- Presentational components receive props and emit events; smart containers fetch data, talk to stores and pass results down. This split is a guide convention, not a rule from the docs.
- Name composables `useX` in camelCase and call them synchronously in `<script setup>` or `setup()`. The docs recommend returning a plain object of refs, so callers can destructure without losing reactivity:

```ts
import { onMounted, onUnmounted, ref } from 'vue';

export function useWindowWidth() {
  const width = ref(0);
  const update = () => (width.value = window.innerWidth);
  onMounted(() => {
    update();
    window.addEventListener('resize', update);
  });
  onUnmounted(() => window.removeEventListener('resize', update));
  return { width };
}
```

- Accept refs or getters as composable inputs and read them with `toValue()` inside `watchEffect` or `watch` so changes are tracked.
- Use `provide`/`inject` for narrow cases such as a compound component or a theme; props stay the default way to pass data.
- Lazy-load route components with `component: () => import('./views/UserDetails.vue')`; Vue Router loads it on first visit and caches it.

## Dados e estado

- `ref()` is the docs' primary API for state. `reactive()` only holds objects, cannot be reassigned as a whole, and destructuring its properties disconnects them from the source.
- Use `toRefs` for a `reactive` object and `storeToRefs` for a Pinia store when destructuring state or getters. Actions are bound to the store and can be destructured directly.
- Derived data is a `computed`; use `watch` for side effects such as saving or calling an API, not to copy one ref into another.
- Pinia, only if the project uses it: option stores (`state`, `getters`, `actions`) or setup stores (`ref` becomes state, `computed` becomes getters, functions become actions). A setup store must return all its state properties. Keep state minimal and expose the rest as getters.
- Route params are strings; convert them (`Number(route.params.id)`) before use and validate the result.

## Erros e validação

- Declare prop types; the style guide's essential rules ask for detailed prop definitions, which type-based `defineProps` gives you. Mark required props by omitting `?`.
- Validate forms on submit and on blur with the project's validation library; a hand-rolled check is a `computed` returning an error map, disabled submit derived from it. Do not add a form library the project lacks.
- In router guards return the result instead of calling `next`: `router.beforeEach((to) => (isAllowed(to) ? undefined : '/login'))`. Returning `false` cancels, a route location redirects, `undefined` continues. The docs discourage the `next` argument.
- Handle async errors where the call happens (`try/catch` around the request, an `error` ref in the composable), and surface them in the template.

## Testes

Only if the project uses them: the docs recommend Vitest and `@vue/test-utils`, and say to test what a component does, not how. Assert on rendered DOM and emitted events, not private state, and avoid snapshots as the only check.

```ts
import { mount, flushPromises } from '@vue/test-utils';
import { expect, it } from 'vitest';
import ItemList from './ItemList.vue';

it('emits select when an item is clicked', async () => {
  const wrapper = mount(ItemList, { props: { items: [{ id: 1, name: 'a', active: true }] } });
  await wrapper.find('li').trigger('click');
  await flushPromises();
  expect(wrapper.emitted('select')?.[0]).toEqual([1]);
});
```

`await` on `trigger()` waits for the DOM update; use `await nextTick()` after other state changes and `flushPromises()` after mocked async calls. Prefer `mount`; the docs advise against mocking child components, so use `shallowMount` sparingly. Mock the network boundary, not the component internals.

## Armadilhas

- Mutating a prop; emit an event or use `defineModel` instead.
- `v-if` and `v-for` on the same element (`v-if` runs first and cannot see the loop variable); filter with a `computed`.
- `v-for` without a stable, unique `:key`, or with the array index when items reorder.
- Forgetting `.value` on a ref in script (templates unwrap it automatically).
- Destructuring a `reactive` object or a store and expecting updates.
- Stale closures in watchers: read the current value inside the callback or use a getter source.
- Large deeply reactive objects; the docs offer `shallowRef` for big structures replaced as a whole.
- Listeners, timers and observers not removed in `onUnmounted`.
- Calling a composable asynchronously or outside `setup`.

## Fonte

Vue documentation: https://vuejs.org/guide/essentials/reactivity-fundamentals.html, https://vuejs.org/guide/typescript/composition-api.html, https://vuejs.org/guide/components/v-model.html, https://vuejs.org/guide/reusability/composables.html, https://vuejs.org/guide/scaling-up/testing.html, https://vuejs.org/style-guide/. Vue Router: https://router.vuejs.org/guide/advanced/lazy-loading.html, https://router.vuejs.org/guide/advanced/navigation-guards.html. Pinia: https://pinia.vuejs.org/core-concepts/.

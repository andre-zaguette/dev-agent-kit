---
name: next-stack
description: Next.js App Router guide: file conventions, Server and Client Components, data fetching and caching, Server Actions, Route Handlers, async params, environment variables, proxy and middleware, errors and testing.
status: guide
---

Targets: Next.js 15 and 16, App Router, with React 19 and TypeScript. The current docs describe 16.x; where 15 (and 14) behave differently it is noted in one line. The Pages Router is not covered.

## Princípio

Render on the server by default and add the smallest possible `'use client'` island where interactivity needs it. Fetch data in Server Components close to where it is used, mutate with Server Actions, and treat every Server Action and Route Handler as a public HTTP endpoint that must authenticate, authorize and validate on its own.

## Quando aplicar

Projects with `next` in `package.json` and an `app/` (or `src/app/`) directory. Read the installed major first (guide convention); the differences that matter:

- Caching: 14 cached `fetch` and GET Route Handlers by default; since 15 they are not cached by default. 16 adds opt-in Cache Components (`cacheComponents: true`, `'use cache'`).
- Request APIs: 15 made `params`, `searchParams`, `cookies()`, `headers()` and `draftMode()` async, with temporary synchronous access and a dev warning; 16 removed synchronous access.
- `revalidateTag(tag)` takes one argument up to 15; 16 requires a second `cacheLife` profile argument, for example `revalidateTag('posts', 'max')`, and adds `updateTag` (Server Actions only) for read-your-writes.
- Middleware: the file is `middleware.ts` up to 15; 16 deprecates it and renames it `proxy.ts` (Node.js runtime; keep `middleware` if you need the edge runtime).

## Quando não aplicar

This guide covers the Next.js layer only, not general React component design. Do not assume Cache Components, `src/`, Tailwind, an auth library, Zod, Server Actions or a particular test runner: check `next.config.*` and `package.json`. Do not add `'use cache'` unless `cacheComponents` is enabled, and do not rename `middleware.ts` to `proxy.ts` on a 15 project unless asked.

## Exemplo

```tsx
// app/posts/[id]/page.tsx (Server Component, no directive)
import { notFound } from 'next/navigation';
import { LikeButton } from './like-button';
import { getComments, getPost } from '@/lib/data';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [post, comments] = await Promise.all([getPost(id), getComments(id)]);
  if (!post) notFound();
  return (
    <article>
      <h1>{post.title}</h1>
      <LikeButton postId={post.id} likes={post.likes} />
      <ul>{comments.map((c) => <li key={c.id}>{c.text}</li>)}</ul>
    </article>
  );
}
```

```tsx
// app/posts/[id]/like-button.tsx
'use client';
import { useActionState } from 'react';
import { like } from '../actions';

export function LikeButton({ postId, likes }: { postId: string; likes: number }) {
  const [state, action, pending] = useActionState(like.bind(null, postId), { likes });
  return <form action={action}><button disabled={pending}>{state.likes} likes</button></form>;
}
```

```ts
// app/posts/actions.ts
'use server';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { addLike } from '@/lib/data';

export async function like(postId: string, _prev: { likes: number }) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  if (!/^\d+$/.test(postId)) return _prev;
  const likes = await addLike(postId, session.user.id);
  revalidatePath(`/posts/${postId}`);
  return { likes };
}
```

`await params` is required from 15; the two requests start together instead of in sequence. Only `postId` and `likes` cross the boundary, and both are serializable. The action re-checks the session itself because it is reachable by a direct POST. `auth`, `getPost`, `getComments`, `addLike` and the `@/lib` alias are the project's own; the id check is illustrative (guide convention), use the project's validator. `bind` for extra arguments is from the forms guide.

## Estrutura do projeto

- `app/` holds routes. Folders are URL segments; a route is public only when it contains `page.tsx` or `route.ts`, so other files can be colocated safely. Special files: `layout`, `page`, `loading`, `error`, `not-found`, `global-error`, `route`, `template`, `default`.
- `[slug]`, `[...slug]` and `[[...slug]]` are dynamic segments; `(group)` organizes or splits layouts without changing the URL; `_folder` opts a folder out of routing; `@slot` is a parallel route (16 requires an explicit `default.tsx` for each slot).
- A `page.tsx` and a `route.ts` cannot sit in the same segment. `error.tsx` does not wrap the `layout.tsx` of its own segment (use `global-error.tsx` for the root layout).
- Rendering order inside a segment: `layout`, `template`, `error`, `loading`, `not-found`, then `page`. `loading.tsx` is a Suspense boundary for the page; a layout that reads runtime data is not covered by its own segment's `loading.tsx`, so put `<Suspense>` closer to the data.
- Where to put code (`components/`, `lib/`, `src/`) is the project's choice; the docs are unopinionated. Follow what exists.
- Route Handler: `app/api/items/[id]/route.ts` exporting `GET`, `POST`, and so on. Since 15, `GET` is not cached unless you opt in with `export const dynamic = 'force-static'`; the second argument carries `params` as a Promise:

```ts
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return Response.json({ id });
}
```

## Dados e estado

- Server Components are `async` and can `await` `fetch`, an ORM or a database. Identical `fetch` calls in one render are memoized; for an ORM wrap the function in `React.cache`.
- Avoid waterfalls: start independent requests first and `await Promise.all`; use `<Suspense>` or `loading.tsx` to stream slow parts. Sequential awaits are fine only when one request needs the other's result.
- Caching up to 15 and in 16 without Cache Components: `fetch(url, { cache: 'force-cache' })` or `{ next: { revalidate: 3600, tags: ['posts'] } }` opts in; `unstable_cache` wraps non-fetch functions. With Cache Components (16): add `'use cache'` to a function or component, pair it with `cacheLife` and `cacheTag`, and wrap uncached or runtime reads in `<Suspense>`.
- After a mutation, call `revalidatePath('/posts')` or `revalidateTag('posts', 'max')` (16) inside the action, before any `redirect()`, which throws and ends the function. `refresh()` (16) only refreshes the client router and does not revalidate tagged data.
- `'use client'` marks a boundary: the file's imports are in the client bundle, but Server Components passed as `children` stay on the server. Props must be serializable; functions and class instances cannot cross. Context needs a Client Component provider rendered as deep as possible.
- Request APIs: `const store = await cookies()`, `await headers()`; reading them makes the render request-time. Never trust `searchParams` or params for authorization.
- Environment variables are server-only unless prefixed `NEXT_PUBLIC_`; those are inlined into the client bundle at `next build`, dynamic lookups such as `process.env[name]` are not, and an unprefixed variable read in client code becomes an empty string. To read a server variable at runtime instead of build time, `await connection()` (from `next/server`) first. `.env.local` is not loaded when `NODE_ENV` is `test`.
- Prefer one data approach per project; for new code the docs recommend a server-only Data Access Layer that authorizes and returns minimal DTOs instead of whole rows.

## Erros e validação

- Expected errors (validation, failed request) are return values: the action returns `{ message }` and the client reads it from `useActionState`; do not throw for them. Unexpected errors throw to the nearest `error.tsx`.
- `error.tsx` must be a Client Component. Props: `error` (with `error.digest` to match server logs; the production message from Server Components is generic) and `reset()`, which re-renders the children without refetching. 16.2 added `unstable_retry`, stable as `retry` in 16.3, which refetches and re-renders and is what the current docs show. On 15 only `reset` exists (follows from the version history), so use it there.
- `notFound()` plus `not-found.tsx` renders the 404 UI. Error boundaries do not catch errors in event handlers: catch them and store them in state.
- Validate every action input on the server with the project's schema library; the docs use Zod or Valibot and `safeParse`. Client attributes such as `required` are only a convenience.
- Authenticate and authorize inside each action and Route Handler: a check in the page does not protect the action, and a `proxy`/`middleware` matcher can skip it (the docs state a Server Function is a POST to the route where it is used). Check resource ownership, not only login.
- Return only what the UI needs from an action; do not return raw database records. Unused exported actions are removed from the client bundle and action IDs are encrypted, but the docs still say to treat them as public endpoints.
- `useFormStatus` (`react-dom`) works only in a child component rendered inside the `<form>`; in a component that owns the form, use the `pending` from `useActionState`.
- The proxy or middleware file lives at the project root (or `src/`), runs before routes, and should use a `matcher` that excludes `_next/static`, `_next/image` and assets; the docs call it a last resort, and it must not be the only authorization layer.

## Testes

Only if the project uses them. Unit-test pure functions and synchronous or client components with the project's runner; the docs' Vitest setup uses `vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@testing-library/dom` and `vite-tsconfig-paths`, with `environment: 'jsdom'`. The docs state that Vitest does not support `async` Server Components and recommend end-to-end tests (Playwright or Cypress) for them. Do not add a runner, an e2e tool or `@next/env` to a project that has none. In tests, `.env.test` is loaded and `.env.local` is not; `loadEnvConfig` from `@next/env` loads variables the way Next.js does. Test a Server Action's logic by extracting it into a plain function, and cover the form flow end to end (guide convention).

## Armadilhas

- Leaking secrets: an unprefixed variable in a Client Component is empty; a `NEXT_PUBLIC_` secret is public. Do not pass whole database rows to Client Components; select fields.
- Importing server code (database client, secrets) into a client module: add `import 'server-only'` to those modules so the build fails instead.
- `'use client'` at the top of a layout or page pulls the whole subtree into the bundle; mark only the interactive leaf.
- Sequential `await`s in one component creating waterfalls.
- Reading `params`, `searchParams`, `cookies()` or `headers()` without `await` (a warning on 15, an error on 16).
- Stale data after a mutation because no `revalidatePath` or `revalidateTag` ran, or `redirect()` was called first.
- Defining a Server Action inline in a Client Component (not possible): put it in a `'use server'` file and import it.
- Closures in inline actions capture values; Next.js encrypts them, but the docs advise against relying on that for secrets.
- Assuming `GET` handlers and `fetch` are cached (14 behavior) or that `revalidateTag('x')` compiles on 16.

## Fonte

Next.js documentation: https://nextjs.org/docs/app/getting-started/project-structure, https://nextjs.org/docs/app/getting-started/server-and-client-components, https://nextjs.org/docs/app/getting-started/fetching-data, https://nextjs.org/docs/app/getting-started/caching, https://nextjs.org/docs/app/guides/caching-without-cache-components, https://nextjs.org/docs/app/getting-started/mutating-data, https://nextjs.org/docs/app/guides/forms, https://nextjs.org/docs/app/getting-started/route-handlers, https://nextjs.org/docs/app/getting-started/error-handling, https://nextjs.org/docs/app/api-reference/file-conventions/error, https://nextjs.org/docs/app/api-reference/file-conventions/proxy, https://nextjs.org/docs/app/guides/data-security, https://nextjs.org/docs/app/guides/environment-variables, https://nextjs.org/docs/app/guides/testing, https://nextjs.org/docs/app/guides/testing/vitest, https://nextjs.org/docs/app/guides/upgrading/version-15, https://nextjs.org/docs/app/guides/upgrading/version-16.

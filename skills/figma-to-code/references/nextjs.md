---
name: nextjs
description: Baseline conventions for implementing Figma designs in Next.js (App Router).
status: baseline
---

## Princípio

Default to Server Components; only mark a component `'use client'` when it needs state, effects, or browser-only APIs. Keep route-level layout in `layout.tsx`, page content in `page.tsx`.

## Quando aplicar

Projects whose `package.json` lists `next` as a dependency.

## Quando não aplicar

Plain React projects without Next.js routing — use `react.md`. Pages Router projects (`pages/` directory present, no `app/`) follow the same component conventions but route files live under `pages/`, not `app/`.

This reference targets Next.js 15+ (App Router with async `params`/`searchParams`). Next.js 13-14 used the synchronous form (`params: { id: string }`, no `await`) — check the project's `next` version in `package.json` before applying the async signature below.

## Exemplo

```tsx
// app/products/[id]/page.tsx — Server Component by default (Next.js 15+, params is a Promise)
export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProduct(id);
  return <ProductDetail product={product} />;
}

// components/AddToCartButton.tsx — needs interactivity
'use client';
export function AddToCartButton({ productId }: { productId: string }) {
  const [pending, setPending] = useState(false);
  // ...
}
```

## Fonte

Next.js docs (App Router conventions); refined per-project via auto-bootstrap.

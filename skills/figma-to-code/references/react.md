---
name: react
description: Baseline conventions for implementing Figma designs in React (with TypeScript).
status: baseline
---

## Princípio

Build UI as small, typed function components; keep presentational components free of data-fetching logic; colocate a component's styles/tests next to its file.

## Quando aplicar

Any project whose `package.json` lists `react` as a dependency without `next` (plain React + Vite/CRA/other bundler).

## Quando não aplicar

Projects using Next.js — use `nextjs.md` instead, since routing/data-fetching conventions differ (Server/Client Components).

## Exemplo

```tsx
interface CardProps {
  title: string;
  description: string;
  onSelect: () => void;
}

export function Card({ title, description, onSelect }: CardProps) {
  return (
    <article className="card">
      <h3 className="card__title">{title}</h3>
      <p className="card__description">{description}</p>
      <button className="card__action" type="button" onClick={onSelect}>
        Select
      </button>
    </article>
  );
}
```

Map a Figma component instance to a props interface built from its variant/property list; prefer composition (children) over prop explosion for layout slots.

## Fonte

React docs (react.dev) general component conventions; refined per-project via the auto-bootstrap mechanism described in `component-selection/SKILL.md`.

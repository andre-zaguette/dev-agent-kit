---
name: tailwind
description: Baseline conventions for styling Figma implementations with Tailwind CSS.
status: baseline
---

## Princípio

Map Figma variables/tokens to the project's `tailwind.config` theme extensions (colors, spacing, font sizes) instead of using arbitrary value syntax (`w-[123px]`) by default; reserve arbitrary values for one-off cases with no matching token.

This principle targets Tailwind v3, where theme tokens live in `tailwind.config.js`'s `theme.extend` block (see the example below). Tailwind v4 moves configuration into CSS via an `@theme` block instead — no `tailwind.config.js` extend step is required. Check the project's `tailwindcss` version in `package.json` before assuming which form applies.

## Quando aplicar

Projects whose `package.json` lists `tailwindcss` as a dependency, regardless of the JS framework used alongside it.

## Quando não aplicar

Projects using a different styling approach (CSS Modules, styled-components, plain CSS/SCSS, a separate design-system's own class API) — check the project's actual styling setup before assuming Tailwind, even if a Figma reference mentions utility classes.

## Exemplo

```html
<!-- Figma variable color/brand/500 maps to theme.colors.brand[500] -->
<button class="bg-brand-500 px-4 py-2 rounded-md text-white hover:bg-brand-600">
  Add to cart
</button>
```

```js
// tailwind.config.js
theme: {
  extend: {
    colors: { brand: { 500: '#4f46e5', 600: '#4338ca' } }
  }
}
```

## Fonte

Tailwind CSS docs (theme configuration); refined per-project via auto-bootstrap.

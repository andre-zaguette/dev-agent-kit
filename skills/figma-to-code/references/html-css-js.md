---
name: html-css-js
description: Baseline conventions for implementing Figma designs with plain HTML, CSS and JavaScript (no framework).
status: baseline
---

## Princípio

Use semantic HTML elements matching the Figma layer's real role (not `div` for everything); scope component styles with a clear naming convention (e.g. BEM) when there is no build-time CSS scoping tool; keep DOM-manipulation JavaScript in small, named functions attached via `addEventListener`, not inline `onclick` attributes.

## Quando aplicar

Projects with no frontend framework dependency in `package.json` (or no `package.json` at all) — static sites, server-rendered templates without a JS framework layer.

## Quando não aplicar

Any project that already depends on React/Vue/Angular/etc. — use the matching stack reference instead, even for a single "simple" page inside a larger framework-based app.

## Exemplo

```html
<article class="card">
  <h3 class="card__title">Product name</h3>
  <p class="card__description">Short summary</p>
  <button class="card__action" type="button">Add to cart</button>
</article>
```

```js
document.querySelectorAll('.card__action').forEach((btn) => {
  btn.addEventListener('click', () => addToCart(btn.closest('.card').dataset.productId));
});
```

## Fonte

MDN Web Docs (semantic HTML, event handling); refined per-project via auto-bootstrap.

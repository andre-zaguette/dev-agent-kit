---
name: frontend-design
description: General UI heuristics for hierarchy, spacing, composition and interface states, used when Figma does not fully specify a detail. Use alongside figma-to-code, or standalone for non-Figma UI work.
---

# Frontend Design

Apply when there is no Figma source, or Figma does not define a specific detail (e.g. a hover state, an empty state, an error state).

## Heuristics

1. Visual hierarchy: one primary action per view; secondary actions visually subordinate.
2. Spacing: use the project's existing spacing scale/tokens; never invent arbitrary pixel values when a token exists.
3. Density: match the density of the surrounding screens in the same product, not a generic default.
4. Composition: group related fields/actions; keep unrelated elements visually separated.
5. States: every interactive element needs a default, hover/focus, active, disabled and (when relevant) loading/error state — even when Figma only shows the default state.
6. Consistency: reuse the same component/pattern for the same kind of interaction across the app, rather than introducing a new one-off pattern.

## When not to apply

- When Figma explicitly defines the detail in question — Figma wins (see `figma-to-code` priority order).
- When the repository has an established pattern that conflicts with a generic heuristic here — the repository's real pattern wins.

## Rules

- Do not invent a new color, spacing or type value when an existing token covers the case.
- Do not add a UI pattern that has no precedent in the codebase without flagging it as a deliberate new pattern.

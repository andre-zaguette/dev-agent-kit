---
name: responsive-design
description: Breakpoints, fluid typography and layout reflow rules for validating and implementing responsive behavior. Use whenever a UI implementation needs to be checked or built across multiple viewport sizes.
---

# Responsive Design

## Default breakpoints

| Name | Width x Height |
|---|---|
| Desktop | 1440 x 900 |
| Laptop | 1280 x 800 |
| Tablet | 768 x 1024 |
| Mobile | 390 x 844 |

Projects may override these in `.frontend-agent/config.yml` under a `breakpoints:` key — when present, the project's values always win over these defaults.

## Workflow

1. Read `.frontend-agent/config.yml` for project-specific breakpoints; fall back to the defaults above.
2. After implementing a view, check it at each configured breakpoint.
3. Verify: no horizontal scroll/overflow, no clipped or overlapping content, touch targets remain usable on mobile widths, navigation collapses/adapts as expected.
4. For typography and spacing that scale fluidly, follow the project's existing fluid-scale tokens if present; otherwise use CSS `clamp()` bound to the project's type scale rather than fixed per-breakpoint values.

## Rules

- A layout that only works at the exact Figma frame width is not done — it must reflow sanely at every configured breakpoint.
- Do not hardcode breakpoint values inline when the project already defines them as tokens/variables.

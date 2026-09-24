---
name: accessibility
description: Semantic HTML, ARIA, keyboard and contrast rules, plus the error/warning severity split used to gate task completion. Use on every UI implementation task, Figma-based or not.
---

# Accessibility

## Workflow

1. Prefer semantic HTML elements (`button`, `nav`, `main`, `label`, heading levels in order) over generic `div`/`span` with ARIA bolted on.
2. Add ARIA only when semantic HTML cannot express the pattern (e.g. a custom combobox).
3. Every interactive element must be reachable and operable by keyboard alone, with a visible focus state.
4. Every form input needs a programmatically associated label.
5. Verify text/background color contrast against the project's actual token values, not just the Figma preview colors (rendering can differ).
6. Run the project's accessibility audit tooling when available (e.g. via the `visual-validation` skill's browser tooling once the kit's own MCP is installed in v0.2+; until then, review manually against this checklist).

## Severity split

- **error** (blocks task completion): a button/link with no accessible name, an input with no label, a critical contrast failure, a heading hierarchy that skips levels in a way that breaks screen-reader navigation, an interactive element unreachable by keyboard.
- **warning** (recorded, evaluated, does not block): minor contrast issues on non-critical text, missing but non-essential `aria-describedby`, redundant ARIA that doesn't break anything.

## Rules

- Do not report a UI task as done while any `error`-severity issue remains open.
- Document `warning`-severity issues in the task's validation summary rather than silently dropping them.

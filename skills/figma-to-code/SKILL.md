---
name: figma-to-code
description: Implements frontend interfaces from Figma designs with high visual fidelity, detecting the target framework and orchestrating validation. Use when a task references a Figma frame, Figma URL, or a design-to-code implementation request.
---

# Figma to Code

Treat Figma as the primary source of truth. When Figma does not define something, defer to `frontend-design`.

## Priority order

1. Figma
2. Project's real design system
3. Existing components in the codebase
4. Existing design tokens
5. Frontend Agent Kit skills (this kit)
6. External references (catalog only, never a source of truth)

## Workflow

1. Receive the task: Figma URL, target framework/stack, target file/route, extra requirements.
2. Detect the project's stack by reading its config files (`package.json`, `composer.json`, or the absence of any — plain HTML/CSS/JS). Do not assume a framework.
3. Load the stack reference at `references/<stack>.md`. Also load any styling/platform reference that independently matches the project (e.g. `tailwind.md` alongside `react.md` for a React + Tailwind project); if their guidance conflicts, the framework/language reference wins. If the stack reference does not exist yet:
   - Infer conventions from the existing code in the repository plus general knowledge of that stack.
   - Draft `references/<stack>.md` following the standard reference format (see `component-selection` skill for the format).
   - Mark the new file's frontmatter with `status: draft-auto`.
   - Tell the user, in one line, that a new stack reference was created and should be reviewed.
   - Continue the task using the freshly drafted reference.
4. If the stack is one of the 8 pre-populated bases (react, nextjs, vuejs, nuxt, angular, tailwind, php, html-css-js) and the task reveals a convention that diverges from the existing reference, merge the learning into the file incrementally (never overwrite from scratch) and keep/set `status: draft-auto` on the changed section until reviewed.
5. Inspect the repository: existing components, design tokens, theme, routing, CSS approach, lint/test/typecheck commands.
6. Call the Figma MCP for design context, screenshot and variable/token definitions (`get_design_context`, `get_screenshot`, `get_variable_defs`). Use `get_metadata`, `get_motion_context`, `download_assets` or Code Connect data when relevant.
7. Build a mapping from Figma nodes to existing repository components and tokens. Use the `component-selection` skill's precedence rule before creating anything new.
8. Implement the page/component, using real Figma assets — never placeholder assets when real ones are available.
9. Run the application and capture a screenshot at the target viewport (delegates to `visual-validation`).
10. Run visual validation and fix meaningful mismatches, following the project's configured `validationProfile` (`pixel-perfect`, `standard` or `relaxed` — default `standard`).
11. If the implementation includes interactive or animated elements (hover/focus transitions, enter/exit animations, microinteractions), run the `motion-design` skill to validate timing, easing and `prefers-reduced-motion` handling.
12. Validate desktop, tablet and mobile breakpoints (delegates to `responsive-design`).
13. Run accessibility checks (delegates to `accessibility`).
14. Run the project's own lint/typecheck/test/build commands when available.
15. Do not report the task as finished until the Definition of Done checklist below is satisfied or remaining differences are explicitly documented.

## Definition of Done

- [ ] Figma context obtained
- [ ] Reference screenshot obtained
- [ ] Variables/tokens verified
- [ ] Codebase inspected
- [ ] Existing components reused where applicable
- [ ] Real assets used
- [ ] Implementation compiles
- [ ] Typecheck passes
- [ ] Relevant lint/test passes
- [ ] Desktop, tablet and mobile validated
- [ ] No unexpected overflow
- [ ] No critical accessibility errors
- [ ] Motion and reduced-motion behavior validated (when interactive/animated elements are present)
- [ ] Visual diff executed
- [ ] Critical divergences fixed
- [ ] Remaining known differences documented (never hidden)

## Rules

- Never replace provided Figma assets with placeholders.
- Do not introduce a new UI library without a concrete need.
- Prefer the repository's design system over external examples.
- External references are fallbacks, not sources of truth.
- Do not finish before visual validation succeeds or remaining differences are documented.

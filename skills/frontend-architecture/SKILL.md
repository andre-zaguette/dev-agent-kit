---
name: frontend-architecture
description: Plan frontend changes from the existing application structure, data flow, state ownership and rendering model before writing code, then verify against a Definition of Done. Use for any frontend work item that adds or changes screens, routes, behavior-bearing components, data loading or client state.
---

# Frontend Architecture

Detect the repository's stack first (`repository-investigation`, `repo-memory`, or `dev-agent inspect`). Then load only the matching file from `references/`; never assume a stack the repository does not use. Matching a design is `figma-to-code`; interface heuristics are `frontend-design`; this skill is about how the code is structured.

## Workflow

1. Read the closest existing screen or route: entry point, data loading, state, tests.
2. Decide where each piece of data lives (server, URL, shared client state, local component state) and who owns it.
3. Define the component and module boundaries; reuse what exists (`component-selection`).
4. Plan loading, empty, error and permission states before coding.
5. Implement, then run typecheck, lint and tests, exercise the change in a browser, and review the diff with `surgical-diff`.

## Before coding, when applicable

- where data is fetched, and when it is refreshed or invalidated
- what renders on the server and what only on the client
- forms: validation, submission errors, double submit
- client-side authorization is a convenience; the server decides
- accessibility and responsive behavior of the new surface (`accessibility`, `responsive-design`)

## Rules

- Follow the architecture that exists. A new state library, data-fetching layer or routing convention needs a reason the current one cannot cover.
- Keep one owner per piece of state; derive instead of copying.
- Never put secrets or tokens in code that ships to the browser.
- Production is read-only unless explicitly authorized.

## Definition of Done

- [ ] existing structure and conventions followed
- [ ] data and state have one clear owner
- [ ] loading, empty, error and permission states handled
- [ ] input validated and server errors surfaced
- [ ] no secrets exposed to the client
- [ ] accessibility and responsive behavior checked
- [ ] tests added/updated and the change exercised in a browser
- [ ] final diff is task-scoped

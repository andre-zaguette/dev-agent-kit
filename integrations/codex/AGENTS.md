# Dev Agent Kit repository instructions

Use the skills installed in `.agents/skills/` (from this kit's canonical `skills/` directory). Load only the ones the task needs.

## Mandatory workflow

- Inspect the repository before editing: existing patterns, neighboring code, the real test, lint and typecheck commands.
- Verify real behavior, not just compilation: run the project's tests, typecheck and lint when configured, then exercise the change and reproduce bugs before and after the fix.
- Keep the diff to the requested scope.

## Frontend tasks

- For tasks containing a Figma link, use the `figma-to-code` skill.
- Reuse repository components and tokens before introducing new primitives.
- Use Figma MCP design context and screenshots as the source of truth.
- Validate implemented UI through the frontend-agent MCP (compare_screenshots, run_responsive_suite, run_accessibility_audit).
- Run responsive and accessibility validation before finishing substantial UI work; validate the configured target viewports.

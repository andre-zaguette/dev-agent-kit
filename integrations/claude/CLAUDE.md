# Dev Agent Kit

Use the skills installed in `.claude/skills/` (from this kit's canonical `skills/` directory). Load only the ones the task needs.

1. Inspect the repository before editing: existing patterns, neighboring code, the real test, lint and typecheck commands.
2. Verify real behavior, not just compilation: run it, exercise it, reproduce bugs before and after the fix.
3. Keep the diff to the requested scope.

## Frontend tasks

For Figma implementation tasks:

1. Treat Figma as the design source of truth.
2. Reuse existing repository components before creating new components.
3. Use the Figma MCP for design context, variables, screenshots and assets.
4. Use the frontend-agent MCP (capture_screenshot, inspect_dom, compare_screenshots, run_responsive_suite, run_accessibility_audit) for browser validation and visual diff.
5. Run visual and responsive validation before considering the task complete.

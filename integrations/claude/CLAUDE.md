# Frontend Agent Kit

Use the frontend skills available in `.claude/skills/` (installed from this kit's canonical `skills/` directory).

For Figma implementation tasks:

1. Treat Figma as the design source of truth.
2. Reuse existing repository components before creating new components.
3. Use the Figma MCP for design context, variables, screenshots and assets.
4. Use the frontend-agent MCP (capture_screenshot, inspect_dom, compare_screenshots, run_responsive_suite, run_accessibility_audit) for browser validation and visual diff.
5. Run visual and responsive validation before considering the task complete.

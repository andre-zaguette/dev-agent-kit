---
name: visual-validation
description: Screenshot-and-diff loop against the Figma reference, using a composite convergence policy instead of a single similarity threshold. Use after implementing any Figma-sourced UI, before considering the task complete.
---

# Visual Validation

Visual review is a required test, not an optional nice-to-have. A task that compiles and passes unit tests can still be visually wrong.

## Loop

```
implement -> render -> screenshot -> diff -> issues found?
  yes -> fix -> render again
  no  -> finish
```

## Validation profiles

Read `validationProfile` from `.frontend-agent/config.yml` (default: `standard`).

| Profile | geometryTolerancePx | spacingTolerancePx | fontSizeTolerancePx | pixelSimilarityTarget |
|---|---|---|---|---|
| pixel-perfect | 0 | 0 | 0 | informational only |
| standard (default) | 3 | 2 | 1 | 0.95 |
| relaxed | 8 | 6 | 2 | 0.90 |

All profiles require `maxCriticalA11yIssues: 0` and a full responsive pass.

In every profile, pixel similarity alone is never sufficient to approve or reject: font rendering differs across operating systems and browsers, so a passing pixel score can hide a real layout bug, and a low pixel score can be pure rendering noise. Always cross-check with:

- Geometry (position, width, height) against the Figma frame.
- Computed styles (font-size, color, spacing) against Figma's variable/token values.

Line-height, border-radius and shadows are not measured by any tool in this kit (`inspect_dom` only reports `fontSize` and `color`) — check those with a manual visual review against the Figma reference.

## Tools (frontend-agent MCP, v0.3+)

When the frontend-agent MCP server is registered, use it instead of eyeballing:

- `compare_screenshots` — pass the Figma frame export (1×) as `baselinePath`, your `capture_screenshot` output as `actualPath`, and `url` + `elements` with the exact Figma values (x, y, width, height, padding*, gap, rowGap, columnGap, fontSize, color). Capture the actual with `capture_screenshot` using `fullPage: false` at the Figma frame's size, so `baselinePath` and `actualPath` match dimensions. Only a `pass` verdict counts; `incomplete` means you skipped the geometry check.
- `run_responsive_suite` — covers the desktop/tablet/mobile items of the Definition of Done and flags unexpected horizontal overflow.
- `run_accessibility_audit` — covers "accessibility sem erro crítico"; fix every critical violation it reports.

The tools read `validationProfile`, tolerances and breakpoints from `.frontend-agent/config.yml`, so the verdicts already follow the table above.

## Fix priority order

1. Layout macro-structure
2. Geometry
3. Spacing
4. Typography
5. Colors
6. Borders/shadows
7. Microdetails

## Rules

- Never approve a task based on pixel similarity percentage alone.
- Document every remaining known difference in the task's summary instead of silently ignoring it.
- Re-render and re-diff after every fix, don't assume a fix worked without re-checking.

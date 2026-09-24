# Evals

- `scenarios/*.json` — one scenario per file (schema: `packages/evals/src/schema.ts`). `expected` must all hold, `forbidden` must never hold. Tool names: `<server>/<tool>`, `skill/<name>`, `reference/<name>`, `builtin/<name>`.
- `fixtures/<name>/` — the project copied into a temp workspace for each run. No symlinks.
- `figma/<name>.json` — what the Figma mock (`packages/evals/src/figma-mock`) returns; `figma/src/*.html` are the reference designs rendered into `figma/assets/*.png` by `npm run render-figma-assets --workspace=packages/evals`.
- `results/` — bench output (gitignored).

Validate for free: `npm run evals:validate`. Run for real (costs tokens): `npm run bench -- --host claude --scenario base-simple-screen`.
- Scenarios may omit `figma` (backend scenarios do), and `category` may be `backend`; such scenarios start only the `frontend-agent` MCP server.

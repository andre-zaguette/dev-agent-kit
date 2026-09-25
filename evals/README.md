# Evals

- `scenarios/*.json` — one scenario per file (schema: `packages/evals/src/schema.ts`). `expected` must all hold, `forbidden` must never hold. Tool names: `<server>/<tool>`, `skill/<name>`, `reference/<name>`, `builtin/<name>`.
- `fixtures/<name>/` — the project copied into a temp workspace for each run. No symlinks.
- `figma/<name>.json` — what the Figma mock (`packages/evals/src/figma-mock`) returns; `figma/src/*.html` are the reference designs rendered into `figma/assets/*.png` by `npm run render-figma-assets --workspace=packages/evals`.
- `results/` — bench output (gitignored).

Validate for free: `npm run evals:validate`. Run for real (costs tokens): `npm run bench -- --host claude --scenario base-simple-screen`.
- Scenarios may omit `figma` (backend scenarios do), and `category` may be `backend`; such scenarios start only the `frontend-agent` MCP server.
- `category` may also be `fullstack`; those scenarios need no Figma either and expect a persisted `.dev-agent/tasks/<KEY>.contract.json`.
- Backend stack scenarios are named `backend-stack-<name>` (category `backend`) and each has its own fixture (`flask-app`, `express-app`, `laravel-app`, `aspnet-app`, `spring-app`, `rails-app`).

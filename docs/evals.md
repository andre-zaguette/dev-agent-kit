# Evals and benchmark

## Validate the kit's own skills

```bash
node scripts/validate-skill.mjs skills
```

Checks every `SKILL.md` has valid frontmatter (`name`, `description`) and a non-trivial body, and every `references/*.md` has the required frontmatter (`name`, `description`, `status`) and sections (`Princípio`, `Quando aplicar`, `Quando não aplicar`, `Exemplo`, `Fonte`).

## Running the benchmark

The kit ships 36 eval scenarios (`evals/scenarios`). The original 18 frontend scenarios are: 7 base (simple screen, existing components, mobile, motion, large Figma file, Figma asset, deliberate visual divergence), 8 stack (React, Next.js, Vue, Nuxt, Angular, Tailwind, PHP, HTML/CSS/JS) and 3 validation profiles (pixel-perfect, standard, relaxed); the other 18 cover the backend domain, fullstack contracts and backend stacks and are validated offline. Each has deterministic `expected`/`forbidden` assertions on the tools the agent called, its final answer and the files it left behind. The Figma MCP is replaced by a mock (`packages/evals/src/figma-mock`) that serves recorded design data under the same server/tool names.

```bash
npm test                      # all packages, offline, free
npm run evals:validate        # validate the scenario catalog, free
npm run bench -- --list
npm run bench -- --host claude --scenario base-simple-screen        # costs tokens
npm run bench -- --host all --category stack --model-claude opus    # Claude vs Codex
```

Each run copies the fixture into `$TMPDIR/fak-bench-*`, installs the kit into it, serves it on `127.0.0.1:<random port>` and starts the host headless with only the kit MCP and the Figma mock:

- Claude Code: `claude -p … --strict-mcp-config --setting-sources project --permission-mode acceptEdits --allowedTools "Read(<ws>/**),Edit(<ws>/**),Write(<ws>/**),Glob(<ws>/**),Grep(<ws>/**),Skill,ToolSearch,mcp__frontend-agent,mcp__figma"` (no Bash; file tools are scoped to the workspace — a bare `Edit`/`Write` would let the agent write anywhere the invoking user can).
- Codex: `codex exec --json --ignore-user-config --sandbox workspace-write --ephemeral`, MCP servers passed with `-c` (no project trust needed) and their tools auto-approved.

Results land in `evals/results/<timestamp>/` (`report.md`, `summary.json`, transcripts). A timeout, a crash, a missing/unauthenticated host or a truncated transcript is `error`, never `pass`. `--keep` keeps the workspaces for inspection.

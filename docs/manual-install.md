# Manual installation

Use this only when you cannot run `dev-agent install`. `/path/to/dev-agent-kit` is your checkout, or `$(npm root -g)/dev-agent-kit` for a global install. The CLI does the same thing and keeps the result verifiable.

From your target project's root:

```bash
mkdir -p .claude/skills .agents/skills
cp -r /path/to/dev-agent-kit/skills/* .claude/skills/
cp -r /path/to/dev-agent-kit/skills/* .agents/skills/
cp /path/to/dev-agent-kit/integrations/claude/CLAUDE.md ./CLAUDE.md
cp /path/to/dev-agent-kit/integrations/codex/AGENTS.md ./AGENTS.md
```

If `CLAUDE.md`/`AGENTS.md` already exist in the target project, merge the kit's workflow instructions manually instead of overwriting.

## Cursor

Cursor reads the same `.agents/skills/` and `AGENTS.md` as Codex. From your target project's root, if you have not already done this for Codex:

```bash
mkdir -p .agents/skills
cp -r /path/to/dev-agent-kit/skills/* .agents/skills/
cp /path/to/dev-agent-kit/integrations/codex/AGENTS.md ./AGENTS.md
```

Then create `.cursor/mcp.json` with a `frontend-agent` stdio entry (`command` is the kit's `tsx`, `args` its MCP server entry point, `FRONTEND_AGENT_PROJECT_ROOT` the absolute path of the target project):

```json
{
  "mcpServers": {
    "frontend-agent": {
      "type": "stdio",
      "command": "/path/to/dev-agent-kit/node_modules/.bin/tsx",
      "args": ["/path/to/dev-agent-kit/packages/mcp-server/src/index.ts"],
      "env": { "FRONTEND_AGENT_PROJECT_ROOT": "/absolute/path/to/target-project" }
    }
  }
}
```

If `.cursor/mcp.json` already exists, add the entry to its `mcpServers` instead of overwriting. The file holds absolute paths; keep it out of version control in shared repositories. This follows Cursor's documented MCP schema but was not exercised in a real Cursor.

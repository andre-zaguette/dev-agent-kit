# Manual installation

Use this only when you cannot run `dev-agent install`. The CLI does the same thing and keeps the result verifiable.

From your target project's root:

```bash
mkdir -p .claude/skills .agents/skills
cp -r /path/to/dev-agent-kit/skills/* .claude/skills/
cp -r /path/to/dev-agent-kit/skills/* .agents/skills/
cp /path/to/dev-agent-kit/integrations/claude/CLAUDE.md ./CLAUDE.md
cp /path/to/dev-agent-kit/integrations/codex/AGENTS.md ./AGENTS.md
```

If `CLAUDE.md`/`AGENTS.md` already exist in the target project, merge the kit's workflow instructions manually instead of overwriting.

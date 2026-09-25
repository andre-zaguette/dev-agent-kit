#!/usr/bin/env node
// Compatibility alias (also installed as `frontend-agent-kit`): the original CLI keeps its commands and exit codes.
await import(new URL('../packages/cli/bin/frontend-agent.mjs', import.meta.url).href);

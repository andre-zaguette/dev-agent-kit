#!/usr/bin/env node
// Installed entry point: delegates to the workspace CLI so every bin name shares one implementation.
await import(new URL('../packages/cli/bin/dev-agent.mjs', import.meta.url).href);

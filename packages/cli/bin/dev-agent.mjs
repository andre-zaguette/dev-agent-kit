#!/usr/bin/env node
// Runs the TypeScript dev-agent CLI through tsx, resolved relative to this file (works from any cwd).
import { register } from 'tsx/esm/api';

register();
await import('../src/dev-index.ts');

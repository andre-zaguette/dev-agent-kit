import { existsSync } from 'node:fs';
import path from 'node:path';
import { which } from '../util.js';
import type { CheckResult } from '../types.js';
import type { Integration } from './types.js';

const INSTALL = 'uv tool install graphifyy';

export const graphify: Integration = {
  id: 'graphify',
  hosts: ['claude', 'codex'],
  defaultOn: false,
  async detect(ctx) {
    const binPath = which('graphify', ctx.env);
    return binPath ? { state: 'present', binPath, detail: binPath } : { state: 'absent' };
  },
  plan: () => [],
  verify(_host, ctx, detection) {
    const name = 'integration:graphify';
    const checks: CheckResult[] = [];
    if (detection.state === 'present') checks.push({ name, ok: true, detail: `graphify found at ${detection.binPath}` });
    else checks.push({ name, ok: true, warn: true, detail: `graphify not found on PATH; install with: ${INSTALL} (PyPI package graphifyy, command graphify, Python 3.10+)` });
    if (existsSync(path.join(ctx.projectRoot, 'graphify-out', 'GRAPH_REPORT.md'))) {
      checks.push({ name: `${name}:graph`, ok: true, detail: 'graphify-out/GRAPH_REPORT.md present (graph generated)' });
    }
    return checks;
  },
  notes(_host, detection) {
    if (detection.state === 'present') return [];
    return [
      `graphify: not found on PATH — install with: ${INSTALL} (the kit does not install it).`,
      'graphify: the kit never runs `graphify install`. That command registers a global /graphify skill, edits CLAUDE.md and adds PreToolUse hooks that steer Claude toward the graph before grep; read what it changes before you run it yourself.'
    ];
  }
};

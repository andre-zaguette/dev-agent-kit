import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Integration } from './types.js';

const MARKETPLACE = '/plugin marketplace add kingbootoshi/cartographer';
const INSTALL = '/plugin install cartographer';

export const cartographer: Integration = {
  id: 'cartographer',
  hosts: ['claude'],
  defaultOn: false,
  async detect(ctx) {
    for (const dir of [path.join(ctx.projectRoot, '.claude', 'skills', 'cartographer'), path.join(ctx.homeDir, '.claude', 'skills', 'cartographer')]) {
      try {
        if (existsSync(dir)) return { state: 'present', detail: dir };
      } catch {
        // unreadable location: fall through to unknown
      }
    }
    return { state: 'unknown', reason: 'plugin-managed installs have no documented location, so the plugin cannot be confirmed from here' };
  },
  plan: () => [],
  verify(_host, ctx, detection) {
    const name = 'integration:cartographer';
    const checks = [];
    if (detection.state === 'present') checks.push({ name, ok: true, detail: `skill found at ${detection.detail}` });
    if (existsSync(path.join(ctx.projectRoot, 'docs', 'CODEBASE_MAP.md'))) {
      checks.push({ name: `${name}:map`, ok: true, detail: 'docs/CODEBASE_MAP.md present (map generated)' });
    }
    if (existsSync(path.join(ctx.projectRoot, '.cartographer', 'manifest.json'))) {
      checks.push({ name: `${name}:index`, ok: true, detail: '.cartographer/manifest.json present (v2 index generated)' });
    }
    if (checks.length === 0) {
      checks.push({ name, ok: true, warn: true, detail: `plugin not found; install with: ${MARKETPLACE} then ${INSTALL}` });
    }
    return checks;
  },
  notes(_host, detection) {
    return detection.state === 'present' ? [] : [`cartographer: not detected — in Claude Code run ${MARKETPLACE} then ${INSTALL} (the kit does not install it). The plugin edits CLAUDE.md itself; the kit's own block is left untouched.`];
  }
};

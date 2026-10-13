import { existsSync } from 'node:fs';
import { which } from '../util.js';
import type { Integration } from './types.js';

export const HEADROOM_INSTALL = 'uv tool install "headroom-ai[all]"';
const ARGS = ['mcp', 'serve'];

export const headroom: Integration = {
  id: 'headroom',
  hosts: ['claude', 'codex'],
  defaultOn: false,
  async detect(ctx) {
    const binPath = which('headroom', ctx.env);
    return binPath ? { state: 'present', binPath, detail: binPath } : { state: 'absent' };
  },
  assertInstallable(detection) {
    if (detection.state !== 'present') {
      throw new Error(`frontend-agent: --with headroom needs the headroom binary on PATH; install it first with: ${HEADROOM_INSTALL}`);
    }
  },
  plan(host, detection) {
    if (detection.state !== 'present' || !detection.binPath) return [];
    const entry = host === 'claude' ? { type: 'stdio', command: detection.binPath, args: [...ARGS] } : { command: detection.binPath, args: [...ARGS] };
    return [{ name: 'headroom', entry }];
  },
  verify(_host, _ctx, _detection, configured) {
    const name = 'integration:headroom';
    if (configured === null) return [];
    const entry = configured.headroom;
    if (entry === undefined) {
      return [{ name, ok: false, detail: 'enabled for this project but there is no headroom MCP entry — run: dev-agent install --with headroom' }];
    }
    const e = entry as Record<string, unknown>;
    if (typeof entry !== 'object' || entry === null || typeof e.command !== 'string' || !Array.isArray(e.args)) {
      return [{ name, ok: false, detail: 'the headroom MCP entry is malformed (it needs a command and args)' }];
    }
    if (!existsSync(e.command)) {
      return [{ name, ok: true, warn: true, detail: `entry present but ${e.command} no longer exists — reinstall with: ${HEADROOM_INSTALL}, then re-run install --with headroom` }];
    }
    return [{ name, ok: true, detail: `entry present, binary ${e.command}` }];
  },
  notes(_host, detection) {
    return detection.state === 'present' && detection.binPath
      ? [`headroom: the MCP entry points at ${detection.binPath}; re-run install --with headroom if the binary moves.`]
      : [];
  }
};

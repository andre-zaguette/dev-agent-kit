import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Detection, Integration } from './types.js';

const INSTALL = 'npx claude-mem install';

export const claudeMem: Integration = {
  id: 'claude-mem',
  hosts: ['claude'],
  defaultOn: false,
  async detect(ctx): Promise<Detection> {
    try {
      const portFile = path.join(ctx.homeDir, '.claude-mem', '.worker.port');
      const launcher = path.join(ctx.homeDir, '.local', 'bin', 'claude-mem');
      if (!existsSync(portFile)) {
        return existsSync(launcher) ? { state: 'unknown', reason: 'launcher found but no worker port recorded (the worker is not running)' } : { state: 'absent' };
      }
      const port = Number(readFileSync(portFile, 'utf8').trim());
      if (!Number.isInteger(port) || port < 1 || port > 65535) return { state: 'unknown', reason: `no valid port in ${portFile}` };
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
        return response.ok
          ? { state: 'present', detail: `worker healthy on 127.0.0.1:${port}` }
          : { state: 'unknown', reason: `the worker on 127.0.0.1:${port} answered HTTP ${response.status}` };
      } catch {
        return { state: 'unknown', reason: `the worker on 127.0.0.1:${port} did not answer within 1 s` };
      }
    } catch (error) {
      return { state: 'unknown', reason: (error as Error).message };
    }
  },
  plan: () => [],
  verify(_host, _ctx, detection) {
    const name = 'integration:claude-mem';
    if (detection.state === 'present') return [{ name, ok: true, detail: detection.detail ?? 'worker healthy' }];
    const why = detection.state === 'unknown' ? `${detection.reason}; ` : 'not installed; ';
    return [{ name, ok: true, warn: true, detail: `${why}install with: ${INSTALL} (or /plugin install claude-mem)` }];
  },
  notes(_host, detection) {
    return detection.state === 'present' ? [] : [`claude-mem: not running on this machine — install it with: ${INSTALL} (the kit does not install it).`];
  }
};

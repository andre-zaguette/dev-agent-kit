import { existsSync } from 'node:fs';
import path from 'node:path';
import type { McpConfig } from './types.js';

export const SERVER_NAME = 'frontend-agent';
export const FIGMA_MCP_URL = 'https://mcp.figma.com/mcp';

export interface ServerLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** The tsx binary: the kit's own node_modules first, then the hoisted ones in each ancestor (an installed copy sits inside another node_modules). */
export function resolveTsx(kitRoot: string): string {
  for (let dir = path.resolve(kitRoot); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', '.bin', 'tsx');
    if (existsSync(candidate)) return candidate;
    if (path.dirname(dir) === dir) throw new Error(`frontend-agent: could not find tsx above "${kitRoot}"; reinstall the kit's dependencies.`);
  }
}

/** How a host should start the kit's MCP server for `config.projectRoot` (absolute paths into the kit checkout). */
export function kitServerLaunch(config: McpConfig): ServerLaunch {
  return {
    command: resolveTsx(config.kitRoot),
    args: [path.join(config.kitRoot, 'packages', 'mcp-server', 'src', 'index.ts')],
    env: { FRONTEND_AGENT_PROJECT_ROOT: config.projectRoot }
  };
}

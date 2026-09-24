import path from 'node:path';
import type { McpConfig } from './types.js';

export const SERVER_NAME = 'frontend-agent';
export const FIGMA_MCP_URL = 'https://mcp.figma.com/mcp';

export interface ServerLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** How a host should start the kit's MCP server for `config.projectRoot` (absolute paths into the kit checkout). */
export function kitServerLaunch(config: McpConfig): ServerLaunch {
  return {
    command: path.join(config.kitRoot, 'node_modules', '.bin', 'tsx'),
    args: [path.join(config.kitRoot, 'packages', 'mcp-server', 'src', 'index.ts')],
    env: { FRONTEND_AGENT_PROJECT_ROOT: config.projectRoot }
  };
}

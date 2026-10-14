import { FIGMA_MCP_URL } from '../mcp-launch.js';
import type { Integration } from './types.js';

export const figma: Integration = {
  id: 'figma',
  hosts: ['claude', 'codex', 'cursor'],
  defaultOn: true,
  async detect() {
    return { state: 'present', detail: 'remote HTTP server' };
  },
  plan(host) {
    if (host === 'codex') return [{ name: 'figma', entry: { url: FIGMA_MCP_URL }, hint: 'authenticate with: codex mcp login figma' }];
    if (host === 'cursor') return [{ name: 'figma', entry: { url: FIGMA_MCP_URL } }];
    return [{ name: 'figma', entry: { type: 'http', url: FIGMA_MCP_URL } }];
  },
  verify: () => [],
  notes: () => []
};

import { FIGMA_MCP_URL } from '../mcp-launch.js';
import type { Integration } from './types.js';

export const figma: Integration = {
  id: 'figma',
  hosts: ['claude', 'codex'],
  defaultOn: true,
  async detect() {
    return { state: 'present', detail: 'remote HTTP server' };
  },
  plan(host) {
    return host === 'codex'
      ? [{ name: 'figma', entry: { url: FIGMA_MCP_URL }, hint: 'authenticate with: codex mcp login figma' }]
      : [{ name: 'figma', entry: { type: 'http', url: FIGMA_MCP_URL } }];
  },
  verify: () => [],
  notes: () => []
};

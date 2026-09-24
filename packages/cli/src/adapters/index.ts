import type { HostAdapter } from './host-adapter.js';
import type { AdapterContext, HostName } from '../types.js';
import { ClaudeCodeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { StubAdapter } from './stub.js';

export type { HostAdapter } from './host-adapter.js';

export const REAL_HOSTS: HostName[] = ['claude', 'codex'];
export const ALL_HOSTS: HostName[] = ['claude', 'codex', 'cursor', 'vscode'];

export function createAdapter(name: HostName, ctx: AdapterContext): HostAdapter {
  if (name === 'claude') return new ClaudeCodeAdapter(ctx);
  if (name === 'codex') return new CodexAdapter(ctx);
  return new StubAdapter(name);
}

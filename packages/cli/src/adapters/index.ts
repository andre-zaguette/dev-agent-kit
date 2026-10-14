import type { HostAdapter } from './host-adapter.js';
import type { AdapterContext, HostName } from '../types.js';
import { ClaudeCodeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { CursorAdapter } from './cursor.js';
import { StubAdapter } from './stub.js';

export type { HostAdapter } from './host-adapter.js';

/** Every supported host: the ones install/verify look for when none is named. */
export const REAL_HOSTS: HostName[] = ['claude', 'codex', 'cursor'];
/** What `--all` selects. Unchanged since before Cursor became a real host, so existing `--all` users see no new files. */
export const ALL_FLAG_HOSTS: HostName[] = ['claude', 'codex'];
export const ALL_HOSTS: HostName[] = ['claude', 'codex', 'cursor', 'vscode'];

export function createAdapter(name: HostName, ctx: AdapterContext): HostAdapter {
  if (name === 'claude') return new ClaudeCodeAdapter(ctx);
  if (name === 'codex') return new CodexAdapter(ctx);
  if (name === 'cursor') return new CursorAdapter(ctx);
  return new StubAdapter(name);
}

import type { HostName, McpConfig, VerificationResult } from '../types.js';
import type { SyncReport } from '../sync-skills.js';
import type { BlockAction } from '../managed-block.js';

export interface HostAdapter {
  readonly name: HostName;
  readonly supported: boolean;
  /** Validate everything this host will touch (including a dry run of the config merge), without writing anything. Fail closed. */
  preflight(config: McpConfig): Promise<void>;
  detect(): Promise<boolean>;
  installSkills(sourceDir: string): Promise<SyncReport>;
  installInstructions(): Promise<BlockAction>;
  installMcp(config: McpConfig): Promise<string[]>;
  verify(): Promise<VerificationResult>;
  /** The MCP servers in this project's host config: {} when the file is absent, null when it cannot be parsed. */
  configuredServers(): Record<string, unknown> | null;
  /** Host-specific follow-up the user must know about after install (printed by the CLI). */
  notes(): string[];
}

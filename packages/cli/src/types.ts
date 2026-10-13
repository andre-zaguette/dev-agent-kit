import type { McpServerChange } from './integrations/types.js';

export type HostName = 'claude' | 'codex' | 'cursor' | 'vscode';

export interface McpConfig {
  kitRoot: string;
  projectRoot: string;
  /** Extra MCP servers (beyond the kit's own) resolved for the host this config is passed to. */
  extraServers: McpServerChange[];
}

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface VerificationResult {
  host: HostName;
  ok: boolean;
  checks: CheckResult[];
}

export interface AdapterContext {
  projectRoot: string;
  kitRoot: string;
  kitVersion: string;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  force: boolean;
}

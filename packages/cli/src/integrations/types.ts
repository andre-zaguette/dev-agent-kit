import type { AdapterContext, CheckResult, HostName } from '../types.js';

export type IntegrationId = 'figma' | 'headroom' | 'claude-mem' | 'cartographer' | 'graphify';

export type Detection =
  | { state: 'present'; detail?: string; binPath?: string }
  | { state: 'absent' }
  | { state: 'unknown'; reason: string };

/** One MCP server entry an integration wants in a host's project config. */
export interface McpServerChange {
  name: string;
  entry: Record<string, unknown>;
  /** Appended to the "registered" message, e.g. an authentication hint. */
  hint?: string;
}

export interface Integration {
  readonly id: IntegrationId;
  readonly hosts: readonly HostName[];
  readonly defaultOn: boolean;
  /** Best-effort, read-only, never throws. */
  detect(ctx: AdapterContext): Promise<Detection>;
  /** Pure: the MCP entries to write for this host. Empty for verify-only integrations. */
  plan(host: HostName, detection: Detection): McpServerChange[];
  /** `configured` is the host's MCP servers as written in the project config, or null when that file is unreadable. */
  verify(host: HostName, ctx: AdapterContext, detection: Detection, configured: Record<string, unknown> | null): CheckResult[];
  /** Install hints for what is missing on the machine. */
  notes(host: HostName, detection: Detection): string[];
  /** Throws a usage error before anything is written (called only for integrations named with --with). */
  assertInstallable?(detection: Detection): void;
}

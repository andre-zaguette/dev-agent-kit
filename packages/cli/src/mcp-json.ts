import { existsSync, readFileSync } from 'node:fs';
import { SERVER_NAME, type ServerLaunch } from './mcp-launch.js';
import type { McpServerChange } from './integrations/types.js';

/** A JSON file with a top-level `mcpServers` object: Claude's `.mcp.json` and Cursor's `.cursor/mcp.json`. */
export type McpJson = { mcpServers?: Record<string, Record<string, unknown>> } & Record<string, unknown>;

export function readMcpJsonFile(file: string): McpJson {
  if (!existsSync(file)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`frontend-agent: cannot parse ${file}: ${(error as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`frontend-agent: ${file} must contain a JSON object`);
  }
  const json = parsed as McpJson;
  if (json.mcpServers !== undefined && (typeof json.mcpServers !== 'object' || json.mcpServers === null || Array.isArray(json.mcpServers))) {
    throw new Error(`frontend-agent: "mcpServers" in ${file} must be an object`);
  }
  return json;
}

/** Add each extra server unless one with that name exists (kept). Mutates `servers`; returns the action lines. */
export function applyExtraServers(
  servers: Record<string, Record<string, unknown>>,
  extras: readonly McpServerChange[],
  file: string
): string[] {
  const actions: string[] = [];
  for (const extra of extras) {
    if (servers[extra.name]) {
      actions.push(`${extra.name} MCP server already configured in ${file} — kept`);
    } else {
      servers[extra.name] = extra.entry;
      actions.push(`${extra.name} MCP server registered in ${file}${extra.hint ? ` (${extra.hint})` : ''}`);
    }
  }
  return actions;
}

/** The servers in `file`: {} when it is absent, null when it cannot be parsed. */
export function readConfiguredServers(file: string): Record<string, unknown> | null {
  try {
    return { ...(readMcpJsonFile(file).mcpServers ?? {}) };
  } catch {
    return null;
  }
}

/** How `file` starts the kit's own MCP server, for `verify`. */
export function readConfiguredLaunch(file: string): { launch: ServerLaunch | null; error?: string } {
  let json: McpJson;
  try {
    json = readMcpJsonFile(file);
  } catch (error) {
    return { launch: null, error: (error as Error).message };
  }
  const entry = json.mcpServers?.[SERVER_NAME];
  if (!entry || typeof entry.command !== 'string') return { launch: null };
  return {
    launch: {
      command: entry.command,
      args: Array.isArray(entry.args) ? entry.args.map(String) : [],
      env: (entry.env as Record<string, string> | undefined) ?? {}
    }
  };
}

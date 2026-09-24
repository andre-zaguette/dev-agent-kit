import path from 'node:path';

/**
 * Resolve the project root the MCP server should treat as its workspace.
 *
 * Uses FRONTEND_AGENT_PROJECT_ROOT (resolved to an absolute path) when set,
 * otherwise falls back to the process's current working directory.
 */
export function getProjectRoot(): string {
  const envRoot = process.env.FRONTEND_AGENT_PROJECT_ROOT;
  if (envRoot) return path.resolve(envRoot);
  return process.cwd();
}

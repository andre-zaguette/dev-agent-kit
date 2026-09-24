import { writeFileSync } from 'node:fs';

export interface McpServerSpec {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface HostBinary {
  command: string;
  /** Prepended to the host arguments (lets tests run a Node script as a fake host). */
  prefixArgs: string[];
}

export interface HostRunSpec {
  command: string;
  args: string[];
  cwd: string;
}

/**
 * Claude built-in tools the benchmark allows. No Bash: the kit's MCP covers validation.
 * File tools are scoped to the workspace when the run is built (a bare name like "Edit" or
 * "Write" grants every path the invoking user can reach, not just the sandboxed workspace —
 * confirmed against a real `claude -p` run during the v0.5 final review).
 */
export const CLAUDE_FILE_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep'];
export const CLAUDE_UNSCOPED_TOOLS = ['Skill', 'ToolSearch'];
const BARE_KEY = /^[A-Za-z0-9_-]+$/;

export function buildClaudeRun(opts: {
  workspace: string;
  prompt: string;
  servers: McpServerSpec[];
  mcpConfigPath: string;
  binary: HostBinary;
  model?: string;
}): HostRunSpec {
  const mcpServers = Object.fromEntries(
    opts.servers.map((s) => [s.name, { type: 'stdio', command: s.command, args: s.args, env: s.env }])
  );
  writeFileSync(opts.mcpConfigPath, `${JSON.stringify({ mcpServers }, null, 2)}\n`);
  const allowed = [
    ...CLAUDE_FILE_TOOLS.map((tool) => `${tool}(${opts.workspace}/**)`),
    ...CLAUDE_UNSCOPED_TOOLS,
    ...opts.servers.map((s) => `mcp__${s.name}`)
  ];
  return {
    command: opts.binary.command,
    cwd: opts.workspace,
    args: [
      ...opts.binary.prefixArgs,
      '-p',
      opts.prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--mcp-config',
      opts.mcpConfigPath,
      '--strict-mcp-config',
      '--setting-sources',
      'project',
      '--permission-mode',
      'acceptEdits',
      ...(opts.model ? ['--model', opts.model] : []),
      '--allowedTools',
      allowed.join(',')
    ]
  };
}

export function tomlValue(value: string | string[] | Record<string, string>): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => JSON.stringify(v)).join(',')}]`;
  return `{${Object.entries(value)
    .map(([key, v]) => {
      if (!BARE_KEY.test(key)) throw new Error(`"${key}" is not a bare TOML key`);
      return `${key}=${JSON.stringify(v)}`;
    })
    .join(',')}}`;
}

export function buildCodexRun(opts: {
  workspace: string;
  prompt: string;
  servers: McpServerSpec[];
  binary: HostBinary;
  model?: string;
}): HostRunSpec {
  const config: string[] = [];
  for (const s of opts.servers) {
    if (!BARE_KEY.test(s.name)) throw new Error(`"${s.name}" is not a bare TOML key`);
    const key = `mcp_servers.${s.name}`;
    config.push('-c', `${key}.command=${tomlValue(s.command)}`);
    config.push('-c', `${key}.args=${tomlValue(s.args)}`);
    config.push('-c', `${key}.env=${tomlValue(s.env)}`);
    config.push('-c', `${key}.default_tools_approval_mode="approve"`);
  }
  return {
    command: opts.binary.command,
    cwd: opts.workspace,
    args: [
      ...opts.binary.prefixArgs,
      'exec',
      '--json',
      '--ignore-user-config',
      '--sandbox',
      'workspace-write',
      '--skip-git-repo-check',
      '--ephemeral',
      '-C',
      opts.workspace,
      ...config,
      ...(opts.model ? ['-m', opts.model] : []),
      opts.prompt
    ]
  };
}

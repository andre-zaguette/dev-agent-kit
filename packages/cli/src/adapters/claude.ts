import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HostAdapter } from './host-adapter.js';
import type { AdapterContext, McpConfig, VerificationResult } from '../types.js';
import { which, assertRealDirInsideRoot } from '../util.js';
import { syncSkills, readManifest, type SyncReport } from '../sync-skills.js';
import { upsertMarkdownBlock, assertInsideRoot, preflightMarkdownFile, type BlockAction } from '../managed-block.js';
import { instructionsContent } from '../instructions.js';
import { FIGMA_MCP_URL, SERVER_NAME, kitServerLaunch, type ServerLaunch } from '../mcp-launch.js';
import { checkInstructions, checkLaunchConfig, checkSkills, probeServer } from '../checks.js';

type McpJson = { mcpServers?: Record<string, Record<string, unknown>> } & Record<string, unknown>;

export class ClaudeCodeAdapter implements HostAdapter {
  readonly name = 'claude' as const;
  readonly supported = true;

  constructor(private readonly ctx: AdapterContext) {}

  get skillsDir(): string {
    return path.join(this.ctx.projectRoot, '.claude', 'skills');
  }

  get instructionsFile(): string {
    return path.join(this.ctx.projectRoot, 'CLAUDE.md');
  }

  get mcpFile(): string {
    return path.join(this.ctx.projectRoot, '.mcp.json');
  }

  async detect(): Promise<boolean> {
    return which('claude', this.ctx.env) !== null || existsSync(path.join(this.ctx.homeDir, '.claude'));
  }

  async preflight(_config: McpConfig): Promise<void> {
    assertRealDirInsideRoot(this.skillsDir, this.ctx.projectRoot);
    readManifest(this.skillsDir);
    preflightMarkdownFile(this.instructionsFile, this.ctx.projectRoot);
    assertInsideRoot(this.mcpFile, this.ctx.projectRoot);
    this.readMcpJson();
  }

  async installSkills(sourceDir: string): Promise<SyncReport> {
    assertRealDirInsideRoot(this.skillsDir, this.ctx.projectRoot);
    return syncSkills(sourceDir, this.skillsDir, { kitVersion: this.ctx.kitVersion, force: this.ctx.force });
  }

  async installInstructions(): Promise<BlockAction> {
    const content = instructionsContent(this.ctx, 'claude');
    return upsertMarkdownBlock(this.instructionsFile, content, this.ctx.projectRoot);
  }

  private readMcpJson(): McpJson {
    if (!existsSync(this.mcpFile)) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.mcpFile, 'utf8'));
    } catch (error) {
      throw new Error(`frontend-agent: cannot parse ${this.mcpFile}: ${(error as Error).message}`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`frontend-agent: ${this.mcpFile} must contain a JSON object`);
    }
    const json = parsed as McpJson;
    if (json.mcpServers !== undefined && (typeof json.mcpServers !== 'object' || json.mcpServers === null || Array.isArray(json.mcpServers))) {
      throw new Error(`frontend-agent: "mcpServers" in ${this.mcpFile} must be an object`);
    }
    return json;
  }

  async installMcp(config: McpConfig): Promise<string[]> {
    assertInsideRoot(this.mcpFile, this.ctx.projectRoot);
    const json = this.readMcpJson();
    const servers = { ...(json.mcpServers ?? {}) };
    const launch = kitServerLaunch(config);
    const actions: string[] = [];

    servers[SERVER_NAME] = { type: 'stdio', command: launch.command, args: launch.args, env: launch.env };
    actions.push(`${SERVER_NAME} MCP server registered in ${this.mcpFile}`);

    if (config.includeFigma) {
      if (servers.figma) {
        actions.push(`figma MCP server already configured in ${this.mcpFile} — kept`);
      } else {
        servers.figma = { type: 'http', url: FIGMA_MCP_URL };
        actions.push(`figma MCP server registered in ${this.mcpFile}`);
      }
    }

    writeFileSync(this.mcpFile, `${JSON.stringify({ ...json, mcpServers: servers }, null, 2)}\n`);
    return actions;
  }

  private configuredLaunch(): { launch: ServerLaunch | null; error?: string } {
    let json: McpJson;
    try {
      json = this.readMcpJson();
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

  async verify(): Promise<VerificationResult> {
    const { launch, error } = this.configuredLaunch();
    const configCheck = error
      ? { name: 'mcp-config', ok: false, detail: error }
      : checkLaunchConfig(launch, this.ctx.projectRoot, this.mcpFile);
    const checks = [
      checkSkills(this.skillsDir, path.join(this.ctx.kitRoot, 'skills')),
      checkInstructions(this.instructionsFile),
      configCheck,
      configCheck.ok && launch
        ? await probeServer(launch)
        : { name: 'mcp-server', ok: false, detail: 'skipped: mcp-config check failed' }
    ];
    return { host: this.name, ok: checks.every((check) => check.ok), checks };
  }

  notes(): string[] {
    return [
      'Claude Code asks you to approve project MCP servers from .mcp.json the first time it starts in this project.',
      '.mcp.json holds absolute paths to this kit checkout — keep it out of version control if the repo is shared.',
      'Authenticate the Figma MCP from Claude Code with /mcp when prompted.'
    ];
  }
}

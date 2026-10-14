import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HostAdapter } from './host-adapter.js';
import type { AdapterContext, McpConfig, VerificationResult } from '../types.js';
import { which, assertRealDirInsideRoot } from '../util.js';
import { syncSkills, readManifest, type SyncReport } from '../sync-skills.js';
import { upsertMarkdownBlock, assertInsideRoot, preflightMarkdownFile, type BlockAction } from '../managed-block.js';
import { instructionsContent } from '../instructions.js';
import { SERVER_NAME, kitServerLaunch } from '../mcp-launch.js';
import { applyExtraServers, readConfiguredLaunch, readConfiguredServers, readMcpJsonFile } from '../mcp-json.js';
import { checkInstructions, checkLaunchConfig, checkSkills, probeServer } from '../checks.js';

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
    readMcpJsonFile(this.mcpFile);
  }

  async installSkills(sourceDir: string): Promise<SyncReport> {
    assertRealDirInsideRoot(this.skillsDir, this.ctx.projectRoot);
    return syncSkills(sourceDir, this.skillsDir, { kitVersion: this.ctx.kitVersion, force: this.ctx.force });
  }

  async installInstructions(): Promise<BlockAction> {
    const content = instructionsContent(this.ctx, 'claude');
    return upsertMarkdownBlock(this.instructionsFile, content, this.ctx.projectRoot);
  }

  async installMcp(config: McpConfig): Promise<string[]> {
    assertInsideRoot(this.mcpFile, this.ctx.projectRoot);
    const json = readMcpJsonFile(this.mcpFile);
    const servers = { ...(json.mcpServers ?? {}) };
    const launch = kitServerLaunch(config);
    const actions: string[] = [];

    servers[SERVER_NAME] = { type: 'stdio', command: launch.command, args: launch.args, env: launch.env };
    actions.push(`${SERVER_NAME} MCP server registered in ${this.mcpFile}`);

    actions.push(...applyExtraServers(servers, config.extraServers, this.mcpFile));

    writeFileSync(this.mcpFile, `${JSON.stringify({ ...json, mcpServers: servers }, null, 2)}\n`);
    return actions;
  }

  configuredServers(): Record<string, unknown> | null {
    return readConfiguredServers(this.mcpFile);
  }

  async verify(): Promise<VerificationResult> {
    const { launch, error } = readConfiguredLaunch(this.mcpFile);
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

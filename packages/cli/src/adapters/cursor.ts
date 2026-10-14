// packages/cli/src/adapters/cursor.ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HostAdapter } from './host-adapter.js';
import type { AdapterContext, McpConfig, VerificationResult } from '../types.js';
import { which, assertRealDirInsideRoot } from '../util.js';
import { syncSkills, readManifest, type SyncReport } from '../sync-skills.js';
import { upsertMarkdownBlock, assertInsideRoot, preflightMarkdownFile, type BlockAction } from '../managed-block.js';
import { instructionsContent } from '../instructions.js';
import { SERVER_NAME, kitServerLaunch } from '../mcp-launch.js';
import { checkInstructions, checkLaunchConfig, checkSkills, probeServer } from '../checks.js';
import { applyExtraServers, readConfiguredLaunch, readConfiguredServers, readMcpJsonFile } from '../mcp-json.js';

/**
 * Cursor reads skills from `.agents/skills/` and instructions from `AGENTS.md` (both shared with the Codex
 * adapter, with identical content so the two never rewrite each other) and MCP servers from `.cursor/mcp.json`.
 */
export class CursorAdapter implements HostAdapter {
  readonly name = 'cursor' as const;
  readonly supported = true;

  constructor(private readonly ctx: AdapterContext) {}

  get skillsDir(): string {
    return path.join(this.ctx.projectRoot, '.agents', 'skills');
  }

  get instructionsFile(): string {
    return path.join(this.ctx.projectRoot, 'AGENTS.md');
  }

  get cursorDir(): string {
    return path.join(this.ctx.projectRoot, '.cursor');
  }

  get mcpFile(): string {
    return path.join(this.cursorDir, 'mcp.json');
  }

  async detect(): Promise<boolean> {
    return which('cursor', this.ctx.env) !== null || existsSync(path.join(this.ctx.homeDir, '.cursor'));
  }

  /** `.cursor` must not escape the project; the file is only checked once its directory exists. */
  private assertMcpTarget(): void {
    assertRealDirInsideRoot(this.cursorDir, this.ctx.projectRoot);
    if (existsSync(this.cursorDir)) assertInsideRoot(this.mcpFile, this.ctx.projectRoot);
  }

  async preflight(_config: McpConfig): Promise<void> {
    assertRealDirInsideRoot(this.skillsDir, this.ctx.projectRoot);
    readManifest(this.skillsDir);
    preflightMarkdownFile(this.instructionsFile, this.ctx.projectRoot);
    this.assertMcpTarget();
    readMcpJsonFile(this.mcpFile);
  }

  async installSkills(sourceDir: string): Promise<SyncReport> {
    assertRealDirInsideRoot(this.skillsDir, this.ctx.projectRoot);
    return syncSkills(sourceDir, this.skillsDir, { kitVersion: this.ctx.kitVersion, force: this.ctx.force });
  }

  async installInstructions(): Promise<BlockAction> {
    // Same text the Codex adapter writes to the same file: Cursor and Codex both read AGENTS.md.
    const content = instructionsContent(this.ctx, 'codex');
    return upsertMarkdownBlock(this.instructionsFile, content, this.ctx.projectRoot);
  }

  async installMcp(config: McpConfig): Promise<string[]> {
    this.assertMcpTarget();
    const json = readMcpJsonFile(this.mcpFile);
    const servers = { ...(json.mcpServers ?? {}) };
    const launch = kitServerLaunch(config);
    servers[SERVER_NAME] = { type: 'stdio', command: launch.command, args: launch.args, env: launch.env };
    const actions = [`${SERVER_NAME} MCP server registered in ${this.mcpFile}`, ...applyExtraServers(servers, config.extraServers, this.mcpFile)];
    mkdirSync(this.cursorDir, { recursive: true });
    assertInsideRoot(this.mcpFile, this.ctx.projectRoot);
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
      'Cursor loads .cursor/mcp.json for this project and asks for approval before using MCP tools.',
      '.cursor/mcp.json holds absolute paths to this kit checkout and the project — keep it out of version control if the repo is shared.',
      'Skills (.agents/skills/) and AGENTS.md are shared with Codex: installing both hosts is safe and idempotent.'
    ];
  }
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse, stringify } from 'smol-toml';
import type { HostAdapter } from './host-adapter.js';
import type { AdapterContext, CheckResult, McpConfig, VerificationResult } from '../types.js';
import { which, assertRealDirInsideRoot } from '../util.js';
import { syncSkills, readManifest, type SyncReport } from '../sync-skills.js';
import { findManagedBlock, upsertMarkdownBlock, assertInsideRoot, preflightMarkdownFile, type BlockAction } from '../managed-block.js';
import { instructionsContent } from '../instructions.js';
import { FIGMA_MCP_URL, SERVER_NAME, kitServerLaunch, type ServerLaunch } from '../mcp-launch.js';
import { checkInstructions, checkLaunchConfig, checkSkills, probeServer } from '../checks.js';

export const TOML_BLOCK_START = '# >>> frontend-agent-kit (managed block — edits inside are overwritten)';
export const TOML_BLOCK_END = '# <<< frontend-agent-kit (add your own settings above this block)';
/** The end marker written by kit versions before v0.4's final review; still recognized when locating an existing block. */
const TOML_BLOCK_END_LEGACY = '# <<< frontend-agent-kit';
const TOML_BLOCK_END_VARIANTS = [TOML_BLOCK_END, TOML_BLOCK_END_LEGACY];

type TomlTable = Record<string, unknown>;

function parseToml(text: string, fileLabel: string): TomlTable {
  try {
    return parse(text) as TomlTable;
  } catch (error) {
    throw new Error(`frontend-agent: cannot parse ${fileLabel}: ${(error as Error).message}`);
  }
}

function serversOf(table: TomlTable): TomlTable {
  const servers = table.mcp_servers;
  return typeof servers === 'object' && servers !== null ? (servers as TomlTable) : {};
}

export class CodexAdapter implements HostAdapter {
  readonly name = 'codex' as const;
  readonly supported = true;

  constructor(private readonly ctx: AdapterContext) {}

  get skillsDir(): string {
    return path.join(this.ctx.projectRoot, '.agents', 'skills');
  }

  get instructionsFile(): string {
    return path.join(this.ctx.projectRoot, 'AGENTS.md');
  }

  get configFile(): string {
    return path.join(this.ctx.projectRoot, '.codex', 'config.toml');
  }

  get codexHome(): string {
    return this.ctx.env.CODEX_HOME || path.join(this.ctx.homeDir, '.codex');
  }

  async detect(): Promise<boolean> {
    return which('codex', this.ctx.env) !== null || existsSync(this.codexHome);
  }

  async preflight(config: McpConfig): Promise<void> {
    assertRealDirInsideRoot(this.skillsDir, this.ctx.projectRoot);
    readManifest(this.skillsDir);
    preflightMarkdownFile(this.instructionsFile, this.ctx.projectRoot);
    this.planMcp(config);
  }

  /** Parse the config text outside the managed block and reject a pre-existing frontend-agent entry. */
  private validateUserServers(userText: string): TomlTable {
    const userServers = serversOf(parseToml(userText, this.configFile));
    if (userServers[SERVER_NAME]) {
      throw new Error(
        `frontend-agent: ${this.configFile} already defines [mcp_servers.${SERVER_NAME}] outside the frontend-agent-kit block; remove it and re-run.`
      );
    }
    return userServers;
  }

  async installSkills(sourceDir: string): Promise<SyncReport> {
    assertRealDirInsideRoot(this.skillsDir, this.ctx.projectRoot);
    return syncSkills(sourceDir, this.skillsDir, { kitVersion: this.ctx.kitVersion, force: this.ctx.force });
  }

  async installInstructions(): Promise<BlockAction> {
    const content = instructionsContent(this.ctx, 'codex');
    return upsertMarkdownBlock(this.instructionsFile, content, this.ctx.projectRoot);
  }

  /** Compute the next config.toml text and validate it (parse + merge check) without writing. */
  private planMcp(config: McpConfig): { text: string; next: string; actions: string[] } {
    assertRealDirInsideRoot(path.dirname(this.configFile), this.ctx.projectRoot);
    if (existsSync(path.dirname(this.configFile))) assertInsideRoot(this.configFile, this.ctx.projectRoot);
    const text = existsSync(this.configFile) ? readFileSync(this.configFile, 'utf8') : '';
    const span = findManagedBlock(text, TOML_BLOCK_START, TOML_BLOCK_END_VARIANTS, this.configFile);
    const userText = span ? text.slice(0, span.from) + text.slice(span.to) : text;
    const userServers = this.validateUserServers(userText);

    const launch = kitServerLaunch(config);
    const servers: TomlTable = { [SERVER_NAME]: { command: launch.command, args: launch.args, env: launch.env } };
    const actions = [`${SERVER_NAME} MCP server registered in ${this.configFile}`];
    if (config.includeFigma) {
      if (userServers.figma) {
        actions.push(`figma MCP server already configured in ${this.configFile} — kept`);
      } else {
        servers.figma = { url: FIGMA_MCP_URL };
        actions.push(`figma MCP server registered in ${this.configFile} (authenticate with: codex mcp login figma)`);
      }
    }

    const block = `${TOML_BLOCK_START}\n${stringify({ mcp_servers: servers }).trim()}\n${TOML_BLOCK_END}\n`;
    const next = span
      ? text.slice(0, span.from) + block + text.slice(span.to)
      : userText.trimEnd()
        ? `${userText.trimEnd()}\n\n${block}`
        : block;

    let nextTable: TomlTable;
    try {
      nextTable = parse(next) as TomlTable;
    } catch (error) {
      throw new Error(
        `frontend-agent: cannot add the frontend-agent-kit block to ${this.configFile} (does it define mcp_servers as an inline table?): ${(error as Error).message}`
      );
    }
    // The block is placed textually, but TOML lets settings *below* it merge into the same table
    // (e.g. a key-value pair after the block lands in [mcp_servers.frontend-agent.env]). Catch that by
    // re-parsing the whole file and checking the servers we just wrote came through unchanged.
    const nextServers = serversOf(nextTable);
    // smol-toml's parsed values aren't plain Objects/Arrays (different prototypes), so compare
    // through a JSON round-trip rather than isDeepStrictEqual directly on the parser's output.
    const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
    const wroteCleanly =
      isDeepStrictEqual(plain(nextServers[SERVER_NAME]), plain(servers[SERVER_NAME])) &&
      (!servers.figma || isDeepStrictEqual(plain(nextServers.figma), plain(servers.figma)));
    if (!wroteCleanly) {
      throw new Error(
        `frontend-agent: settings were added below the frontend-agent-kit block in ${this.configFile} and would merge into it; move them above the block and re-run.`
      );
    }
    return { text, next, actions };
  }

  async installMcp(config: McpConfig): Promise<string[]> {
    const { text, next, actions } = this.planMcp(config);
    if (next !== text) {
      mkdirSync(path.dirname(this.configFile), { recursive: true });
      assertInsideRoot(this.configFile, this.ctx.projectRoot);
      writeFileSync(this.configFile, next);
    }
    return actions;
  }

  private configuredLaunch(): { launch: ServerLaunch | null; error?: string } {
    if (!existsSync(this.configFile)) return { launch: null };
    let table: TomlTable;
    try {
      table = parseToml(readFileSync(this.configFile, 'utf8'), this.configFile);
    } catch (error) {
      return { launch: null, error: (error as Error).message };
    }
    const entry = serversOf(table)[SERVER_NAME] as TomlTable | undefined;
    if (!entry || typeof entry.command !== 'string') return { launch: null };
    return {
      launch: {
        command: entry.command,
        args: Array.isArray(entry.args) ? entry.args.map(String) : [],
        env: (entry.env as Record<string, string> | undefined) ?? {}
      }
    };
  }

  private checkTrust(): CheckResult {
    const name = 'codex-trust';
    const globalConfig = path.join(this.codexHome, 'config.toml');
    const hint = `Codex only loads ${this.configFile} for trusted projects — start Codex in ${this.ctx.projectRoot} and choose to trust it`;
    if (!existsSync(globalConfig)) return { name, ok: false, detail: hint };
    let table: TomlTable;
    try {
      table = parseToml(readFileSync(globalConfig, 'utf8'), globalConfig);
    } catch (error) {
      return { name, ok: false, detail: (error as Error).message };
    }
    const projects = (table.projects ?? {}) as Record<string, { trust_level?: string }>;
    const ok = projects[this.ctx.projectRoot]?.trust_level === 'trusted';
    return { name, ok, detail: ok ? `${this.ctx.projectRoot} is trusted in ${globalConfig}` : hint };
  }

  async verify(): Promise<VerificationResult> {
    const { launch, error } = this.configuredLaunch();
    const configCheck = error
      ? { name: 'mcp-config', ok: false, detail: error }
      : checkLaunchConfig(launch, this.ctx.projectRoot, this.configFile);
    const checks = [
      checkSkills(this.skillsDir, path.join(this.ctx.kitRoot, 'skills')),
      checkInstructions(this.instructionsFile),
      configCheck,
      this.checkTrust(),
      configCheck.ok && launch
        ? await probeServer(launch)
        : { name: 'mcp-server', ok: false, detail: 'skipped: mcp-config check failed' }
    ];
    return { host: this.name, ok: checks.every((check) => check.ok), checks };
  }

  notes(): string[] {
    return [
      `Codex reads ${this.configFile} only for trusted projects — trust ${this.ctx.projectRoot} the first time you start Codex there.`,
      '.codex/config.toml holds absolute paths to this kit checkout — keep it out of version control if the repo is shared.'
    ];
  }
}

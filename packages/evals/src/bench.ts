import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { run as runCli } from '../../cli/src/cli.js';
import { kitServerLaunch } from '../../cli/src/mcp-launch.js';
import { evalsLayout, loadScenarios } from './load.js';
import { grade, type GradeResult, type Verdict } from './grade.js';
import { buildClaudeRun, buildCodexRun, type HostBinary, type McpServerSpec } from './hosts.js';
import { runProcess } from './process.js';
import { createWorkspace, removeWorkspace } from './workspace.js';
import { startStaticServer } from './static-server.js';
import { parseClaudeTranscript } from './transcript/claude.js';
import { parseCodexTranscript } from './transcript/codex.js';
import type { Category, HostId, Scenario } from './schema.js';
import type { RunRecord, Usage } from './types.js';

export interface BenchOptions {
  kitRoot: string;
  evalsDir: string;
  hosts: HostId[];
  scenarioIds?: string[];
  categories?: Category[];
  outDir: string;
  keep?: boolean;
  binaries?: Partial<Record<HostId, HostBinary>>;
  models?: Partial<Record<HostId, string>>;
  timeoutMsOverride?: number;
  maxOutputBytes?: number;
  /** Test hook: replaces the static file server started for each workspace. */
  startServer?: typeof startStaticServer;
  log?: (line: string) => void;
}

export interface CaseResult {
  scenarioId: string;
  category: Category;
  host: HostId;
  verdict: Verdict;
  grade: GradeResult;
  durationMs: number;
  usage?: Usage;
  model?: string;
  transcriptPath: string;
  workspace?: string;
}

export function selectScenarios(all: Scenario[], ids?: string[], categories?: Category[]): Scenario[] {
  for (const id of ids ?? []) {
    if (!all.some((s) => s.id === id)) throw new Error(`unknown scenario "${id}"`);
  }
  return all.filter((s) => (!ids?.length || ids.includes(s.id)) && (!categories?.length || categories.includes(s.category)));
}

function errorResult(scenario: Scenario, host: HostId, message: string, transcriptPath: string, workspace?: string): CaseResult {
  return {
    scenarioId: scenario.id,
    category: scenario.category,
    host,
    verdict: 'error',
    grade: { verdict: 'error', expected: [], forbidden: [], error: message },
    durationMs: 0,
    transcriptPath,
    workspace
  };
}

async function runCase(opts: BenchOptions, scenario: Scenario, host: HostId): Promise<CaseResult> {
  const layout = evalsLayout(opts.evalsDir);
  const transcriptDir = path.join(opts.outDir, 'transcripts', host);
  mkdirSync(transcriptDir, { recursive: true });
  const transcriptPath = path.join(transcriptDir, `${scenario.id}.jsonl`);
  const ws = createWorkspace(path.join(layout.fixturesDir, scenario.fixture));
  let server: { origin: string; close(): Promise<void> } | undefined;
  try {
    server = await (opts.startServer ?? startStaticServer)(ws);
    if (scenario.profile) {
      mkdirSync(path.join(ws, '.frontend-agent'), { recursive: true });
      writeFileSync(path.join(ws, '.frontend-agent', 'config.yml'), `validationProfile: ${scenario.profile}\n`);
    }
    const installErr: string[] = [];
    const code = await runCli(['install', host, '--project', ws, '--no-figma'], {
      stdout: () => {},
      stderr: (line) => installErr.push(line),
      env: process.env,
      cwd: ws,
      homeDir: process.env.HOME ?? ws
    });
    if (code !== 0) return errorResult(scenario, host, `kit install failed: ${installErr.join(' ')}`, transcriptPath, opts.keep ? ws : undefined);

    const tsx = path.join(opts.kitRoot, 'node_modules', '.bin', 'tsx');
    const kit = kitServerLaunch({ kitRoot: opts.kitRoot, projectRoot: ws, includeFigma: false });
    const servers: McpServerSpec[] = [
      { name: 'frontend-agent', command: kit.command, args: kit.args, env: kit.env },
      {
        name: 'figma',
        command: tsx,
        args: [path.join(opts.kitRoot, 'packages', 'evals', 'src', 'figma-mock', 'main.ts')],
        env: { FIGMA_MOCK_FIXTURE: path.join(layout.figmaDir, `${scenario.figma}.json`), FIGMA_MOCK_OUTPUT_ROOT: ws }
      }
    ];
    const prompt = scenario.prompt.replaceAll('{{baseUrl}}', server.origin);
    const binary = opts.binaries?.[host] ?? { command: host, prefixArgs: [] };
    const model = opts.models?.[host];
    const spec =
      host === 'claude'
        ? buildClaudeRun({ workspace: ws, prompt, servers, mcpConfigPath: path.join(transcriptDir, `${scenario.id}.mcp.json`), binary, model })
        : buildCodexRun({ workspace: ws, prompt, servers, binary, model });

    const proc = await runProcess(spec, opts.timeoutMsOverride ?? scenario.timeoutSec * 1000, transcriptPath, {
      maxOutputBytes: opts.maxOutputBytes
    });
    const parsed = host === 'claude' ? parseClaudeTranscript(proc.stdout) : parseCodexTranscript(proc.stdout);
    const record: RunRecord = {
      ...parsed,
      error: proc.spawnError ?? parsed.error,
      host,
      durationMs: proc.durationMs,
      exitCode: proc.spawnError ? 0 : proc.exitCode,
      timedOut: proc.timedOut,
      stderrTail: proc.stderrTail
    };
    if (proc.outputTruncated) record.error = `${record.error ? `${record.error}; ` : ''}host output exceeded the capture limit and was killed`;
    const result = grade(scenario, record, ws);
    if (result.verdict === 'error' && proc.stderrTail.trim()) result.error += ` — stderr: ${proc.stderrTail.trim().slice(-500)}`;
    return {
      scenarioId: scenario.id,
      category: scenario.category,
      host,
      verdict: result.verdict,
      grade: result,
      durationMs: proc.durationMs,
      usage: parsed.usage,
      model: parsed.model ?? model,
      transcriptPath,
      workspace: opts.keep ? ws : undefined
    };
  } finally {
    await server?.close();
    if (!opts.keep) removeWorkspace(ws);
  }
}

export async function runBench(opts: BenchOptions): Promise<CaseResult[]> {
  const log = opts.log ?? (() => {});
  const scenarios = selectScenarios(loadScenarios(evalsLayout(opts.evalsDir)), opts.scenarioIds, opts.categories);
  const results: CaseResult[] = [];
  for (const scenario of scenarios) {
    for (const host of opts.hosts) {
      log(`[${host}] ${scenario.id} …`);
      let result: CaseResult;
      try {
        result = await runCase(opts, scenario, host);
      } catch (error) {
        result = errorResult(scenario, host, (error as Error).message, '');
      }
      log(`[${host}] ${scenario.id}: ${result.verdict}${result.grade.error ? ` (${result.grade.error})` : ''}`);
      results.push(result);
    }
  }
  return results;
}

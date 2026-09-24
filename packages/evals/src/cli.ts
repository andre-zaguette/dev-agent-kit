import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { findKitRoot, readKitVersion } from '../../cli/src/util.js';
import { runBench } from './bench.js';
import { evalsLayout, loadScenarios } from './load.js';
import { writeReport } from './report.js';
import { CATEGORIES, HOSTS, type Category, type HostId } from './schema.js';

const HELP = `frontend-agent-bench — run the eval scenarios against real hosts (costs tokens)

Usage:
  npm run bench -- [--host claude|codex|all] [--scenario <id> ...] [--category base|stack|profile|backend ...]
                   [--model-claude <m>] [--model-codex <m>] [--out <dir>] [--keep]
  npm run bench -- --list        list scenarios
  npm run bench -- --validate    validate the scenario catalog only (free)`;

/** Timestamped results dir; the random suffix keeps concurrent runs started in the same millisecond apart. */
export function defaultOutDir(evalsDir: string, startedAt: string): string {
  return path.join(evalsDir, 'results', `${startedAt.replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`);
}

export async function runBenchCli(argv: string[], io: { stdout(l: string): void; stderr(l: string): void; cwd: string }): Promise<number> {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        host: { type: 'string', multiple: true },
        scenario: { type: 'string', multiple: true },
        category: { type: 'string', multiple: true },
        'model-claude': { type: 'string' },
        'model-codex': { type: 'string' },
        out: { type: 'string' },
        keep: { type: 'boolean', default: false },
        list: { type: 'boolean', default: false },
        validate: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false }
      }
    });
    if (values.help) {
      io.stdout(HELP);
      return 0;
    }
    const kitRoot = findKitRoot();
    const evalsDir = path.join(kitRoot, 'evals');
    const scenarios = loadScenarios(evalsLayout(evalsDir));
    if (values.validate) {
      io.stdout(`ok: ${scenarios.length} scenarios`);
      return 0;
    }
    if (values.list) {
      for (const s of scenarios) io.stdout(`${s.id.padEnd(28)} ${s.category.padEnd(8)} ${s.title}`);
      return 0;
    }
    const hostArgs = values.host ?? ['all'];
    const hosts: HostId[] = hostArgs.includes('all') ? [...HOSTS] : (hostArgs as HostId[]);
    for (const h of hosts) if (!HOSTS.includes(h)) throw new Error(`unknown host "${h}"`);
    const categories = (values.category ?? []) as Category[];
    for (const c of categories) if (!CATEGORIES.includes(c)) throw new Error(`unknown category "${c}"`);
    const startedAt = new Date().toISOString();
    const outDir = values.out ? path.resolve(io.cwd, values.out) : defaultOutDir(evalsDir, startedAt);
    const models: Partial<Record<HostId, string>> = {};
    if (values['model-claude']) models.claude = values['model-claude'];
    if (values['model-codex']) models.codex = values['model-codex'];

    const results = await runBench({
      kitRoot,
      evalsDir,
      hosts,
      scenarioIds: values.scenario,
      categories,
      outDir,
      keep: values.keep,
      models,
      log: io.stdout
    });
    const { reportPath } = writeReport(outDir, results, { startedAt, finishedAt: new Date().toISOString(), kitVersion: readKitVersion(), hosts, models });
    io.stdout(`\nreport: ${reportPath}`);
    return 0;
  } catch (error) {
    io.stderr(`frontend-agent-bench: ${(error as Error).message}`);
    return 1;
  }
}

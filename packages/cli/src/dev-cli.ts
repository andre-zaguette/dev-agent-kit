import { parseArgs } from 'node:util';
import { auditContext, detectProjectProfile, selectBackendReferences } from '../../core/src/index.js';
import { run, type CliIo } from './cli.js';
import { CliError, PROJECT_JSON, projectRootOf } from './dev-common.js';
import { readKitVersion } from './util.js';

export { CliError, projectRootOf } from './dev-common.js';

export const DEV_HELP = `dev-agent — deterministic helpers for the Dev Agent Kit

Usage:
  dev-agent install [claude|codex ...] [--all] [--project <dir>] [--force] [--no-figma]
  dev-agent verify  [claude|codex ...] [--all] [--project <dir>]
  dev-agent inspect [--project <dir>] [--json]
  dev-agent context audit [--project <dir>] [--json]
  dev-agent sources [--project <dir>] [--json]
  dev-agent sources verify [--project <dir>] [--json]
  dev-agent task resolve <identifier> [--source <id>] [--probe] [--project <dir>] [--json]
  dev-agent task status <KEY> [--project <dir>] [--json]
  dev-agent task show <KEY> [--project <dir>]
  dev-agent contract show <KEY> [--project <dir>]
  dev-agent contract verify <KEY> [--exchange <file> ...] [--openapi <file>] [--project <dir>] [--json]
  dev-agent contract usage <KEY> --client <dir> [--client <dir> ...] [--strict] [--project <dir>] [--json]
  dev-agent --help | --version

install and verify are aliases of the frontend-agent commands.
Exit codes: 0 ok, 1 usage or environment error, 2 checked and not OK.`;

function inspect(args: string[], io: CliIo): number {
  const { values } = parseArgs({ args, options: PROJECT_JSON });
  const root = projectRootOf(values, io);
  const profile = detectProjectProfile(root);
  const references = selectBackendReferences(profile);
  if (values.json) {
    io.stdout(JSON.stringify({ profile, backendReferences: references }, null, 2));
    return 0;
  }
  const list = (items: string[] | undefined): string => (items && items.length > 0 ? items.join(', ') : '-');
  io.stdout(`languages: ${list(profile.languages)}`);
  io.stdout(`frameworks: ${list(profile.frameworks)}`);
  io.stdout(`package manager: ${profile.packageManager ?? '-'}`);
  io.stdout(`test: ${list(profile.testCommands)}`);
  io.stdout(`lint: ${list(profile.lintCommands)}`);
  io.stdout(`typecheck: ${list(profile.typecheckCommands)}`);
  io.stdout(`database: ${profile.database ?? '-'}`);
  io.stdout(`migration tool: ${profile.migrationTool ?? '-'}`);
  io.stdout(`queues: ${list(profile.queues)}`);
  io.stdout(`cache: ${profile.cache ?? '-'}`);
  io.stdout(`docker: ${profile.docker ? 'yes' : 'no'}`);
  io.stdout(`base branch: ${profile.baseBranch ?? '-'}`);
  io.stdout(`backend references: ${references.length === 0 ? '-' : references.map((r) => `${r.skill}/${r.reference}`).join(', ')}`);
  return 0;
}

function contextAudit(args: string[], io: CliIo): number {
  const { values } = parseArgs({ args, options: PROJECT_JSON });
  const report = auditContext(projectRootOf(values, io));
  if (values.json) {
    io.stdout(JSON.stringify(report, null, 2));
    return 0;
  }
  io.stdout(`always-on: ~${report.alwaysOnTokens} tokens`);
  io.stdout(`removable (upper bound): ~${report.removableTokens} tokens`);
  for (const f of report.findings) io.stdout(`- [${f.kind}] ${f.path}: ${f.detail} (~${f.removableTokens} tokens)`);
  return 0;
}

export async function runDev(argv: string[], io: CliIo): Promise<number> {
  try {
    const [command, ...rest] = argv;
    if (command === '--version') {
      io.stdout(readKitVersion());
      return 0;
    }
    if (command === undefined || command === '--help' || command === '-h') {
      io.stdout(DEV_HELP);
      return command === undefined ? 1 : 0;
    }
    switch (command) {
      case 'install':
      case 'verify':
        return await run(argv, io);
      case 'inspect':
        return inspect(rest, io);
      case 'context':
        if (rest[0] === 'audit') return contextAudit(rest.slice(1), io);
        throw new CliError(`dev-agent: unknown context command "${rest[0] ?? ''}" — see --help.`);
      default:
        throw new CliError(`dev-agent: unknown command "${command}" — see --help.`);
    }
  } catch (error) {
    io.stderr((error as Error).message);
    return error instanceof CliError ? error.code : 1;
  }
}

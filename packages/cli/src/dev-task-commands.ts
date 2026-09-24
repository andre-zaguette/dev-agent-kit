import { parseArgs } from 'node:util';
import {
  CONFIG_FILE,
  assertWorkItemKey,
  checkResume,
  createGenericMcpAdapter,
  loadDevAgentConfig,
  parseDevAgentConfig,
  readLedger,
  resolveSource,
  routeOf,
  safeReadFile,
  type TaskSourceConfig
} from '../../core/src/index.js';
import type { CliIo } from './cli.js';
import { CliError, PROJECT_JSON, projectRootOf } from './dev-common.js';

function loadConfig(root: string) {
  try {
    return loadDevAgentConfig(root);
  } catch (error) {
    throw new CliError((error as Error).message, 1);
  }
}

const patterns = (s: TaskSourceConfig): string => (s.identifiers.length > 0 ? s.identifiers.map((r) => r.source).join(' ') : '-');

export function sourcesList(args: string[], io: CliIo): number {
  const { values } = parseArgs({ args, options: PROJECT_JSON });
  const config = loadConfig(projectRootOf(values, io));
  if (values.json) {
    io.stdout(JSON.stringify(config.taskSources.map((s) => ({ id: s.id, adapter: s.adapter, default: s.default, server: s.server ?? null, identifiers: s.identifiers.map((r) => r.source) })), null, 2));
    return 0;
  }
  if (config.taskSources.length === 0) {
    io.stdout('no task sources configured');
    return 0;
  }
  for (const s of config.taskSources) io.stdout(`${s.id.padEnd(14)}${s.adapter.padEnd(13)}${(s.default ? 'default' : '-').padEnd(9)}${(s.server ?? '-').padEnd(16)}${patterns(s)}`);
  return 0;
}

export function sourcesVerify(args: string[], io: CliIo): number {
  const { values } = parseArgs({ args, options: PROJECT_JSON });
  const root = projectRootOf(values, io);
  const findings: Array<{ level: 'ok' | 'warn' | 'error'; message: string }> = [];
  const add = (level: 'ok' | 'warn' | 'error', message: string) => findings.push({ level, message });

  let config;
  try {
    const text = safeReadFile(root, CONFIG_FILE);
    config = text === null ? loadDevAgentConfig(root) : parseDevAgentConfig(text);
    add('ok', 'config parses');
  } catch (error) {
    add('error', `config: ${(error as Error).message}`);
  }
  if (config) {
    const seen = new Map<string, string>();
    for (const s of config.taskSources) {
      if (s.adapter === 'generic-mcp') {
        try {
          const caps = createGenericMcpAdapter(s, async () => undefined).capabilities();
          const on = (['search', 'comments', 'attachments', 'links'] as const).filter((k) => caps[k]);
          add('ok', `${s.id}: generic-mcp adapter builds${on.length > 0 ? ` (${on.join(', ')})` : ''}`);
        } catch (error) {
          add('error', `${s.id}: ${(error as Error).message}`);
        }
      } else {
        add('warn', `${s.id}: adapter "${s.adapter}" cannot be loaded in this version`);
      }
      for (const re of s.identifiers) {
        const other = seen.get(re.source);
        if (other) add('warn', `${other} and ${s.id} share the identifier pattern ${re.source}: identifiers matching it would be ambiguous`);
        else seen.set(re.source, s.id);
      }
    }
    if (config.taskSources.length > 0 && !config.taskSources.some((s) => s.default)) {
      add('warn', 'no default source: an identifier that matches no pattern is unresolved');
      for (const s of config.taskSources) if (s.identifiers.length === 0) add('warn', `${s.id}: no identifiers and not the default, so it is reachable only with an explicit source`);
    }
  }
  const failed = findings.some((f) => f.level === 'error');
  if (values.json) io.stdout(JSON.stringify({ ok: !failed, findings }, null, 2));
  else for (const f of findings) io.stdout(`${f.level === 'ok' ? '✔' : f.level === 'warn' ? '!' : '✘'} ${f.message}`);
  return failed ? 2 : 0;
}

export function taskResolve(args: string[], io: CliIo): number {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { ...PROJECT_JSON, source: { type: 'string' }, probe: { type: 'boolean', default: false } } });
  const identifier = positionals[0];
  if (!identifier) throw new CliError('dev-agent: task resolve needs an identifier — see --help.');
  const config = loadConfig(projectRootOf(values, io));
  const result = resolveSource(identifier, config.taskSources.map(routeOf), { explicit: values.source, probe: values.probe });
  if (values.json) {
    io.stdout(JSON.stringify(result, null, 2));
  } else {
    switch (result.status) {
      case 'resolved':
        io.stdout(`resolved: ${result.source} (via ${result.via})`);
        break;
      case 'ambiguous':
        io.stdout(`ambiguous: ${result.candidates.join(', ')}`);
        break;
      case 'probe':
        io.stdout(`probe: ${result.candidates.join(', ')}`);
        break;
      case 'unknown-source':
        io.stdout(`unknown-source: ${result.source} (known: ${result.known.join(', ')})`);
        break;
      case 'unresolved':
        io.stdout(`unresolved: ${result.reason}`);
        break;
    }
  }
  return result.status === 'resolved' || result.status === 'probe' ? 0 : 2;
}

function keyOf(positionals: string[], what: string): string {
  const key = positionals[0];
  if (!key) throw new CliError(`dev-agent: task ${what} needs a work item key — see --help.`);
  try {
    assertWorkItemKey(key);
  } catch (error) {
    throw new CliError(`dev-agent: ${(error as Error).message}`, 1);
  }
  return key;
}

export function taskStatus(args: string[], io: CliIo): number {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: PROJECT_JSON });
  const key = keyOf(positionals, 'status');
  const root = projectRootOf(values, io);
  const result = checkResume(root, loadConfig(root), key);
  if (values.json) io.stdout(JSON.stringify(result, null, 2));
  else if (result.ok) {
    io.stdout(`phase: ${result.phase}`);
    io.stdout(`branch: ${result.state.workingBranch ?? '-'}`);
    io.stdout(`base: ${result.state.baseBranch ?? '-'} ${result.state.baseSha ?? ''}`.trimEnd());
    io.stdout(`source: ${result.state.source}`);
    io.stdout(`source configured: ${result.sourceConfigured ? 'yes' : 'no'}`);
    io.stdout(`stale knowledge: ${result.staleKnowledge.length > 0 ? result.staleKnowledge.join(', ') : '-'}`);
  } else {
    io.stdout('the task needs reconciling before it continues:');
    for (const reason of result.reasons) io.stdout(`- ${reason}`);
  }
  return result.ok ? 0 : 2;
}

export function taskShow(args: string[], io: CliIo): number {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { project: { type: 'string' } } });
  const key = keyOf(positionals, 'show');
  const root = projectRootOf(values, io);
  let ledger: string | null;
  try {
    ledger = readLedger(root, loadConfig(root), key);
  } catch (error) {
    throw new CliError((error as Error).message, 1);
  }
  if (ledger === null) throw new CliError(`dev-agent: no ledger for ${key}.`, 1);
  io.stdout(ledger.trimEnd());
  return 0;
}

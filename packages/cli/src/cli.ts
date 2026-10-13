import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ALL_HOSTS, REAL_HOSTS, createAdapter, type HostAdapter } from './adapters/index.js';
import { INTEGRATIONS, integrationChecks, type Detection, type IntegrationId } from './integrations/index.js';
import { resolveSelection, wantedIds, type SelectionFlags } from './integrations/select.js';
import { assertStateWritable, persistIntegrationState, readIntegrationState } from './integrations/state.js';
import type { AdapterContext, HostName } from './types.js';
import { findKitRoot, readKitVersion } from './util.js';

export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  env: NodeJS.ProcessEnv;
  cwd: string;
  homeDir: string;
}

const HELP = `frontend-agent — install the Frontend Agent Kit into a project

Usage:
  frontend-agent install [claude|codex ...] [--all] [--project <dir>] [--force] [--no-figma] [--with <id> ...] [--no-<id> ...]
  frontend-agent verify  [claude|codex ...] [--all] [--project <dir>]
  frontend-agent --help | --version

With no host, install/verify use every detected host (claude, codex).
--project defaults to the current directory. --force overwrites locally edited kit skills.
Integrations: figma (default), headroom, claude-mem, cartographer, graphify. --with enables one, --no-<id> disables one. The kit never installs the tools; verify reports what is missing.
Cursor and VS Code adapters are stubs in v0.4.`;

function resolveProjectRoot(value: string | undefined, io: CliIo, kitRoot: string): string {
  const resolved = path.resolve(io.cwd, value ?? '.');
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`frontend-agent: project directory "${resolved}" does not exist.`);
  }
  const projectRoot = realpathSync(resolved);
  if (projectRoot === realpathSync(kitRoot)) {
    throw new Error('frontend-agent: refusing to install into the kit checkout itself — pass --project <target project>.');
  }
  return projectRoot;
}

async function selectAdapters(positionals: string[], all: boolean, ctx: AdapterContext): Promise<HostAdapter[]> {
  for (const host of positionals) {
    if (!ALL_HOSTS.includes(host as HostName)) {
      throw new Error(`frontend-agent: unknown host "${host}" (expected one of: ${ALL_HOSTS.join(', ')}).`);
    }
  }
  const names: HostName[] = all ? REAL_HOSTS : (positionals as HostName[]);
  if (names.length > 0) return names.map((name) => createAdapter(name, ctx));

  const detected: HostAdapter[] = [];
  for (const name of REAL_HOSTS) {
    const adapter = createAdapter(name, ctx);
    if (await adapter.detect()) detected.push(adapter);
  }
  if (detected.length === 0) {
    throw new Error('frontend-agent: no supported host detected — pass claude or codex explicitly (or --all).');
  }
  return detected;
}

/** Run `fn` for `adapter`, prefixing any thrown error with `[<host>] ` so failures are attributable. */
async function withHostPrefix<T>(adapter: HostAdapter, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const err = error as Error;
    throw new Error(err.message.startsWith(`[${adapter.name}] `) ? err.message : `[${adapter.name}] ${err.message}`);
  }
}

async function install(adapters: HostAdapter[], ctx: AdapterContext, flags: SelectionFlags, io: CliIo): Promise<void> {
  for (const adapter of adapters) {
    if (!adapter.supported) {
      throw new Error(`frontend-agent: ${adapter.name} is not supported yet (stub adapter in v0.4 — spec §6).`);
    }
  }
  const previous = readIntegrationState(ctx.projectRoot);
  if (previous.error) throw new Error(`frontend-agent: ${previous.error}`);
  const selected = resolveSelection(flags, adapters.map((adapter) => adapter.name), previous.ids);
  const detections = new Map<IntegrationId, Detection>();
  for (const integration of selected) {
    const detection = await integration.detect(ctx);
    if (flags.with.includes(integration.id)) integration.assertInstallable?.(detection);
    detections.set(integration.id, detection);
  }
  assertStateWritable(ctx.projectRoot);
  const configFor = (adapter: HostAdapter) => ({
    kitRoot: ctx.kitRoot,
    projectRoot: ctx.projectRoot,
    extraServers: selected
      .filter((integration) => integration.hosts.includes(adapter.name))
      .flatMap((integration) => integration.plan(adapter.name, detections.get(integration.id)!))
  });
  // Fail closed: validate everything every selected host will touch before any of them writes
  // anything, so a problem with one host never leaves another partially installed.
  for (const adapter of adapters) {
    await withHostPrefix(adapter, () => adapter.preflight(configFor(adapter)));
  }
  for (const adapter of adapters) {
    io.stdout(`\n[${adapter.name}] installing into ${ctx.projectRoot}`);
    await withHostPrefix(adapter, async () => {
      const report = await adapter.installSkills(path.join(ctx.kitRoot, 'skills'));
      io.stdout(
        `  skills → ${report.targetDir}: ${report.added.length} added, ${report.updated.length} updated, ${report.removed.length} removed, ${report.unchanged.length} unchanged`
      );
      for (const skipped of report.skipped) io.stdout(`  ! skipped ${skipped.path}: ${skipped.reason}`);
      const instructions = await adapter.installInstructions();
      io.stdout(`  ${adapter.name === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'}: ${instructions}`);
      for (const action of await adapter.installMcp(configFor(adapter))) {
        io.stdout(`  ${action}`);
      }
      for (const note of adapter.notes()) io.stdout(`  note: ${note}`);
      for (const integration of selected.filter((candidate) => candidate.hosts.includes(adapter.name))) {
        for (const note of integration.notes(adapter.name, detections.get(integration.id)!)) io.stdout(`  note: ${note}`);
      }
    });
  }
  persistIntegrationState(ctx.projectRoot, wantedIds(flags, previous.ids));
  io.stdout(`\nDone. Run "frontend-agent verify${adapters.length === 1 ? ` ${adapters[0].name}` : ''} --project ${ctx.projectRoot}" to check the setup.`);
}

async function verify(adapters: HostAdapter[], ctx: AdapterContext, io: CliIo): Promise<boolean> {
  const state = readIntegrationState(ctx.projectRoot);
  let allOk = true;
  for (const adapter of adapters) {
    const result = await withHostPrefix(adapter, () => adapter.verify());
    result.checks.push(...(await integrationChecks(adapter, ctx, state)));
    result.ok = result.checks.every((check) => check.ok);
    const warned = result.checks.some((check) => check.warn);
    io.stdout(`\n[${adapter.name}] ${result.ok ? (warned ? 'ok (with warnings)' : 'ok') : 'NOT OK'}`);
    for (const check of result.checks) io.stdout(`  ${check.warn ? '!' : check.ok ? '✔' : '✘'} ${check.name}: ${check.detail}`);
    allOk &&= result.ok;
  }
  return allOk;
}

export async function run(argv: string[], io: CliIo): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        all: { type: 'boolean', default: false },
        project: { type: 'string' },
        force: { type: 'boolean', default: false },
        with: { type: 'string', multiple: true, default: [] },
        ...Object.fromEntries(INTEGRATIONS.map((integration) => [`no-${integration.id}`, { type: 'boolean', default: false }])),
        help: { type: 'boolean', default: false },
        version: { type: 'boolean', default: false }
      }
    });
    if (values.version) {
      io.stdout(readKitVersion());
      return 0;
    }
    const [command, ...hosts] = positionals;
    if (values.help || !command) {
      io.stdout(HELP);
      return values.help ? 0 : 1;
    }
    if (command !== 'install' && command !== 'verify') {
      throw new Error(`frontend-agent: unknown command "${command}" — see --help.`);
    }

    const kitRoot = findKitRoot();
    const ctx: AdapterContext = {
      projectRoot: resolveProjectRoot(values.project, io, kitRoot),
      kitRoot,
      kitVersion: readKitVersion(),
      env: io.env,
      homeDir: io.homeDir,
      force: values.force ?? false
    };
    const adapters = await selectAdapters(hosts, values.all ?? false, ctx);

    if (command === 'install') {
      const flags: SelectionFlags = {
        with: (values.with as string[] | undefined) ?? [],
        without: INTEGRATIONS.filter((integration) => (values as Record<string, unknown>)[`no-${integration.id}`] === true).map((integration) => integration.id)
      };
      await install(adapters, ctx, flags, io);
      return 0;
    }
    return (await verify(adapters, ctx, io)) ? 0 : 1;
  } catch (error) {
    io.stderr((error as Error).message);
    return 1;
  }
}

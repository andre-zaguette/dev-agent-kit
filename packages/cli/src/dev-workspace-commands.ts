import { parseArgs } from 'node:util';
import {
  checkPins,
  currentBranch,
  detectProjectProfile,
  dirtyFiles,
  isOwnRepository,
  loadDevAgentConfig,
  orderWorkspaces,
  workspaceRoot,
  type PinReport,
  type WorkspaceConfig
} from '../../core/src/index.js';
import type { CliIo } from './cli.js';
import { CliError, PROJECT_JSON, projectRootOf } from './dev-common.js';

const NONE = 'no workspaces configured';

type GitState = { state: 'repo'; branch: string | null; dirty: boolean } | { state: 'not-a-repository' } | { state: 'missing' } | { state: 'invalid'; reason: string };

function gitState(root: string, ws: WorkspaceConfig): { dir?: string; git: GitState } {
  let dir: string;
  try {
    dir = workspaceRoot(root, ws);
  } catch (error) {
    const message = (error as Error).message;
    return { git: /does not exist/.test(message) ? { state: 'missing' } : { state: 'invalid', reason: message.replace(/^workspace "[^"]*": /, '') } };
  }
  if (!isOwnRepository(dir)) return { dir, git: { state: 'not-a-repository' } };
  return { dir, git: { state: 'repo', branch: currentBranch(dir), dirty: (dirtyFiles(dir) ?? []).length > 0 } };
}

function describeGit(git: GitState): string {
  switch (git.state) {
    case 'repo':
      return `repo, ${git.branch ?? 'detached HEAD'}, ${git.dirty ? 'dirty' : 'clean'}`;
    case 'not-a-repository':
      return 'not a repository';
    case 'missing':
      return 'missing';
    default:
      return `invalid (${git.reason})`;
  }
}

function load(root: string) {
  try {
    return loadDevAgentConfig(root);
  } catch (error) {
    throw new CliError((error as Error).message, 1);
  }
}

const list = (items: string[] | undefined): string => (items && items.length > 0 ? items.join(', ') : '-');

export function workspacesList(args: string[], io: CliIo): number {
  const { values } = parseArgs({ args, options: PROJECT_JSON });
  const root = projectRootOf(values, io);
  const cfg = load(root);
  if (cfg.workspaces.length === 0) {
    io.stdout(NONE);
    return 0;
  }
  const rows = orderWorkspaces(cfg).map((ws) => {
    const { dir, git } = gitState(root, ws);
    const profile = dir ? detectProjectProfile(dir) : undefined;
    return { name: ws.name, path: ws.path, role: ws.role ?? null, dependsOn: ws.dependsOn, baseBranch: ws.baseBranch ?? null, languages: profile?.languages ?? [], frameworks: profile?.frameworks ?? [], git };
  });
  if (values.json) {
    io.stdout(JSON.stringify(rows, null, 2));
    return 0;
  }
  for (const r of rows) {
    io.stdout(`${r.name}  ${r.path}  role: ${r.role ?? '-'}  dependsOn: ${list(r.dependsOn)}  languages: ${list(r.languages)}  frameworks: ${list(r.frameworks)}  git: ${describeGit(r.git)}`);
  }
  return 0;
}

interface Check {
  name: string;
  path: string;
  errors: string[];
  warnings: string[];
}

function pinLine(p: PinReport): string {
  const detail = [p.constraint, p.version ? `${p.dependency} ${p.version}` : undefined].filter(Boolean).join(', ');
  return `pin ${p.dependent} -> ${p.dependency}: ${p.status}${detail ? ` (${detail})` : ''}${p.note ? ` — ${p.note}` : ''}`;
}

export function workspacesVerify(args: string[], io: CliIo): number {
  const { values } = parseArgs({ args, options: PROJECT_JSON });
  const root = projectRootOf(values, io);
  let cfg;
  try {
    cfg = loadDevAgentConfig(root);
  } catch (error) {
    const message = (error as Error).message;
    if (values.json) io.stdout(JSON.stringify({ ok: false, error: message }, null, 2));
    else io.stdout(`✘ config: ${message}`);
    return 2;
  }
  if (cfg.workspaces.length === 0) {
    io.stdout(NONE);
    return 0;
  }
  const checks: Check[] = orderWorkspaces(cfg).map((ws) => {
    const { git } = gitState(root, ws);
    const check: Check = { name: ws.name, path: ws.path, errors: [], warnings: [] };
    if (git.state === 'missing') check.errors.push(`directory "${ws.path}" does not exist`);
    else if (git.state === 'invalid') check.errors.push(git.reason);
    else if (git.state === 'not-a-repository') check.warnings.push('not a repository');
    return check;
  });
  const pins = checkPins(root, cfg.workspaces);
  const ok = checks.every((c) => c.errors.length === 0);
  if (values.json) {
    io.stdout(JSON.stringify({ ok, workspaces: checks, pins }, null, 2));
    return ok ? 0 : 2;
  }
  for (const c of checks) {
    if (c.errors.length > 0) io.stdout(`✘ ${c.name}: ${c.errors.join('; ')}`);
    else if (c.warnings.length > 0) io.stdout(`! ${c.name}: ${c.warnings.join('; ')}`);
    else io.stdout(`✔ ${c.name}: ${c.path} is a repository`);
  }
  for (const p of pins) io.stdout(`${p.status === 'ok' ? '✔' : '!'} ${pinLine(p)}`);
  return ok ? 0 : 2;
}

export function workspacesOrder(args: string[], io: CliIo): number {
  const { values } = parseArgs({ args, options: { ...PROJECT_JSON, only: { type: 'string' }, 'with-deps': { type: 'boolean', default: false } } });
  const cfg = load(projectRootOf(values, io));
  if (cfg.workspaces.length === 0) {
    io.stdout(NONE);
    return 0;
  }
  let ordered;
  try {
    const only = values.only === undefined ? undefined : values.only.split(',').map((n) => n.trim()).filter(Boolean);
    ordered = orderWorkspaces(cfg, { only, withDeps: values['with-deps'] });
  } catch (error) {
    throw new CliError(`dev-agent: ${(error as Error).message}.`, 1);
  }
  if (values.json) io.stdout(JSON.stringify(ordered.map((w) => w.name), null, 2));
  else for (const w of ordered) io.stdout(w.name);
  return 0;
}

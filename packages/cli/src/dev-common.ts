import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { findWorkspace, loadDevAgentConfig, workspaceRoot, type DevAgentConfig, type WorkspaceConfig } from '../../core/src/index.js';
import type { CliIo } from './cli.js';

export class CliError extends Error {
  constructor(
    message: string,
    readonly code = 1
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export const PROJECT_JSON = { project: { type: 'string' }, json: { type: 'boolean', default: false } } as const;

export function projectRootOf(values: { project?: string }, io: CliIo): string {
  const resolved = path.resolve(io.cwd, values.project ?? '.');
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) throw new CliError(`dev-agent: project directory "${resolved}" does not exist.`);
  return realpathSync(resolved);
}

export interface Target {
  /** The project (workspace root) directory. */
  root: string;
  /** The directory a per-project command runs in: the project itself, or one workspace. */
  dir: string;
  workspace?: WorkspaceConfig;
  /** `--workspace all` (only when the command allows it). */
  all?: boolean;
  /** Loaded only when --workspace was given. */
  config?: DevAgentConfig;
}

/** One place that turns `--project` and `--workspace` into the directory a command works on. */
export function resolveTarget(values: { project?: string; workspace?: string }, io: CliIo, opts: { allowAll?: boolean; command?: string } = {}): Target {
  const root = projectRootOf(values, io);
  if (values.workspace === undefined) return { root, dir: root };
  let config: DevAgentConfig;
  try {
    config = loadDevAgentConfig(root);
  } catch (error) {
    throw new CliError((error as Error).message, 1);
  }
  if (config.workspaces.length === 0) throw new CliError('dev-agent: --workspace needs a "workspaces:" map in .dev-agent/config.yml; no workspaces configured.', 1);
  if (values.workspace === 'all') {
    if (!opts.allowAll) throw new CliError('dev-agent: --workspace "all" is only supported by diff review.', 1);
    return { root, dir: root, all: true, config };
  }
  try {
    const workspace = findWorkspace(config, values.workspace);
    return { root, dir: workspaceRoot(root, workspace), workspace, config };
  } catch (error) {
    throw new CliError(`dev-agent: ${(error as Error).message}.`, 1);
  }
}

import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
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

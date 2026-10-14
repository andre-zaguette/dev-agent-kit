// packages/core/src/task-sources/native/index.ts
import type { FetchLike } from '../http.js';
import { SourceUnavailableError, isNativeAdapter, type TaskSourceAdapter, type TaskSourceConfig } from '../types.js';
import type { NativeDeps } from './common.js';
import { createGithubIssuesAdapter } from './github-issues.js';
import { createJiraAdapter } from './jira.js';
import { createLinearAdapter } from './linear.js';
import { createYoutrackAdapter } from './youtrack.js';

export type { NativeDeps } from './common.js';
export { adfToText } from './jira.js';

function readVariable(env: Record<string, string | undefined>, name: string | undefined, sourceId: string): string {
  const value = name === undefined ? undefined : env[name]?.trim();
  if (!name || !value) throw new SourceUnavailableError(`source "${sourceId}": environment variable ${name ?? '(tokenEnv)'} is not set`, 'auth');
  return value;
}

export function createNativeAdapter(config: TaskSourceConfig, opts: { env: Record<string, string | undefined>; fetch: FetchLike }): TaskSourceAdapter {
  if (!isNativeAdapter(config.adapter)) throw new Error(`source "${config.id}" is not a native source`);
  const token = readVariable(opts.env, config.tokenEnv, config.id);
  const deps: NativeDeps = { config, token, fetch: opts.fetch };
  switch (config.adapter) {
    case 'github-issues':
      return createGithubIssuesAdapter(deps);
    case 'linear':
      return createLinearAdapter(deps);
    case 'jira':
      return createJiraAdapter(config.auth === 'bearer' ? deps : { ...deps, email: readVariable(opts.env, config.emailEnv, config.id) });
    case 'youtrack':
      return createYoutrackAdapter(deps);
  }
}

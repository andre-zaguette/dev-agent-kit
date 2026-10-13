import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertInsideRoot } from '../managed-block.js';
import { assertRealDirInsideRoot } from '../util.js';
import { INTEGRATIONS } from './index.js';
import { INTEGRATION_IDS, type IntegrationId } from './types.js';

export const STATE_FILE = '.dev-agent/integrations.json';

export interface IntegrationState {
  ids: IntegrationId[];
  error?: string;
}

export function readIntegrationState(root: string): IntegrationState {
  const file = path.join(root, STATE_FILE);
  if (!existsSync(file)) return { ids: [] };
  const fail = (message: string): IntegrationState => ({ ids: [], error: `${STATE_FILE}: ${message}` });
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return fail(`invalid JSON (${(error as Error).message.split('\n')[0]})`);
  }
  const enabled = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as { enabled?: unknown }).enabled : undefined;
  if (!Array.isArray(enabled) || enabled.some((id) => typeof id !== 'string')) return fail('expected {"enabled": ["<id>", ...]}');
  const valid = [...INTEGRATION_IDS] as string[];
  const unknown = (enabled as string[]).filter((id) => !valid.includes(id));
  if (unknown.length > 0) return fail(`unknown integration id(s): ${unknown.join(', ')} (expected: ${valid.join(', ')})`);
  return { ids: enabled as IntegrationId[] };
}

/** Fail closed before any host writes: `.dev-agent` must not escape the project through a symlink. */
export function assertStateWritable(root: string): void {
  assertRealDirInsideRoot(path.join(root, '.dev-agent'), root);
  const file = path.join(root, STATE_FILE);
  if (existsSync(path.dirname(file))) assertInsideRoot(file, root);
}

/** Record the selected ids. Writes nothing when there is no file yet and the selection is just the defaults. */
export function persistIntegrationState(root: string, ids: IntegrationId[]): void {
  assertStateWritable(root);
  const file = path.join(root, STATE_FILE);
  const defaults = INTEGRATIONS.filter((integration) => integration.defaultOn).map((integration) => integration.id);
  const isDefault = ids.length === defaults.length && defaults.every((id) => ids.includes(id));
  if (!existsSync(file) && isDefault) return;
  mkdirSync(path.dirname(file), { recursive: true });
  assertInsideRoot(file, root);
  writeFileSync(file, `${JSON.stringify({ enabled: ids }, null, 2)}\n`);
}

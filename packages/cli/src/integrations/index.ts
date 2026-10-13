import type { Integration } from './types.js';
import { figma } from './figma.js';
import { headroom } from './headroom.js';
import type { HostAdapter } from '../adapters/host-adapter.js';
import type { AdapterContext, CheckResult } from '../types.js';
import type { IntegrationState } from './state.js';

export type { Integration, IntegrationId, Detection, McpServerChange } from './types.js';

export const INTEGRATIONS: readonly Integration[] = [figma, headroom];

export function integrationById(id: string): Integration | undefined {
  return INTEGRATIONS.find((integration) => integration.id === id);
}

/** The verify checks of every integration this project has enabled and that applies to `host`. */
export async function integrationChecks(host: HostAdapter, ctx: AdapterContext, state: IntegrationState): Promise<CheckResult[]> {
  if (state.error) return [{ name: 'integrations-state', ok: false, detail: state.error }];
  const configured = host.configuredServers();
  const checks: CheckResult[] = [];
  for (const integration of INTEGRATIONS) {
    if (!state.ids.includes(integration.id) || !integration.hosts.includes(host.name)) continue;
    checks.push(...integration.verify(host.name, ctx, await integration.detect(ctx), configured));
  }
  return checks;
}

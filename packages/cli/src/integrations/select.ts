import type { HostName } from '../types.js';
import { INTEGRATIONS } from './index.js';
import { INTEGRATION_IDS, type Integration, type IntegrationId } from './types.js';

export interface SelectionFlags {
  with: string[];
  without: IntegrationId[];
}

/**
 * Which integrations apply to this install: the defaults, plus what a previous install recorded, plus --with,
 * minus --no-<id>. Only an explicit --with can be a usage error; recorded ids that the selected hosts do not
 * support are skipped quietly.
 */
export function resolveSelection(
  flags: SelectionFlags,
  hosts: HostName[],
  previous: IntegrationId[],
  registry: readonly Integration[] = INTEGRATIONS
): Integration[] {
  const validIds = registry.map((integration) => integration.id);
  for (const id of flags.with) {
    const integration = registry.find((candidate) => candidate.id === id);
    if (!integration) {
      throw new Error(`frontend-agent: unknown integration "${id}" (expected one of: ${validIds.join(', ')}).`);
    }
    if (flags.without.includes(integration.id)) {
      throw new Error(`frontend-agent: --with ${id} and --no-${id} conflict; pass only one.`);
    }
    if (!integration.hosts.some((host) => hosts.includes(host))) {
      throw new Error(
        `frontend-agent: --with ${id} needs one of these hosts: ${integration.hosts.join(', ')} (selected: ${hosts.join(', ')}).`
      );
    }
  }
  const wanted = new Set<string>(wantedIds(flags, previous, registry));
  return registry.filter((integration) => wanted.has(integration.id) && integration.hosts.some((host) => hosts.includes(host)));
}

/** The ids to record: defaults + previously recorded + --with, minus --no-<id>, not filtered by host. */
export function wantedIds(flags: SelectionFlags, previous: IntegrationId[], registry: readonly Integration[] = INTEGRATIONS): IntegrationId[] {
  const wanted = new Set<string>([
    ...registry.filter((integration) => integration.defaultOn).map((integration) => integration.id),
    ...previous,
    ...flags.with
  ]);
  for (const id of flags.without) wanted.delete(id);
  return INTEGRATION_IDS.filter((id) => wanted.has(id));
}

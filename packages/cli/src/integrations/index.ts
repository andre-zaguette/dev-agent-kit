import type { Integration } from './types.js';
import { figma } from './figma.js';

export type { Integration, IntegrationId, Detection, McpServerChange } from './types.js';

export const INTEGRATIONS: readonly Integration[] = [figma];

export function integrationById(id: string): Integration | undefined {
  return INTEGRATIONS.find((integration) => integration.id === id);
}

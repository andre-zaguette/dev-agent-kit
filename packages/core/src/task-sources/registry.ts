import { resolveSource } from './resolver.js';
import type { Resolution, SourceRoute, TaskSourceAdapter, TaskSourceConfig } from './types.js';

export function routeOf(config: TaskSourceConfig): SourceRoute {
  return { id: config.id, identifiers: config.identifiers, default: config.default };
}

export class TaskSourceRegistry {
  private readonly adapters = new Map<string, TaskSourceAdapter>();
  private readonly routes = new Map<string, SourceRoute>();

  register(adapter: TaskSourceAdapter, route: Partial<Omit<SourceRoute, 'id'>> = {}): void {
    if (this.adapters.has(adapter.id)) throw new Error(`task source "${adapter.id}" is already registered`);
    if (route.default) {
      const existing = [...this.routes.values()].find((r) => r.default);
      if (existing) throw new Error(`only one default task source is allowed ("${existing.id}" already is)`);
    }
    this.adapters.set(adapter.id, adapter);
    this.routes.set(adapter.id, { id: adapter.id, identifiers: route.identifiers ?? [], default: route.default ?? false });
  }

  list(): string[] {
    return [...this.adapters.keys()];
  }

  get(id: string): TaskSourceAdapter | undefined {
    return this.adapters.get(id);
  }

  resolve(identifier: string, opts: { explicit?: string; probe?: boolean } = {}): Resolution {
    return resolveSource(identifier, [...this.routes.values()], opts);
  }
}

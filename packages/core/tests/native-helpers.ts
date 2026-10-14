// packages/core/tests/native-helpers.ts
import type { FetchLike } from '../src/task-sources/http.ts';
import type { TaskSourceConfig } from '../src/task-sources/types.ts';

export interface Call { url: string; method: string; headers: Record<string, string>; body?: string; redirect: string }
export interface Route { match: string | ((call: Call) => boolean); status?: number; json?: unknown; text?: string; headers?: Record<string, string> }

export function fakeFetch(routes: Route[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: Call = { url, method: init.method, headers: init.headers, body: init.body, redirect: init.redirect };
    calls.push(call);
    const route = routes.find((r) => (typeof r.match === 'string' ? url === r.match : r.match(call)));
    if (!route) throw new Error(`unexpected request: ${init.method} ${url}`);
    const text = route.text ?? JSON.stringify(route.json ?? {});
    const headers = route.headers ?? {};
    return { status: route.status ?? 200, headers: { get: (name) => headers[name.toLowerCase()] ?? null }, text: async () => text };
  };
  return { fetch, calls };
}

export function sourceConfig(adapter: string, extra: Partial<TaskSourceConfig> = {}): TaskSourceConfig {
  return { id: 'work', adapter, default: true, identifiers: [], tools: {}, mapping: { fields: {}, comments: {}, attachments: {}, links: {} }, tokenEnv: 'TRACKER_TOKEN', ...extra };
}

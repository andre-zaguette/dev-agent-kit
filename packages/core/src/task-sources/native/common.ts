import type { FetchLike } from '../http.js';
import { normalizeWorkItem } from '../normalizer.js';
import type { SourceMapping, TaskSourceAdapter, TaskSourceCapabilities, TaskSourceConfig, WorkItem } from '../types.js';

export interface NativeDeps {
  config: TaskSourceConfig;
  token: string;
  email?: string;
  fetch: FetchLike;
}

export interface NativeParts {
  item: Record<string, unknown>;
  comments?: unknown[];
  attachments?: unknown[];
  links?: unknown[];
  partial?: string[];
  /** The tracker's own reference when `key` had to be made ledger-safe (for example `acme/app#42`). */
  reference?: string;
}

/** Each adapter builds a payload that already uses the canonical field names, so the mapping is the identity. */
const IDENTITY_MAPPING: SourceMapping = {
  fields: { id: 'id', key: 'key', title: 'title', description: 'description', status: 'status', type: 'type', priority: 'priority', labels: 'labels', assigneeId: 'assigneeId', assigneeName: 'assigneeName', url: 'url' },
  comments: {},
  attachments: {},
  links: {}
};

export function buildWorkItem(sourceId: string, parts: NativeParts): WorkItem {
  const item = normalizeWorkItem(sourceId, IDENTITY_MAPPING, { item: parts.item, comments: parts.comments ?? [], attachments: parts.attachments ?? [], links: parts.links ?? [] });
  const extra: Record<string, unknown> = {};
  if (parts.partial && parts.partial.length > 0) extra.partial = parts.partial;
  if (parts.reference) extra.reference = parts.reference;
  if (Object.keys(extra).length > 0) item.metadata = { ...item.metadata, ...extra };
  return item;
}

/** Run an optional lookup; on any failure record the list name instead of failing the whole item. */
export async function optional<T>(name: string, partial: string[], run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch {
    partial.push(name);
    return fallback;
  }
}

export function makeAdapter(id: string, capabilities: TaskSourceCapabilities, load: (identifier: string) => Promise<WorkItem>): TaskSourceAdapter {
  const adapter: TaskSourceAdapter = { id, capabilities: () => capabilities, getWorkItem: load };
  if (capabilities.comments) adapter.getComments = async (identifier) => (await load(identifier)).comments;
  if (capabilities.attachments) adapter.getAttachments = async (identifier) => (await load(identifier)).attachments;
  if (capabilities.links) adapter.getLinkedItems = async (identifier) => (await load(identifier)).links;
  return adapter;
}

/** `<base>-<number>` restricted to the ledger's key alphabet, at most 64 characters, starting with a letter or digit. */
export function ledgerKey(base: string, number: string): string {
  const suffix = `-${number}`;
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/\.{2,}/g, '.').replace(/^[^A-Za-z0-9]+/, '');
  return `${(cleaned || 'item').slice(0, 64 - suffix.length)}${suffix}`;
}

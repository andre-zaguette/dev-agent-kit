import { findSecret } from '../secrets.js';
import { compact, getPath, listAt, toText } from './mapping.js';
import { normalizeAttachments, normalizeComments, normalizeLinks, normalizeWorkItem } from './normalizer.js';
import {
  SourceUnavailableError,
  WorkItemNotFoundError,
  type TaskSourceAdapter,
  type TaskSourceConfig,
  type ToolRef,
  type WorkItemSummary
} from './types.js';

export type McpToolCaller = (server: string, tool: string, args: Record<string, unknown>) => Promise<unknown>;

const AUTH_RE = /\b(?:401|403|unauthori[sz]ed|forbidden|not authenticated|authentication|auth(?:orization)? (?:failed|required|error)|invalid (?:token|credentials)|token (?:expired|invalid)|permission denied)\b/i;
const NOT_FOUND_RE = /\b(?:404|not found|does not exist|no such|unknown (?:issue|ticket|item))\b/i;
const IDENTIFIER_RE = /^[^\u0000-\u001F\u007F]{1,256}$/;
const MAX_SEARCH_RESULTS = 50;
const OPTIONAL_KINDS = ['comments', 'attachments', 'links'] as const;

const ENVELOPE_KEYS = new Set(['content', 'isError', 'structuredContent', '_meta']);
const CONTENT_TYPES = new Set(['text', 'image', 'audio', 'resource', 'resource_link']);

const isEnvelope = (value: unknown): value is { content: Array<Record<string, unknown>>; structuredContent?: unknown; isError?: boolean } =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => ENVELOPE_KEYS.has(key)) &&
  Array.isArray((value as { content?: unknown }).content) &&
  (value as { content: unknown[] }).content.every((c) => typeof c === 'object' && c !== null && CONTENT_TYPES.has((c as { type?: string }).type as string));

/** Message that is safe to show or log: bounded, and never a secret. */
function scrub(text: string): string {
  return findSecret(text) ? '[redacted]' : text.slice(0, 200);
}

function classify(text: string, sourceId: string): Error {
  const safe = scrub(text);
  if (AUTH_RE.test(text)) return new SourceUnavailableError(`source "${sourceId}" rejected the request (authentication): ${safe}`, 'auth');
  if (NOT_FOUND_RE.test(text)) return new WorkItemNotFoundError(`work item not found in source "${sourceId}": ${safe}`);
  return new SourceUnavailableError(`source "${sourceId}" is unavailable: ${safe}`, 'unavailable');
}

/** MCP `CallToolResult` (or a plain value) -> the payload. Throws the classified error for `isError` results. */
export function unwrapToolResult(result: unknown, sourceId = 'source'): unknown {
  if (!isEnvelope(result)) return result;
  const text = result.content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('\n');
  if (result.isError) throw classify(text || 'the tool reported an error', sourceId);
  if (result.structuredContent !== undefined) return result.structuredContent;
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createGenericMcpAdapter(config: TaskSourceConfig, call: McpToolCaller): TaskSourceAdapter {
  if (config.adapter !== 'generic-mcp') throw new Error(`source "${config.id}" is not a generic-mcp source`);
  const server = config.server;
  if (!server) throw new Error(`source "${config.id}" needs a server`);
  const tools = config.tools;
  if (!tools.get) throw new Error(`source "${config.id}" needs a get tool`);
  const getTool = tools.get;

  async function invoke(ref: ToolRef, defaultArg: string, value: string): Promise<unknown> {
    let result: unknown;
    try {
      result = await call(server!, ref.name, { [ref.arg ?? defaultArg]: value });
    } catch (error) {
      throw classify((error as Error)?.message ?? String(error), config.id);
    }
    return unwrapToolResult(result, config.id);
  }

  const assertIdentifier = (identifier: string) => {
    if (!IDENTIFIER_RE.test(identifier)) throw new Error('identifier must be 1-256 printable characters');
  };

  const adapter: TaskSourceAdapter = {
    id: config.id,
    capabilities: () => ({ search: !!tools.search, comments: !!tools.comments, attachments: !!tools.attachments, links: !!tools.links, write: false }),
    async getWorkItem(identifier) {
      assertIdentifier(identifier);
      const item = await invoke(getTool, 'id', identifier);
      if (item === null || item === undefined || item === '') throw new WorkItemNotFoundError(`work item "${identifier}" was not found in source "${config.id}"`);
      const extras: Partial<Record<(typeof OPTIONAL_KINDS)[number], unknown>> = {};
      const partial: string[] = [];
      for (const kind of OPTIONAL_KINDS) {
        const ref = tools[kind];
        if (!ref) continue;
        try {
          extras[kind] = await invoke(ref, 'id', identifier);
        } catch {
          partial.push(kind);
        }
      }
      const workItem = normalizeWorkItem(config.id, config.mapping, { item, ...extras }, { comments: tools.comments?.list, attachments: tools.attachments?.list, links: tools.links?.list });
      if (partial.length > 0) workItem.metadata = { ...workItem.metadata, partial };
      return workItem;
    }
  };

  if (tools.search) {
    const ref = tools.search;
    adapter.search = async (query) => {
      assertIdentifier(query);
      const raw = await invoke(ref, 'query', query);
      const f = config.mapping.fields;
      return listAt(raw, ref.list)
        .slice(0, MAX_SEARCH_RESULTS)
        .flatMap((entry): WorkItemSummary[] => {
          const key = f.key ? toText(getPath(entry, f.key)) : undefined;
          const title = f.title ? toText(getPath(entry, f.title)) : undefined;
          if (!key || !title) return [];
          return [compact({ key, title, status: f.status ? toText(getPath(entry, f.status)) : undefined })];
        });
    };
  }
  if (tools.comments) {
    const ref = tools.comments;
    adapter.getComments = async (identifier) => (assertIdentifier(identifier), normalizeComments(config.mapping, await invoke(ref, 'id', identifier), ref.list));
  }
  if (tools.attachments) {
    const ref = tools.attachments;
    adapter.getAttachments = async (identifier) => (assertIdentifier(identifier), normalizeAttachments(config.mapping, await invoke(ref, 'id', identifier), ref.list));
  }
  if (tools.links) {
    const ref = tools.links;
    adapter.getLinkedItems = async (identifier) => (assertIdentifier(identifier), normalizeLinks(config.mapping, await invoke(ref, 'id', identifier), ref.list));
  }
  return adapter;
}

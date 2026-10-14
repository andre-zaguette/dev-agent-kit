import { redactSecrets } from '../secrets.js';
import { SourceUnavailableError, WorkItemNotFoundError } from './types.js';

export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  redirect: 'manual';
  signal: AbortSignal;
}
export interface FetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>;

export interface HttpContext {
  sourceId: string;
  fetch: FetchLike;
  headers: Record<string, string>;
  /** Literal secret values (token, encoded credentials) to strip from any message. */
  secrets?: string[];
  timeoutMs?: number;
  maxBytes?: number;
}

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const AUTH_RE = /\b(?:unauthori[sz]ed|forbidden|not authenticated|authentication|invalid (?:token|credentials)|token (?:expired|invalid)|permission denied|bad credentials)\b/i;
const NOT_FOUND_RE = /\b(?:not found|does not exist|no such|unknown (?:issue|ticket|item))\b/i;
const RATE_RE = /rate limit|too many requests|abuse/i;

/** Bounded, single-line, with every known secret and every secret-looking span removed. */
export function safeMessage(text: string, secrets: string[] = []): string {
  let out = text;
  for (const secret of secrets) if (secret.length >= 4) out = out.split(secret).join('[redacted]');
  return redactSecrets(out).replace(/\s+/g, ' ').trim().slice(0, 200);
}

export const joinUrl = (base: string, path: string): string => `${base.replace(/\/+$/, '')}${path}`;

/** Classify a failure that only has a message (for example a GraphQL `errors` array). */
export function classifyMessage(sourceId: string, text: string, secrets: string[] = []): Error {
  const detail = safeMessage(text, secrets);
  if (AUTH_RE.test(text)) return new SourceUnavailableError(`source "${sourceId}" rejected the request (authentication): ${detail}`, 'auth');
  if (NOT_FOUND_RE.test(text)) return new WorkItemNotFoundError(`work item not found in source "${sourceId}": ${detail}`);
  return new SourceUnavailableError(`source "${sourceId}" is unavailable: ${detail}`, 'unavailable');
}

function failFor(ctx: HttpContext, status: number, text: string, retryAfter: string | null): Error {
  const secrets = ctx.secrets ?? [];
  const where = `source "${ctx.sourceId}"`;
  const detail = safeMessage(text, secrets);
  if (status >= 300 && status < 400) return new SourceUnavailableError(`${where} answered with a redirect (${status}), which is not followed`, 'unavailable');
  if (status === 429 || (status === 403 && RATE_RE.test(text))) {
    return new SourceUnavailableError(`${where} is rate limiting requests${retryAfter ? ` (retry after ${safeMessage(retryAfter, secrets)})` : ''}`, 'unavailable');
  }
  if (status === 401 || status === 403 || (status === 400 && AUTH_RE.test(text))) {
    return new SourceUnavailableError(`${where} rejected the request (authentication, ${status}): ${detail}`, 'auth');
  }
  if (status === 404) return new WorkItemNotFoundError(`work item not found in ${where}: ${detail}`);
  return new SourceUnavailableError(`${where} is unavailable (${status}): ${detail}`, 'unavailable');
}

export async function httpJson(ctx: HttpContext, url: string, body?: unknown): Promise<unknown> {
  const maxBytes = ctx.maxBytes ?? DEFAULT_MAX_BYTES;
  const tooBig = () => new SourceUnavailableError(`source "${ctx.sourceId}" answered with more than ${maxBytes} bytes`, 'unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let status: number;
  let text: string;
  let retryAfter: string | null;
  try {
    const res = await ctx.fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...ctx.headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: controller.signal
    });
    status = res.status;
    retryAfter = res.headers.get('retry-after');
    if (Number(res.headers.get('content-length') ?? '0') > maxBytes) throw tooBig();
    text = await res.text();
  } catch (error) {
    if (error instanceof SourceUnavailableError) throw error;
    const timedOut = controller.signal.aborted ? ' (timed out)' : '';
    throw new SourceUnavailableError(`source "${ctx.sourceId}" is unreachable${timedOut}: ${safeMessage((error as Error)?.message ?? String(error), ctx.secrets)}`, 'unavailable');
  } finally {
    clearTimeout(timer);
  }
  if (text.length > maxBytes) throw tooBig();
  if (status < 200 || status >= 300) throw failFor(ctx, status, text, retryAfter);
  try {
    return JSON.parse(text);
  } catch {
    throw new SourceUnavailableError(`source "${ctx.sourceId}" returned a malformed response`, 'unavailable');
  }
}

/** Fetch pages until a short page, `maxItems` or `maxPages`; `truncated` says a cap stopped the walk. */
export async function collectPages<T>(fetchPage: (page: number) => Promise<T[]>, pageSize: number, maxItems = 100, maxPages = 10): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const got = await fetchPage(page);
    items.push(...got);
    if (got.length < pageSize) return { items: items.slice(0, maxItems), truncated: items.length > maxItems };
    if (items.length >= maxItems) return { items: items.slice(0, maxItems), truncated: true };
  }
  return { items: items.slice(0, maxItems), truncated: true };
}

const MAX_TEXT = 50_000;
const MAX_URL = 2048;
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/** Own-property lookup of a dotted path ("status.name", "items.0.key"). Never reaches prototypes. */
export function getPath(value: unknown, dotted: string): unknown {
  let current = value;
  for (const segment of dotted.split('.')) {
    if (FORBIDDEN_SEGMENTS.has(segment)) return undefined;
    if (current === null || typeof current !== 'object') return undefined;
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return undefined;
      current = current[Number(segment)];
    } else {
      if (!Object.hasOwn(current, segment)) return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
  }
  return current;
}

/** Scalar -> cleaned string. Objects, arrays, null and empty strings are undefined. */
export function toText(value: unknown): string | undefined {
  let text: string;
  if (typeof value === 'string') text = value;
  else if (typeof value === 'number' || typeof value === 'boolean') text = String(value);
  else return undefined;
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (text === '') return undefined;
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…[truncated]` : text;
}

/** Array of scalars or `{name|label|value}` objects -> strings. Anything else is dropped. */
export function toTextList(value: unknown, max = 100): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const text =
      typeof entry === 'object' && entry !== null
        ? toText((entry as Record<string, unknown>).name ?? (entry as Record<string, unknown>).label ?? (entry as Record<string, unknown>).value)
        : toText(entry);
    if (text !== undefined) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/** http(s) URLs only; everything else (javascript:, file:, data:, relative) is dropped. */
export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (text.length === 0 || text.length > MAX_URL) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? text : undefined;
  } catch {
    return undefined;
  }
}

/** The array inside a tool result: at `listPath` when given, else the result itself. */
export function listAt(result: unknown, listPath?: string): unknown[] {
  const target = listPath ? getPath(result, listPath) : result;
  return Array.isArray(target) ? target : [];
}

/** Drop `undefined` values so payloads of different shapes normalize to deeply equal objects. */
export function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

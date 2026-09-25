import type { ApiContract } from './contract.js';

export interface ClientFile {
  path: string;
  text: string;
}

export interface UsageResult {
  used: boolean;
  methodConfirmed: boolean;
  /** Files that call the route with the contract's method. */
  files: string[];
  /** Files that mention the route but not with the contract's method. */
  pathOnlyFiles: string[];
  missingErrorCodes: string[];
}

const WINDOW = 300;
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches the contract path in client source: literal, template (`${id}`), `:id` or `{id}` segments, or `'/x/' + id`. */
function pathRegExp(path: string): RegExp {
  const parts = path.split(/\{[^}]+\}/);
  const body = parts.map(escape).join('(?:\\$\\{[^}]*\\}|:[A-Za-z_]\\w*|\\{[^}]*\\}|[\'"`]\\s*\\+[^\'"`]*)');
  const tail = path.endsWith('}') ? '' : '(?![A-Za-z0-9_-])';
  return new RegExp(`${body}${tail}`, 'g');
}

const VERBS = ['get', 'post', 'put', 'patch', 'delete'];

/** Text of the call's arguments after the path: up to the parenthesis that closes the call. */
function callScope(after: string): string {
  let depth = 0;
  for (let i = 0; i < after.length; i++) {
    if (after[i] === '(') depth++;
    else if (after[i] === ')') {
      if (depth === 0) return after.slice(0, i);
      depth--;
    }
  }
  return after;
}

/**
 * Does the call around this occurrence of the path use `method`? `before` is the text just ahead
 * of the path, `after` the text from the path on. An explicit `method: '...'` option must sit inside
 * this call's own arguments; a `.verb(` helper or a bare `fetch(` (GET) is read from `before`.
 */
function confirms(method: string, before: string, after: string): boolean {
  const explicit = callScope(after).match(/method\s*:\s*['"`]([A-Za-z]+)['"`]/);
  if (explicit) return explicit[1].toUpperCase() === method;
  const verb = VERBS.find((v) => new RegExp(`\\.${v}\\s*(?:<[^>(]*>)?\\(\\s*['"\`]?$`).test(before));
  if (verb) return verb === method.toLowerCase();
  return method === 'GET' && /\bfetch\s*\(\s*['"`]?$/.test(before);
}

/** Text evidence that a client calls the contract's route with its method, and mentions its error codes. */
export function verifyClientUsage(contract: ApiContract, files: ClientFile[]): UsageResult {
  const pathRe = pathRegExp(contract.path);
  const usedIn: string[] = [];
  const pathOnly: string[] = [];
  for (const file of files) {
    let hit = false;
    let confirmed = false;
    for (const match of file.text.matchAll(pathRe)) {
      hit = true;
      const at = match.index ?? 0;
      if (confirms(contract.method, file.text.slice(Math.max(0, at - 40), at), file.text.slice(at, at + WINDOW))) confirmed = true;
    }
    if (confirmed) usedIn.push(file.path);
    else if (hit) pathOnly.push(file.path);
  }
  const codes = [...new Set(Object.values(contract.errors).flat())];
  const missingErrorCodes = codes.filter((code) => !files.some((f) => f.text.includes(code))).sort();
  return { used: usedIn.length > 0, methodConfirmed: usedIn.length > 0, files: usedIn, pathOnlyFiles: pathOnly, missingErrorCodes };
}

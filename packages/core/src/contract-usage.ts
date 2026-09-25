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

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches the contract path in client source: literal, template (`${id}`), `:id` or `{id}` segments, or `'/x/' + id`. */
function pathRegExp(path: string): RegExp {
  const parts = path.split(/\{[^}]+\}/);
  const body = parts.map(escape).join('(?:\\$\\{[^}]*\\}|:[A-Za-z_]\\w*|\\{[^}]*\\}|[\'"`]\\s*\\+[^\'"`]*)');
  const tail = path.endsWith('}') ? '' : '(?![A-Za-z0-9_-])';
  return new RegExp(`${body}${tail}`, 'g');
}

const VERBS = ['get', 'post', 'put', 'patch', 'delete'];
const HTTP_CALLEES = new Set(['fetch', 'axios', 'usefetch', 'useswr', '$fetch', 'got', 'ky', 'request', 'http', 'api']);
const LOOKBACK = 400;
const SCOPE_MAX = 600;

interface Call {
  callee: string;
  scope: string;
  open: number;
}

function callAt(text: string, open: number): Call {
  const before = text.slice(Math.max(0, open - 60), open);
  const callee = before.match(/([A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*)\s*(?:<[^()]*?>)?\s*$/)?.[1] ?? '';
  let depth = 0;
  let end = Math.min(text.length, open + 1 + SCOPE_MAX);
  for (let i = open + 1; i < end; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      if (depth === 0) {
        end = i;
        break;
      }
      depth--;
    }
  }
  return { callee, scope: text.slice(open + 1, end), open };
}

/** The call whose argument list contains `from`, found by walking back to its unmatched "(" — or null when the position is not inside a call. */
function enclosingCall(text: string, from: number): Call | null {
  let depth = 0;
  for (let i = from - 1, steps = 0; i >= 0 && steps < LOOKBACK; i--, steps++) {
    const c = text[i];
    if (c === ')') depth++;
    else if (c === '(') {
      if (depth === 0) return callAt(text, i);
      depth--;
    } else if (depth === 0 && c === ';') return null;
    else if (depth === 0 && c === '\n') {
      let j = i - 1;
      while (j >= 0 && /\s/.test(text[j])) j--;
      if (j < 0 || (text[j] !== '(' && text[j] !== ',')) return null;
    }
  }
  return null;
}

/** true/false when this call is an HTTP call that does/does not use `method`; undefined when it is not recognizably an HTTP call. */
function decide(method: string, call: Call): boolean | undefined {
  const explicit = call.scope.match(/method\s*:\s*['"`]([A-Za-z]+)['"`]/);
  if (explicit) return explicit[1].toUpperCase() === method;
  const last = call.callee.split(/\s*\??\.\s*/).pop()!.toLowerCase();
  const verbs = VERBS.filter((v) => last === v || last.startsWith(v) || last.endsWith(v));
  if (verbs.length === 1) return verbs[0] === method.toLowerCase();
  if (HTTP_CALLEES.has(last)) return method === 'GET';
  return undefined;
}

/** Is the path at `at` an argument of a call that uses `method`? Looks outward through helper calls (buildUrl(...)) a few levels. */
function confirmsAt(text: string, at: number, method: string): boolean {
  let from = at;
  for (let level = 0; level < 3; level++) {
    const call = enclosingCall(text, from);
    if (!call) return false;
    const decided = decide(method, call);
    if (decided !== undefined) return decided;
    from = call.open;
  }
  return false;
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
      if (confirmsAt(file.text, match.index ?? 0, contract.method)) {
        confirmed = true;
        break;
      }
    }
    if (confirmed) usedIn.push(file.path);
    else if (hit) pathOnly.push(file.path);
  }
  const codes = [...new Set(Object.values(contract.errors).flat())];
  const missingErrorCodes = codes.filter((code) => !files.some((f) => f.text.includes(code))).sort();
  return { used: usedIn.length > 0, methodConfirmed: usedIn.length > 0, files: usedIn, pathOnlyFiles: pathOnly, missingErrorCodes };
}

import type { ApiContract } from './contract.js';

export interface ClientFile {
  path: string;
  text: string;
}

export interface UsageResult {
  used: boolean;
  methodConfirmed: boolean;
  files: string[];
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

function confirms(method: string, near: string): boolean {
  const explicit = near.match(/method\s*:\s*['"`]([A-Za-z]+)['"`]/);
  if (explicit) return explicit[1].toUpperCase() === method;
  const lower = method.toLowerCase();
  if (new RegExp(`\\.${lower}\\s*(?:<[^>(]*>)?\\(`).test(near)) return true;
  return method === 'GET' && /\bfetch\s*\(/.test(near);
}

/** Text evidence that a client calls the contract's route, with its method, and mentions its error codes. */
export function verifyClientUsage(contract: ApiContract, files: ClientFile[]): UsageResult {
  const pathRe = pathRegExp(contract.path);
  const usedIn: string[] = [];
  let methodConfirmed = false;
  for (const file of files) {
    let hit = false;
    for (const match of file.text.matchAll(pathRe)) {
      hit = true;
      const start = Math.max(0, (match.index ?? 0) - 80);
      if (confirms(contract.method, file.text.slice(start, (match.index ?? 0) + WINDOW))) methodConfirmed = true;
    }
    if (hit) usedIn.push(file.path);
  }
  const allText = files.map((f) => f.text).join('\n');
  const codes = Object.values(contract.errors).flat();
  return { used: usedIn.length > 0, methodConfirmed, files: usedIn, missingErrorCodes: [...new Set(codes)].filter((code) => !allText.includes(code)).sort() };
}

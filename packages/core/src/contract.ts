import { assertWorkItemKey, type TaskDirs } from './ledger.js';
import { safeReadFile, safeWriteFile } from './safe-fs.js';

export const CONTRACT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type ContractMethod = (typeof CONTRACT_METHODS)[number];
export type ContractType = string | { [field: string]: ContractType };

export interface ApiContract {
  method: ContractMethod;
  path: string;
  request?: Record<string, ContractType>;
  response: Record<string, ContractType>;
  errors: Record<string, string[]>;
  successStatus?: number;
}

const TYPE_RE = /^(?:string|uuid|email|integer|number|boolean|datetime|date|object|any)(?:\[\])?\??$/;
const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const PATH_RE = /^\/[A-Za-z0-9._~\-/{}:@%]*$/;
const PARAM_RE = /\{[A-Za-z_][A-Za-z0-9_]*\}/g;
const FORBIDDEN_FIELDS = new Set(['__proto__', 'constructor', 'prototype']);
const TOP_KEYS = new Set(['method', 'path', 'request', 'response', 'errors', 'successStatus']);
const MAX_DEPTH = 4;
const MAX_FIELDS = 100;
const MAX_CODES = 50;

function fail(label: string, where: string, message: string): never {
  throw new Error(`${label}: ${where} ${message}`);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function parseFields(label: string, where: string, raw: unknown, depth: number): Record<string, ContractType> {
  if (!isRecord(raw)) fail(label, where, 'must be an object of field names to types');
  if (depth > MAX_DEPTH) fail(label, where, `is nested too deeply (max ${MAX_DEPTH} levels)`);
  const entries = Object.entries(raw);
  if (entries.length > MAX_FIELDS) fail(label, where, `has too many fields (max ${MAX_FIELDS})`);
  return Object.fromEntries(
    entries.map(([name, value]): [string, ContractType] => {
      const at = `${where}.${name}`;
      if (!FIELD_RE.test(name) || FORBIDDEN_FIELDS.has(name)) fail(label, where, `has an invalid field name "${name.slice(0, 40)}"`);
      if (typeof value === 'string') {
        if (!TYPE_RE.test(value)) fail(label, at, `has an invalid type "${value.slice(0, 40)}" (use string, uuid, email, integer, number, boolean, datetime, date, object or any; add ? for optional or [] for arrays)`);
        return [name, value];
      }
      if (isRecord(value)) return [name, parseFields(label, at, value, depth + 1)];
      return fail(label, at, 'must be a type string or a nested object');
    })
  );
}

function parsePath(label: string, value: unknown): string {
  if (typeof value !== 'string' || !PATH_RE.test(value) || value.includes('..') || value.includes('//') || /[{}]/.test(value.replace(PARAM_RE, ''))) {
    fail(label, 'path', 'must be an absolute path such as "/api/users/{id}" (no query string, "..", "//" or malformed {params})');
  }
  return value;
}

export function parseContract(input: unknown, label = 'contract'): ApiContract {
  let raw = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (error) {
      throw new Error(`${label}: invalid JSON (${(error as Error).message.split('\n')[0]})`);
    }
  }
  if (!isRecord(raw)) fail(label, 'the file', 'must be a JSON object');
  for (const key of Object.keys(raw)) if (!TOP_KEYS.has(key)) fail(label, key, 'is not a recognized setting');

  if (typeof raw.method !== 'string' || !(CONTRACT_METHODS as readonly string[]).includes(raw.method)) {
    fail(label, 'method', `must be one of ${CONTRACT_METHODS.join(', ')} (uppercase)`);
  }
  const contract: ApiContract = {
    method: raw.method as ContractMethod,
    path: parsePath(label, raw.path),
    response: raw.response === undefined ? fail(label, 'response', 'is required (use {} for an empty body)') : parseFields(label, 'response', raw.response, 1),
    errors: {}
  };
  if (raw.request !== undefined) contract.request = parseFields(label, 'request', raw.request, 1);

  if (!isRecord(raw.errors)) fail(label, 'errors', 'is required and must map status codes to error code lists (use {} for none)');
  contract.errors = Object.fromEntries(
    Object.entries(raw.errors).map(([status, codes]): [string, string[]] => {
      const at = `errors.${status}`;
      if (!/^[45]\d\d$/.test(status)) fail(label, 'errors', `has an invalid status "${status.slice(0, 10)}" (use 4xx or 5xx)`);
      if (!Array.isArray(codes) || codes.length === 0 || codes.length > MAX_CODES) fail(label, at, `must be a non-empty list of at most ${MAX_CODES} error codes`);
      if (codes.some((c) => typeof c !== 'string' || !CODE_RE.test(c))) fail(label, at, 'has an invalid error code (use UPPER_SNAKE_CASE)');
      if (new Set(codes).size !== codes.length) fail(label, at, 'lists the same error code twice');
      return [status, codes as string[]];
    })
  );
  if (raw.successStatus !== undefined) {
    if (!Number.isInteger(raw.successStatus) || (raw.successStatus as number) < 200 || (raw.successStatus as number) > 299) fail(label, 'successStatus', 'must be an integer from 200 to 299');
    contract.successStatus = raw.successStatus as number;
  }
  return contract;
}

export function contractPath(dirs: TaskDirs, key: string): string {
  assertWorkItemKey(key);
  return `${dirs.taskDocsDir}/${key}.contract.json`;
}

export function writeContract(root: string, dirs: TaskDirs, key: string, contract: unknown): ApiContract {
  const parsed = parseContract(contract);
  safeWriteFile(root, contractPath(dirs, key), `${JSON.stringify(parsed, null, 2)}\n`);
  return parsed;
}

export function readContract(root: string, dirs: TaskDirs, key: string): ApiContract | null {
  const text = safeReadFile(root, contractPath(dirs, key));
  return text === null ? null : parseContract(text, `${key}.contract.json`);
}

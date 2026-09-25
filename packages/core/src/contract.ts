import { assertWorkItemKey, type TaskDirs } from './ledger.js';
import { safeReadFile, safeWriteFile } from './safe-fs.js';

export const CONTRACT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type ContractMethod = (typeof CONTRACT_METHODS)[number];
/** A string is a primitive (with optional `?` / `[]`), a one-element array is an array of that type, an object nests fields. */
export type ContractType = string | ContractType[] | { [field: string]: ContractType };
export type ContractBody = Record<string, ContractType> | [ContractType];

export interface ApiContract {
  method: ContractMethod;
  path: string;
  request?: ContractBody;
  response: ContractBody;
  errors: Record<string, string[]>;
  successStatus?: number;
  /** Workspace that serves the route, when the project has several. */
  producer?: string;
  /** Workspaces that call the route. */
  consumers?: string[];
}

const TYPE_RE = /^(?:string|uuid|email|integer|number|boolean|datetime|date|object|any)(?:\[\])?\??$/;
const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const PATH_RE = /^\/[A-Za-z0-9._~\-/{}:@%]*$/;
const PARAM_RE = /\{[A-Za-z_][A-Za-z0-9_]*\}/g;
const FORBIDDEN_FIELDS = new Set(['__proto__', 'constructor', 'prototype']);
const TOP_KEYS = new Set(['method', 'path', 'request', 'response', 'errors', 'successStatus', 'producer', 'consumers']);
const WORKSPACE_NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;
const MAX_CONSUMERS = 10;
const MAX_DEPTH = 4;
const MAX_FIELDS = 100;
const MAX_CODES = 50;

function fail(label: string, where: string, message: string): never {
  throw new Error(`${label}: ${where} ${message}`);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** `profile?` -> `profile`. Only one trailing `?` is meaningful. */
export const fieldName = (key: string): string => (key.endsWith('?') ? key.slice(0, -1) : key);

/** A field is optional when its key ends in `?` or its string type does. */
export const isOptionalField = (key: string, type: ContractType): boolean => key.endsWith('?') || (typeof type === 'string' && type.endsWith('?'));

function parseType(label: string, at: string, value: unknown, depth: number): ContractType {
  if (typeof value === 'string') {
    if (!TYPE_RE.test(value)) fail(label, at, `has an invalid type "${value.slice(0, 40)}" (use string, uuid, email, integer, number, boolean, datetime, date, object or any; add ? for optional or [] for arrays)`);
    return value;
  }
  if (Array.isArray(value)) {
    if (depth > MAX_DEPTH) fail(label, at, `is nested too deeply (max ${MAX_DEPTH} levels)`);
    if (value.length !== 1) fail(label, at, 'must hold exactly one element type, for example ["uuid"] or [{ "id": "uuid" }]');
    return [parseType(label, `${at}[]`, value[0], depth + 1)];
  }
  if (isRecord(value)) return parseFields(label, at, value, depth + 1);
  return fail(label, at, 'must be a type string, a one-element array or a nested object');
}

function parseFields(label: string, where: string, raw: unknown, depth: number): Record<string, ContractType> {
  if (!isRecord(raw)) fail(label, where, 'must be an object of field names to types');
  if (depth > MAX_DEPTH) fail(label, where, `is nested too deeply (max ${MAX_DEPTH} levels)`);
  const entries = Object.entries(raw);
  if (entries.length > MAX_FIELDS) fail(label, where, `has too many fields (max ${MAX_FIELDS})`);
  const seen = new Set<string>();
  return Object.fromEntries(
    entries.map(([key, value]): [string, ContractType] => {
      const name = fieldName(key);
      const at = `${where}.${name}`;
      if (!FIELD_RE.test(name) || FORBIDDEN_FIELDS.has(name)) fail(label, where, `has an invalid field name "${key.slice(0, 40)}"`);
      if (seen.has(name)) fail(label, where, `lists "${name}" twice (with and without ?)`);
      seen.add(name);
      return [key, parseType(label, at, value, depth)];
    })
  );
}

/** A request or response body: a fields object, or a one-element array meaning "an array of that". */
function parseBody(label: string, where: string, raw: unknown): ContractBody {
  if (Array.isArray(raw)) return parseType(label, where, raw, 1) as [ContractType];
  return parseFields(label, where, raw, 1);
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
    response: raw.response === undefined ? fail(label, 'response', 'is required (use {} for an empty body)') : parseBody(label, 'response', raw.response),
    errors: {}
  };
  if (raw.request !== undefined) contract.request = parseBody(label, 'request', raw.request);

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
  if (raw.producer !== undefined) {
    if (typeof raw.producer !== 'string' || !WORKSPACE_NAME_RE.test(raw.producer)) fail(label, 'producer', 'must be a workspace name such as "cloud-back"');
    contract.producer = raw.producer;
  }
  if (raw.consumers !== undefined) {
    if (!Array.isArray(raw.consumers)) fail(label, 'consumers', 'must be a list of workspace names');
    if (raw.consumers.length > MAX_CONSUMERS) fail(label, 'consumers', `may list at most ${MAX_CONSUMERS} workspaces`);
    if (raw.consumers.some((c) => typeof c !== 'string' || !WORKSPACE_NAME_RE.test(c))) fail(label, 'consumers', 'must contain only workspace names such as "edge-back"');
    if (new Set(raw.consumers).size !== raw.consumers.length) fail(label, 'consumers', 'lists the same workspace twice');
    if (contract.producer !== undefined && raw.consumers.includes(contract.producer)) fail(label, 'consumers', 'must not include the producer');
    contract.consumers = raw.consumers as string[];
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

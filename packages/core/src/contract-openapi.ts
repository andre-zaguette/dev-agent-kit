import { parse } from 'yaml';
import { fieldName, isOptionalField, type ApiContract, type ContractType } from './contract.js';
import type { VerifyResult, Violation } from './contract-verify.js';

type Json = Record<string, unknown>;

const MAX_REF_HOPS = 10;
const MAX_ALLOF_DEPTH = 8;
const MAX_NODES = 20_000;
const MAX_PATH_KEY = 2048;

// Work budget for one verifyOpenApi call: a schema graph that fans out (allOf bombs) is cut off, not expanded.
let nodesLeft = 0;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseOpenApiText(text: string): unknown {
  try {
    return parse(text);
  } catch (error) {
    throw new Error(`the OpenAPI description is not valid JSON or YAML (${(error as Error).message.split('\n')[0]})`);
  }
}

function resolveRef(doc: Json, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  let current: unknown = doc;
  for (const part of ref.slice(2).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isRecord(current) || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

/** Follow local $refs (bounded), returning the first non-$ref object. */
function deref(doc: Json, value: unknown): Json | undefined {
  let current = value;
  for (let hop = 0; hop < MAX_REF_HOPS; hop++) {
    if (!isRecord(current)) return undefined;
    if (typeof current.$ref !== 'string') return current;
    current = resolveRef(doc, current.$ref);
  }
  return undefined;
}

/** Deref, then merge allOf branches into one schema (bounded). */
function flatten(doc: Json, schema: unknown, depth = 0): Json | undefined {
  if (depth > MAX_ALLOF_DEPTH || --nodesLeft < 0) return undefined;
  const base = deref(doc, schema);
  if (!base) return undefined;
  const properties: Json = Object.create(null);
  const required = new Set<string>();
  const parts = Array.isArray(base.allOf) ? base.allOf.map((s) => flatten(doc, s, depth + 1)).filter((s): s is Json => s !== undefined) : [];
  for (const part of [...parts, base]) {
    if (isRecord(part.properties)) for (const [name, value] of Object.entries(part.properties)) properties[name] = value;
    if (Array.isArray(part.required)) for (const name of part.required) if (typeof name === 'string') required.add(name);
  }
  return { ...base, properties, required: [...required] };
}

/** A nullable `anyOf`/`oneOf` (one real branch plus null) is that branch. */
function unwrap(doc: Json, schema: unknown): Json | undefined {
  const flat = flatten(doc, schema);
  if (!flat) return undefined;
  for (const key of ['anyOf', 'oneOf']) {
    const branches = flat[key];
    if (Array.isArray(branches)) {
      const real = branches.filter((b) => !(isRecord(b) && b.type === 'null'));
      if (real.length === 1) return flatten(doc, real[0]);
    }
  }
  return flat;
}

function typeOf(schema: Json): string | undefined {
  if (Array.isArray(schema.type)) {
    const real = schema.type.filter((t) => t !== 'null');
    return real.length === 1 && typeof real[0] === 'string' ? real[0] : undefined;
  }
  return typeof schema.type === 'string' ? schema.type : undefined;
}

const push = (out: Violation[], where: 'request' | 'response', kind: Violation['kind'], severity: Violation['severity'], field: string | undefined, message: string) =>
  out.push({ where, kind, severity, field, message });

function typeCheck(doc: Json, type: ContractType, schema: unknown, where: 'request' | 'response', field: string, out: Violation[]): void {
  const s = unwrap(doc, schema);
  if (!s) {
    push(out, where, 'type', 'error', field, `${field}: the schema could not be resolved (dangling $ref, cycle or too complex)`);
    return;
  }
  const kind = typeOf(s);
  if (Array.isArray(type)) {
    if (kind !== 'array') push(out, where, 'type', 'error', field || undefined, `${field || 'body'}: expected an array schema`);
    else typeCheck(doc, type[0], s.items, where, `${field}[]`, out);
    return;
  }
  if (typeof type !== 'string') {
    if (kind !== 'object' && Object.keys(s.properties as Json).length === 0) push(out, where, 'type', 'error', field, `${field}: expected an object schema`);
    else compareFields(doc, type, s, where, field, out);
    return;
  }
  const base = type.endsWith('?') ? type.slice(0, -1) : type;
  if (base.endsWith('[]')) {
    if (kind !== 'array') push(out, where, 'type', 'error', field, `${field}: expected an array schema`);
    else typeCheck(doc, base.slice(0, -2), s.items, where, `${field}[]`, out);
    return;
  }
  const format = typeof s.format === 'string' ? s.format : undefined;
  const expect = (ok: boolean, what: string): boolean => {
    if (!ok) push(out, where, 'type', 'error', field, `${field}: expected ${what}, the description says ${String(kind ?? 'nothing')}`);
    return ok;
  };
  const wantFormat = (want: string) => {
    if (format === undefined) push(out, where, 'type', 'warning', field, `${field}: the description has no format "${want}"`);
    else if (format !== want) push(out, where, 'type', 'error', field, `${field}: format is "${format}", expected "${want}"`);
  };
  switch (base) {
    case 'string':
      expect(kind === 'string', 'a string');
      return;
    case 'uuid':
      if (expect(kind === 'string', 'a string')) wantFormat('uuid');
      return;
    case 'email':
      if (expect(kind === 'string', 'a string')) wantFormat('email');
      return;
    case 'datetime':
      if (expect(kind === 'string', 'a string')) wantFormat('date-time');
      return;
    case 'date':
      if (expect(kind === 'string', 'a string')) wantFormat('date');
      return;
    case 'integer':
      expect(kind === 'integer', 'an integer');
      return;
    case 'number':
      expect(kind === 'number' || kind === 'integer', 'a number');
      return;
    case 'boolean':
      expect(kind === 'boolean', 'a boolean');
      return;
    case 'object':
      expect(kind === 'object' || Object.keys(s.properties as Json).length > 0, 'an object');
      return;
    default:
      return; // any
  }
}

function compareFields(doc: Json, fields: Record<string, ContractType>, schema: Json, where: 'request' | 'response', prefix: string, out: Violation[]): void {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const names = new Set<string>();
  for (const [key, type] of Object.entries(fields)) {
    const name = fieldName(key);
    names.add(name);
    const field = prefix ? `${prefix}.${name}` : name;
    if (!Object.hasOwn(properties, name)) {
      push(out, where, 'missing', 'error', field, `${field}: not described in the OpenAPI schema`);
      continue;
    }
    typeCheck(doc, type, properties[name], where, field, out);
    if (!isOptionalField(key, type) && !required.has(name)) push(out, where, 'missing', 'warning', field, `${field}: required in the contract but optional in the description`);
  }
  for (const name of Object.keys(properties)) {
    if (!names.has(name)) push(out, where, 'unexpected', 'warning', prefix ? `${prefix}.${name}` : name, `${prefix ? `${prefix}.` : ''}${name}: described but not in the contract`);
  }
}

const normalize = (path: string): string => (path.length > MAX_PATH_KEY ? path : path.replace(/\{[^}]+\}/g, '{}').replace(/\/+$/, '') || '/');

function jsonSchemaOf(doc: Json, holder: unknown): unknown {
  const content = deref(doc, holder)?.content;
  if (!isRecord(content)) return undefined;
  const key = Object.keys(content).find((k) => k === 'application/json') ?? Object.keys(content).find((k) => k.includes('json'));
  return key && isRecord(content[key]) ? (content[key] as Json).schema : undefined;
}

export function verifyOpenApi(contract: ApiContract, doc: unknown): VerifyResult {
  nodesLeft = MAX_NODES;
  const violations: Violation[] = [];
  const finish = (): VerifyResult => ({ ok: !violations.some((v) => v.severity === 'error'), violations });
  const routeError = (message: string): VerifyResult => {
    violations.push({ where: 'route', kind: 'route', severity: 'error', message });
    return finish();
  };
  if (!isRecord(doc) || !isRecord(doc.paths)) return routeError('not an OpenAPI document (no "paths")');

  const wanted = normalize(contract.path);
  const key = Object.keys(doc.paths).find((p) => normalize(p) === wanted);
  const item = key === undefined ? undefined : doc.paths[key];
  const op = isRecord(item) && isRecord(item[contract.method.toLowerCase()]) ? (item[contract.method.toLowerCase()] as Json) : undefined;
  if (!op) return routeError(`${contract.method} ${contract.path} is not described`);

  if (contract.request) {
    const schema = jsonSchemaOf(doc, op.requestBody);
    if (schema === undefined) push(violations, 'request', 'missing', 'error', undefined, 'the operation describes no JSON request body');
    else {
      const flat = flatten(doc, schema);
      if (Array.isArray(contract.request)) typeCheck(doc, contract.request, schema, 'request', '', violations);
      else if (flat) compareFields(doc, contract.request, flat, 'request', '', violations);
      else push(violations, 'request', 'type', Array.isArray(contract.request) || Object.keys(contract.request).length > 0 ? 'error' : 'warning', undefined, 'the request schema could not be resolved (dangling $ref, cycle or too complex)');
    }
  }

  const responses = isRecord(op.responses) ? op.responses : {};
  const successKey = contract.successStatus !== undefined ? String(contract.successStatus) : Object.keys(responses).find((k) => /^2\d\d$/.test(k));
  if (successKey === undefined || !Object.hasOwn(responses, successKey)) {
    violations.push({ where: 'status', kind: 'status', severity: 'error', message: `no ${contract.successStatus ?? '2xx'} response is described` });
  } else {
    const schema = jsonSchemaOf(doc, responses[successKey]);
    if (schema === undefined) {
      if (Array.isArray(contract.response) || Object.keys(contract.response).length > 0) push(violations, 'response', 'missing', 'error', undefined, `the ${successKey} response describes no JSON body`);
    } else {
      const flat = flatten(doc, schema);
      if (Array.isArray(contract.response)) typeCheck(doc, contract.response, schema, 'response', '', violations);
      else if (flat) compareFields(doc, contract.response, flat, 'response', '', violations);
      else push(violations, 'response', 'type', Array.isArray(contract.response) || Object.keys(contract.response).length > 0 ? 'error' : 'warning', undefined, 'the response schema could not be resolved (dangling $ref, cycle or too complex)');
    }
  }

  for (const status of Object.keys(contract.errors)) {
    if (!Object.hasOwn(responses, status) && !Object.hasOwn(responses, 'default')) {
      violations.push({ where: 'status', kind: 'status', severity: 'error', message: `error status ${status} is declared in the contract but not described` });
    }
  }
  return finish();
}

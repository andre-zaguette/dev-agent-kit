import type { ApiContract, ContractType } from './contract.js';

export interface Exchange {
  method: string;
  path: string;
  requestBody?: unknown;
  status: number;
  responseBody?: unknown;
}

export interface Violation {
  where: 'route' | 'request' | 'response' | 'status';
  field?: string;
  kind: 'route' | 'missing' | 'type' | 'unexpected' | 'status' | 'error-code';
  severity: 'error' | 'warning';
  message: string;
}

export interface VerifyResult {
  ok: boolean;
  violations: Violation[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

export function matchesPrimitive(value: unknown, primitive: string): boolean {
  switch (primitive) {
    case 'string':
      return typeof value === 'string';
    case 'uuid':
      return typeof value === 'string' && UUID_RE.test(value);
    case 'email':
      return typeof value === 'string' && EMAIL_RE.test(value);
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'datetime':
      return typeof value === 'string' && DATETIME_RE.test(value);
    case 'date':
      return typeof value === 'string' && DATE_RE.test(value);
    case 'object':
      return isRecord(value);
    case 'any':
      return true;
    default:
      return false;
  }
}

/** The error code of a response body: `code`, `error.code` or `detail.code`. */
export function extractErrorCode(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  if (typeof body.code === 'string') return body.code;
  for (const key of ['error', 'detail']) {
    const inner = body[key];
    if (isRecord(inner) && typeof inner.code === 'string') return inner.code;
  }
  return undefined;
}

type Where = 'request' | 'response';

function checkValue(type: ContractType, value: unknown, where: Where, field: string, out: Violation[]): void {
  if (typeof type !== 'string') {
    checkObject(type, value, where, field, out);
    return;
  }
  const optional = type.endsWith('?');
  const base = optional ? type.slice(0, -1) : type;
  if (value === null && optional) return;
  if (base.endsWith('[]')) {
    const item = base.slice(0, -2);
    if (!Array.isArray(value)) {
      out.push({ where, field, kind: 'type', severity: 'error', message: `${field}: expected an array of ${item}, got ${describe(value)}` });
      return;
    }
    const badIndex = value.findIndex((v) => !matchesPrimitive(v, item));
    if (badIndex >= 0) out.push({ where, field, kind: 'type', severity: 'error', message: `${field}[${badIndex}]: expected ${item}, got ${describe(value[badIndex])}` });
    return;
  }
  if (!matchesPrimitive(value, base)) out.push({ where, field, kind: 'type', severity: 'error', message: `${field}: expected ${base}, got ${describe(value)}` });
}

function checkObject(schema: Record<string, ContractType>, value: unknown, where: Where, prefix: string, out: Violation[]): void {
  if (!isRecord(value)) {
    out.push({ where, field: prefix || undefined, kind: 'type', severity: 'error', message: `${prefix || 'body'}: expected an object, got ${describe(value)}` });
    return;
  }
  for (const [name, type] of Object.entries(schema)) {
    const field = prefix ? `${prefix}.${name}` : name;
    const present = Object.hasOwn(value, name) && value[name] !== undefined;
    if (!present) {
      const optional = typeof type === 'string' && type.endsWith('?');
      if (!optional) out.push({ where, field, kind: 'missing', severity: 'error', message: `${field}: required field is missing` });
      continue;
    }
    checkValue(type, value[name], where, field, out);
  }
  for (const name of Object.keys(value)) {
    if (!Object.hasOwn(schema, name)) {
      const field = prefix ? `${prefix}.${name}` : name;
      out.push({ where, field, kind: 'unexpected', severity: 'warning', message: `${field}: not in the contract` });
    }
  }
}

function routeRegExp(template: string): RegExp {
  const source = template
    .split(/\{[^}]+\}/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]+');
  return new RegExp(`^${source}/?$`);
}

export function verifyExchange(contract: ApiContract, exchange: Exchange): VerifyResult {
  const violations: Violation[] = [];
  const finish = (): VerifyResult => ({ ok: !violations.some((v) => v.severity === 'error'), violations });

  const path = exchange.path.split(/[?#]/)[0];
  if (exchange.method.toUpperCase() !== contract.method || !routeRegExp(contract.path).test(path)) {
    violations.push({ where: 'route', kind: 'route', severity: 'error', message: `expected ${contract.method} ${contract.path}, got ${exchange.method.toUpperCase()} ${path}` });
    return finish();
  }

  if (contract.request) checkObject(contract.request, exchange.requestBody ?? {}, 'request', '', violations);

  const status = exchange.status;
  if (status >= 200 && status < 300) {
    if (contract.successStatus !== undefined && status !== contract.successStatus) {
      violations.push({ where: 'status', kind: 'status', severity: 'error', message: `expected status ${contract.successStatus}, got ${status}` });
    }
    checkObject(contract.response, exchange.responseBody, 'response', '', violations);
    return finish();
  }

  const listed = Object.hasOwn(contract.errors, String(status)) ? contract.errors[String(status)] : undefined;
  if (!listed) {
    violations.push({ where: 'status', kind: 'status', severity: 'error', message: `status ${status} is not a declared success or error status` });
    return finish();
  }
  const code = extractErrorCode(exchange.responseBody);
  if (code === undefined) {
    violations.push({ where: 'response', kind: 'error-code', severity: 'error', message: `status ${status}: no error code found in the body (expected one of ${listed.join(', ')})` });
  } else if (!listed.includes(code)) {
    violations.push({ where: 'response', kind: 'error-code', severity: 'error', message: `status ${status}: error code ${code} is not declared (expected one of ${listed.join(', ')})` });
  }
  return finish();
}

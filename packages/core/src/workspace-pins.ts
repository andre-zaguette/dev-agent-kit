import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { resolveInside } from './safe-fs.js';
import { orderWorkspaces, workspaceRoot, type WorkspaceConfig } from './workspaces.js';

const MAX_MANIFEST_BYTES = 1024 * 1024;
const DIRECT = '@direct';

export interface PackageInfo {
  name: string;
  version?: string;
  dependencies: Record<string, string>;
}

export type PinStatus = 'ok' | 'behind' | 'ahead' | 'unknown' | 'not-declared';

export interface PinReport {
  dependent: string;
  dependency: string;
  status: PinStatus;
  constraint?: string;
  version?: string;
  note?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** PEP 503 style: lowercase, runs of "-", "_" and "." collapse to one "-". */
function normalizeName(name: string): string {
  let out = '';
  let lastSeparator = false;
  for (const ch of name.toLowerCase()) {
    const separator = ch === '-' || ch === '_' || ch === '.';
    if (separator) {
      if (!lastSeparator) out += '-';
    } else {
      out += ch;
    }
    lastSeparator = separator;
  }
  return out;
}

function readBounded(dir: string, file: string): string | null {
  try {
    const target = resolveInside(dir, file);
    const stat = statSync(target);
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) return null;
    return readFileSync(target, 'utf8');
  } catch {
    return null;
  }
}

const isNameChar = (ch: string): boolean => /^[A-Za-z0-9._-]$/.test(ch);

/** "models[extra]>=1.0" -> { name: "models", constraint: ">=1.0" }; a direct reference (`name @ url`) never keeps the url. */
function splitRequirement(spec: string): { name: string; constraint: string } | null {
  const text = spec.trim();
  let i = 0;
  while (i < text.length && isNameChar(text[i])) i++;
  if (i === 0) return null;
  const name = normalizeName(text.slice(0, i));
  let rest = text.slice(i).trimStart();
  if (rest.startsWith('[')) {
    const close = rest.indexOf(']');
    if (close === -1) return { name, constraint: DIRECT };
    rest = rest.slice(close + 1).trimStart();
  }
  if (rest.startsWith('@')) return { name, constraint: DIRECT };
  const marker = rest.indexOf(';');
  if (marker !== -1) return { name, constraint: `${rest.slice(0, marker).replace(/\s+/g, '')};marker` };
  return { name, constraint: rest.replace(/\s+/g, '') };
}

function poetryConstraint(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (isRecord(value) && typeof value.version === 'string' && value.git === undefined && value.path === undefined && value.url === undefined) return value.version.trim();
  return DIRECT;
}

function fromPyproject(text: string): PackageInfo | null {
  let doc: Record<string, unknown>;
  try {
    doc = parseToml(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const project = doc.project;
  if (isRecord(project) && typeof project.name === 'string') {
    const dependencies: Record<string, string> = {};
    if (Array.isArray(project.dependencies)) {
      for (const spec of project.dependencies) {
        if (typeof spec !== 'string') continue;
        const req = splitRequirement(spec);
        if (req) dependencies[req.name] = req.constraint;
      }
    }
    return { name: normalizeName(project.name), version: typeof project.version === 'string' ? project.version : undefined, dependencies };
  }
  const tool = doc.tool;
  const poetry = isRecord(tool) ? tool.poetry : undefined;
  if (isRecord(poetry) && typeof poetry.name === 'string') {
    const dependencies: Record<string, string> = {};
    if (isRecord(poetry.dependencies)) {
      for (const [name, value] of Object.entries(poetry.dependencies)) dependencies[normalizeName(name)] = poetryConstraint(value);
    }
    return { name: normalizeName(poetry.name), version: typeof poetry.version === 'string' ? poetry.version : undefined, dependencies };
  }
  return null;
}

function fromPackageJson(text: string): PackageInfo | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(doc) || typeof doc.name !== 'string') return null;
  const dependencies: Record<string, string> = {};
  for (const section of ['devDependencies', 'peerDependencies', 'dependencies']) {
    const block = doc[section];
    if (!isRecord(block)) continue;
    for (const [name, value] of Object.entries(block)) {
      if (typeof value !== 'string') continue;
      const constraint = value.trim();
      dependencies[normalizeName(name)] = constraint.includes(':') || constraint.includes('/') ? DIRECT : constraint;
    }
  }
  return { name: normalizeName(doc.name), version: typeof doc.version === 'string' ? doc.version : undefined, dependencies };
}

/** pyproject.toml ([project] or [tool.poetry]) first, then package.json; null when neither is readable. */
export function readPackageInfo(dir: string): PackageInfo | null {
  const py = readBounded(dir, 'pyproject.toml');
  if (py !== null) {
    const info = fromPyproject(py);
    if (info) return info;
  }
  const js = readBounded(dir, 'package.json');
  return js === null ? null : fromPackageJson(js);
}

type Version = [number, number, number];

function parseVersion(text: string): Version | null {
  const parts = text.split('.');
  if (parts.length < 1 || parts.length > 3) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (part === '' || part.length > 9 || [...part].some((ch) => ch < '0' || ch > '9')) return null;
    nums.push(Number(part));
  }
  while (nums.length < 3) nums.push(0);
  return nums as Version;
}

function compare(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

interface Range {
  lower?: Version;
  upper?: Version; // exclusive
  exact?: Version;
}

function parseConstraint(text: string): Range | null {
  const number = (s: string): Version | null => parseVersion(s);
  if (text.startsWith('>=')) {
    const v = number(text.slice(2));
    return v && { lower: v };
  }
  if (text.startsWith('==')) {
    const v = number(text.slice(2));
    return v && { exact: v };
  }
  if (text.startsWith('~=')) {
    const raw = text.slice(2);
    const v = number(raw);
    if (!v) return null;
    return raw.split('.').length >= 3 ? { lower: v, upper: [v[0], v[1] + 1, 0] } : { lower: v, upper: [v[0] + 1, 0, 0] };
  }
  if (text.startsWith('^')) {
    const v = number(text.slice(1));
    if (!v) return null;
    const upper: Version = v[0] > 0 ? [v[0] + 1, 0, 0] : v[1] > 0 ? [0, v[1] + 1, 0] : [0, 0, v[2] + 1];
    return { lower: v, upper };
  }
  if (text.startsWith('~')) {
    const v = number(text.slice(1));
    return v && { lower: v, upper: [v[0], v[1] + 1, 0] };
  }
  const v = number(text);
  return v && { exact: v };
}

function evaluate(range: Range, version: Version): 'ok' | 'behind' | 'ahead' {
  if (range.exact) {
    const c = compare(version, range.exact);
    return c === 0 ? 'ok' : c > 0 ? 'behind' : 'ahead';
  }
  if (range.lower && compare(version, range.lower) < 0) return 'ahead';
  if (range.upper && compare(version, range.upper) >= 0) return 'behind';
  return 'ok';
}

const NO_MANIFEST = 'no readable manifest (pyproject.toml or package.json missing, oversized or malformed)';

/** One row per `dependsOn` edge, in dependency order. Checks the pin; never changes anything. */
export function checkPins(root: string, workspaces: WorkspaceConfig[]): PinReport[] {
  const cache = new Map<string, PackageInfo | null | { error: string }>();
  const load = (ws: WorkspaceConfig): PackageInfo | null | { error: string } => {
    if (!cache.has(ws.name)) {
      try {
        cache.set(ws.name, readPackageInfo(workspaceRoot(root, ws)));
      } catch (error) {
        cache.set(ws.name, { error: (error as Error).message });
      }
    }
    return cache.get(ws.name)!;
  };
  const byName = new Map(workspaces.map((w) => [w.name, w]));
  const rows: PinReport[] = [];
  for (const ws of orderWorkspaces({ workspaces })) {
    for (const depName of ws.dependsOn) {
      const base = { dependent: ws.name, dependency: depName };
      const dependent = load(ws);
      const dependency = load(byName.get(depName)!);
      if (dependency === null) {
        rows.push({ ...base, status: 'unknown', note: `${depName}: ${NO_MANIFEST}` });
        continue;
      }
      if ('error' in dependency) {
        rows.push({ ...base, status: 'unknown', note: dependency.error });
        continue;
      }
      if (dependent === null) {
        rows.push({ ...base, status: 'unknown', note: `${ws.name}: ${NO_MANIFEST}` });
        continue;
      }
      if ('error' in dependent) {
        rows.push({ ...base, status: 'unknown', note: dependent.error });
        continue;
      }
      const raw = dependent.dependencies[dependency.name];
      if (raw === undefined) {
        rows.push({ ...base, status: 'not-declared', note: `${ws.name} does not declare ${dependency.name}` });
        continue;
      }
      const version = dependency.version;
      const withVersion = { ...base, ...(version ? { version } : {}) };
      if (raw === DIRECT) {
        rows.push({ ...withVersion, status: 'unknown', note: 'direct reference (url, path or git), not compared' });
        continue;
      }
      if (raw.endsWith(';marker')) {
        rows.push({ ...withVersion, status: 'unknown', constraint: raw.slice(0, -';marker'.length) || undefined, note: 'environment marker, not evaluated' });
        continue;
      }
      if (raw === '') {
        rows.push({ ...withVersion, status: 'unknown', note: 'no version constraint declared' });
        continue;
      }
      const range = parseConstraint(raw);
      if (!range) {
        rows.push({ ...withVersion, status: 'unknown', constraint: raw, note: 'constraint form not understood' });
        continue;
      }
      const parsed = version ? parseVersion(version) : null;
      if (!parsed) {
        rows.push({ ...withVersion, status: 'unknown', constraint: raw, note: version ? 'dependency version is a pre-release or not numeric' : 'dependency declares no version' });
        continue;
      }
      rows.push({ ...withVersion, status: evaluate(range, parsed), constraint: raw });
    }
  }
  return rows;
}

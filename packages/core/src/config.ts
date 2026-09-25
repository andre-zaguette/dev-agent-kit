import path from 'node:path';
import { parse } from 'yaml';
import { safeReadFile } from './safe-fs.js';
import { findSecret } from './secrets.js';
import type { WorkspaceConfig, WorkspaceRole } from './workspaces.js';
import type { ItemField, SourceMapping, TaskSourceConfig, ToolKind, ToolRef } from './task-sources/types.js';

export const CONFIG_FILE = '.dev-agent/config.yml';

export interface DevAgentConfig {
  baseBranch?: string;
  branchPattern?: string;
  taskDocsDir: string;
  stateDir: string;
  knowledgeDir: string;
  contextMode: string;
  production: { readOnly: boolean };
  git: { updateStrategy: 'ff-only'; requireCleanTree: true };
  taskMode: { analyzeCommand: 'plan-only' | 'execute-after-plan' };
  taskSources: TaskSourceConfig[];
  workspaces: WorkspaceConfig[];
}

const TOP_LEVEL_KEYS = new Set(['baseBranch', 'branchPattern', 'taskDocsDir', 'stateDir', 'knowledgeDir', 'contextMode', 'production', 'git', 'taskMode', 'taskSources', 'workspaces']);
const WORKSPACE_KEYS = new Set(['path', 'role', 'dependsOn', 'baseBranch']);
const WORKSPACE_ROLES: readonly WorkspaceRole[] = ['library', 'backend', 'api', 'frontend', 'infra', 'other'];
const MAX_WORKSPACES = 30;
const MAX_DEPENDS_ON = 30;
const SOURCE_KEYS = new Set(['adapter', 'server', 'default', 'identifiers', 'tools', 'mapping']);
const SOURCE_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const ADAPTER_RE = /^[a-z][a-z0-9-]{0,31}$/;
const SERVER_RE = /^[A-Za-z0-9._-]{1,64}$/;
const TOOL_NAME_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const ARG_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const PATH_RE = /^[A-Za-z0-9_$-]+(\.[A-Za-z0-9_$-]+)*$/;
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const CONTEXT_MODE_RE = /^[a-z][a-z-]{0,23}$/;
const ITEM_FIELDS: readonly ItemField[] = ['id', 'key', 'title', 'description', 'acceptanceCriteria', 'status', 'type', 'priority', 'labels', 'assigneeId', 'assigneeName', 'url'];
const COLLECTION_FIELDS = {
  comments: ['id', 'author', 'body', 'createdAt'],
  attachments: ['id', 'name', 'mimeType', 'url'],
  links: ['type', 'key', 'url', 'title']
} as const;
const TOOL_KINDS: readonly ToolKind[] = ['get', 'search', 'comments', 'attachments', 'links'];
const MAX_REGEX_LENGTH = 200;
const DOUBLE_ESCAPE_RE = /\\\\[dDwWsSbB]/;
const NESTED_QUANTIFIER_RE = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/;

export function defaultConfig(): DevAgentConfig {
  return {
    taskDocsDir: '.dev-agent/tasks',
    stateDir: '.dev-agent/state',
    knowledgeDir: '.dev-agent/knowledge',
    contextMode: 'balanced',
    production: { readOnly: true },
    git: { updateStrategy: 'ff-only', requireCleanTree: true },
    taskMode: { analyzeCommand: 'plan-only' },
    taskSources: [],
    workspaces: []
  };
}

function fail(label: string, where: string, message: string): never {
  throw new Error(`${label}: ${where} ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function relativeDir(label: string, where: string, value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.trim() === '') fail(label, where, 'must be a non-empty relative path');
  if (value.includes('\\') || path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value)) fail(label, where, 'must be a relative POSIX path inside the project');
  const normalized = path.posix.normalize(value).replace(/\/+$/, '');
  if (normalized === '' || normalized === '.' || normalized === '..' || normalized.startsWith('../')) fail(label, where, 'must stay inside the project');
  return normalized;
}

function mappingPath(label: string, where: string, value: unknown): string {
  if (typeof value !== 'string' || !PATH_RE.test(value) || value.split('.').some((s) => FORBIDDEN_SEGMENTS.has(s))) {
    fail(label, where, 'must be a dotted path such as "status.name"');
  }
  return value;
}

function parseIdentifiers(label: string, where: string, raw: unknown): RegExp[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) fail(label, where, 'must be a list of regular expressions');
  return raw.map((entry, i) => {
    const at = `${where}[${i}]`;
    if (typeof entry !== 'string' || entry === '') fail(label, at, 'must be a non-empty string');
    if (entry.length > MAX_REGEX_LENGTH) fail(label, at, `is longer than ${MAX_REGEX_LENGTH} characters`);
    if (DOUBLE_ESCAPE_RE.test(entry)) fail(label, at, "looks double-escaped: inside a single-quoted YAML string use one backslash, e.g. '^HEF-\\d+$'");
    if (NESTED_QUANTIFIER_RE.test(entry)) fail(label, at, 'has a nested quantifier that can cause catastrophic backtracking');
    try {
      return new RegExp(entry);
    } catch (error) {
      return fail(label, at, `is not a valid regular expression (${(error as Error).message})`);
    }
  });
}

function parseTools(label: string, where: string, raw: unknown): Partial<Record<ToolKind, ToolRef>> {
  if (raw === undefined) return {};
  if (!isRecord(raw)) fail(label, where, 'must be a mapping');
  const out: Partial<Record<ToolKind, ToolRef>> = {};
  for (const [kind, value] of Object.entries(raw)) {
    if (!(TOOL_KINDS as readonly string[]).includes(kind)) fail(label, `${where}.${kind}`, `is not a recognized tool (expected one of: ${TOOL_KINDS.join(', ')})`);
    if (!isRecord(value)) fail(label, `${where}.${kind}`, 'must be a mapping with a "name"');
    const name = value.name;
    if (typeof name !== 'string' || !TOOL_NAME_RE.test(name)) fail(label, `${where}.${kind}.name`, 'must be a tool name');
    const ref: ToolRef = { name };
    if (value.arg !== undefined) {
      if (typeof value.arg !== 'string' || !ARG_RE.test(value.arg)) fail(label, `${where}.${kind}.arg`, 'must be an argument name');
      ref.arg = value.arg;
    }
    if (value.list !== undefined) ref.list = mappingPath(label, `${where}.${kind}.list`, value.list);
    for (const extra of Object.keys(value)) if (!['name', 'arg', 'list'].includes(extra)) fail(label, `${where}.${kind}.${extra}`, 'is not a recognized setting');
    out[kind as ToolKind] = ref;
  }
  return out;
}

function parseMapping(label: string, where: string, raw: unknown): SourceMapping {
  const mapping: SourceMapping = { fields: {}, comments: {}, attachments: {}, links: {} };
  if (raw === undefined) return mapping;
  if (!isRecord(raw)) fail(label, where, 'must be a mapping');
  for (const [key, value] of Object.entries(raw)) {
    if ((ITEM_FIELDS as readonly string[]).includes(key)) {
      mapping.fields[key as ItemField] = mappingPath(label, `${where}.${key}`, value);
    } else if (Object.hasOwn(COLLECTION_FIELDS, key)) {
      const allowed = COLLECTION_FIELDS[key as keyof typeof COLLECTION_FIELDS] as readonly string[];
      if (!isRecord(value)) fail(label, `${where}.${key}`, 'must be a mapping of field names to paths');
      for (const [field, fieldPath] of Object.entries(value)) {
        if (!allowed.includes(field)) fail(label, `${where}.${key}.${field}`, `is not a recognized field (expected one of: ${allowed.join(', ')})`);
        mapping[key as keyof typeof COLLECTION_FIELDS][field] = mappingPath(label, `${where}.${key}.${field}`, fieldPath);
      }
    } else {
      fail(label, `${where}.${key}`, 'is not a recognized mapping field');
    }
  }
  return mapping;
}

function parseSource(label: string, id: string, raw: unknown): TaskSourceConfig {
  const where = `taskSources.${id}`;
  if (!SOURCE_ID_RE.test(id)) fail(label, where, 'has an invalid id (use a lowercase alias such as "company")');
  if (!isRecord(raw)) fail(label, where, 'must be a mapping');
  for (const key of Object.keys(raw)) if (!SOURCE_KEYS.has(key)) fail(label, `${where}.${key}`, 'is not a recognized setting');
  const adapter = raw.adapter;
  if (typeof adapter !== 'string' || !ADAPTER_RE.test(adapter)) fail(label, `${where}.adapter`, 'is required (e.g. "generic-mcp")');
  if (raw.default !== undefined && typeof raw.default !== 'boolean') fail(label, `${where}.default`, 'must be true or false');
  let server: string | undefined;
  if (raw.server !== undefined) {
    if (typeof raw.server !== 'string' || !SERVER_RE.test(raw.server)) fail(label, `${where}.server`, 'must be an MCP server name');
    server = raw.server;
  }
  const tools = parseTools(label, `${where}.tools`, raw.tools);
  const mapping = parseMapping(label, `${where}.mapping`, raw.mapping);
  if (adapter === 'generic-mcp') {
    if (!server) fail(label, `${where}.server`, 'is required for the generic-mcp adapter');
    if (!tools.get) fail(label, `${where}.tools.get`, 'is required for the generic-mcp adapter');
    if (!mapping.fields.key) fail(label, `${where}.mapping.key`, 'is required');
    if (!mapping.fields.title) fail(label, `${where}.mapping.title`, 'is required');
  }
  return { id, adapter, server, default: raw.default === true, identifiers: parseIdentifiers(label, `${where}.identifiers`, raw.identifiers), tools, mapping };
}

function parseWorkspaces(label: string, raw: unknown): WorkspaceConfig[] {
  if (!isRecord(raw)) fail(label, 'workspaces', 'must be a mapping of workspace names');
  const entries = Object.entries(raw);
  if (entries.length > MAX_WORKSPACES) fail(label, 'workspaces', `may have at most ${MAX_WORKSPACES} entries`);
  const list: WorkspaceConfig[] = [];
  for (const [name, value] of entries) {
    const where = `workspaces.${name}`;
    if (name === 'all') fail(label, where, 'uses the reserved name "all"');
    if (!SOURCE_ID_RE.test(name)) fail(label, where, 'has an invalid name (use lowercase letters, digits and dashes, starting with a letter)');
    if (!isRecord(value)) fail(label, where, 'must be a mapping with a "path"');
    for (const key of Object.keys(value)) if (!WORKSPACE_KEYS.has(key)) fail(label, `${where}.${key}`, 'is not a recognized setting');
    if (value.path === undefined) fail(label, `${where}.path`, 'is required');
    const wsPath = relativeDir(label, `${where}.path`, value.path, '');
    if (wsPath === '.git' || wsPath.startsWith('.git/')) fail(label, `${where}.path`, 'must not be inside .git');
    const ws: WorkspaceConfig = { name, path: wsPath, dependsOn: [] };
    if (value.role !== undefined) {
      if (typeof value.role !== 'string' || !(WORKSPACE_ROLES as readonly string[]).includes(value.role)) fail(label, `${where}.role`, `must be one of: ${WORKSPACE_ROLES.join(', ')}`);
      ws.role = value.role as WorkspaceRole;
    }
    if (value.dependsOn !== undefined) {
      if (!Array.isArray(value.dependsOn)) fail(label, `${where}.dependsOn`, 'must be a list of workspace names');
      if (value.dependsOn.length > MAX_DEPENDS_ON) fail(label, `${where}.dependsOn`, `may list at most ${MAX_DEPENDS_ON} workspaces`);
      for (const dep of value.dependsOn) if (typeof dep !== 'string' || !SOURCE_ID_RE.test(dep)) fail(label, `${where}.dependsOn`, 'must contain only workspace names');
      ws.dependsOn = [...new Set(value.dependsOn as string[])];
    }
    if (value.baseBranch !== undefined) {
      if (typeof value.baseBranch !== 'string' || value.baseBranch.trim() === '') fail(label, `${where}.baseBranch`, 'must be a non-empty string');
      ws.baseBranch = value.baseBranch.trim();
    }
    list.push(ws);
  }
  const names = new Set(list.map((w) => w.name));
  for (const ws of list) {
    for (const dep of ws.dependsOn) {
      if (dep === ws.name) fail(label, `workspaces.${ws.name}.dependsOn`, 'lists the workspace itself');
      if (!names.has(dep)) fail(label, `workspaces.${ws.name}.dependsOn`, `names an unknown workspace "${dep}"`);
    }
  }
  for (let j = 0; j < list.length; j++) {
    for (let i = 0; i < j; i++) {
      const [a, b] = [list[i], list[j]];
      if (a.path === b.path) fail(label, `workspaces.${b.name}.path`, `is the same directory as workspace "${a.name}"`);
      if (b.path.startsWith(`${a.path}/`)) fail(label, `workspaces.${b.name}.path`, `is inside workspace "${a.name}"`);
      if (a.path.startsWith(`${b.path}/`)) fail(label, `workspaces.${a.name}.path`, `is inside workspace "${b.name}"`);
    }
  }
  // Kahn: whatever cannot be removed is on or behind a cycle.
  const pending = new Map(list.map((w) => [w.name, new Set(w.dependsOn)]));
  for (let progressed = true; progressed && pending.size > 0;) {
    progressed = false;
    for (const [name, deps] of [...pending]) {
      if (deps.size > 0) continue;
      pending.delete(name);
      for (const other of pending.values()) other.delete(name);
      progressed = true;
    }
  }
  if (pending.size > 0) fail(label, 'workspaces', `dependsOn forms a cycle among: ${[...pending.keys()].sort().join(', ')}`);
  return list;
}

export function parseDevAgentConfig(yamlText: string, label = CONFIG_FILE): DevAgentConfig {
  const secret = findSecret(yamlText);
  if (secret) throw new Error(`${label}: looks like it contains a secret (${secret}); configuration must not hold credentials`);
  let raw: unknown;
  try {
    raw = parse(yamlText);
  } catch (error) {
    throw new Error(`${label}: invalid YAML (${(error as Error).message.split('\n')[0]})`);
  }
  const cfg = defaultConfig();
  if (raw === null || raw === undefined) return cfg;
  if (!isRecord(raw)) fail(label, 'the file', 'must be a YAML mapping');
  for (const key of Object.keys(raw)) if (!TOP_LEVEL_KEYS.has(key)) fail(label, key, 'is not a recognized setting');

  for (const key of ['baseBranch', 'branchPattern'] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.trim() === '') fail(label, key, 'must be a non-empty string');
    cfg[key] = value.trim();
  }
  cfg.taskDocsDir = relativeDir(label, 'taskDocsDir', raw.taskDocsDir, cfg.taskDocsDir);
  cfg.stateDir = relativeDir(label, 'stateDir', raw.stateDir, cfg.stateDir);
  cfg.knowledgeDir = relativeDir(label, 'knowledgeDir', raw.knowledgeDir, cfg.knowledgeDir);
  const dirs: Array<[string, string]> = [['taskDocsDir', cfg.taskDocsDir], ['stateDir', cfg.stateDir], ['knowledgeDir', cfg.knowledgeDir]];
  for (const [name, dir] of dirs) if (dir === '.git' || dir.startsWith('.git/')) fail(label, name, 'must not be inside .git');
  for (let i = 0; i < dirs.length; i++) {
    for (let j = i + 1; j < dirs.length; j++) {
      const [a, b] = [dirs[i][1], dirs[j][1]];
      if (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) fail(label, `${dirs[i][0]} and ${dirs[j][0]}`, 'overlap: use separate directories, none inside another');
    }
  }
  if (raw.contextMode !== undefined) {
    if (typeof raw.contextMode !== 'string' || !CONTEXT_MODE_RE.test(raw.contextMode)) fail(label, 'contextMode', 'must be a short lowercase name such as "balanced"');
    cfg.contextMode = raw.contextMode;
  }
  if (raw.production !== undefined) {
    if (!isRecord(raw.production) || (raw.production.readOnly !== undefined && typeof raw.production.readOnly !== 'boolean')) fail(label, 'production.readOnly', 'must be true or false');
    cfg.production.readOnly = raw.production.readOnly !== false;
  }
  if (raw.git !== undefined) {
    if (!isRecord(raw.git)) fail(label, 'git', 'must be a mapping');
    if (raw.git.updateStrategy !== undefined && raw.git.updateStrategy !== 'ff-only') fail(label, 'git.updateStrategy', 'must be "ff-only" (the only supported strategy)');
    if (raw.git.requireCleanTree !== undefined && raw.git.requireCleanTree !== true) fail(label, 'git.requireCleanTree', 'cannot be turned off: branches are never manipulated on a dirty tree');
  }
  if (raw.taskMode !== undefined) {
    const mode = isRecord(raw.taskMode) ? raw.taskMode.analyzeCommand : undefined;
    if (mode !== undefined && mode !== 'plan-only' && mode !== 'execute-after-plan') fail(label, 'taskMode.analyzeCommand', 'must be "plan-only" or "execute-after-plan"');
    if (mode !== undefined) cfg.taskMode.analyzeCommand = mode;
  }
  if (raw.taskSources !== undefined) {
    if (!isRecord(raw.taskSources)) fail(label, 'taskSources', 'must be a mapping of source ids');
    cfg.taskSources = Object.entries(raw.taskSources).map(([id, value]) => parseSource(label, id, value));
    const defaults = cfg.taskSources.filter((s) => s.default);
    if (defaults.length > 1) fail(label, 'taskSources', `may have only one default source (found: ${defaults.map((s) => s.id).join(', ')})`);
  }
  if (raw.workspaces !== undefined) cfg.workspaces = parseWorkspaces(label, raw.workspaces);
  return cfg;
}

export function loadDevAgentConfig(root: string): DevAgentConfig {
  const text = safeReadFile(root, CONFIG_FILE);
  return text === null ? defaultConfig() : parseDevAgentConfig(text);
}

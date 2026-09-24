import { safeReadFile, safeWriteFile } from './safe-fs.js';
import { findSecret, redactSecrets } from './secrets.js';
import type { WorkItem } from './task-sources/types.js';

export const LEDGER_SECTIONS = [
  'Source',
  'Requirement',
  'Acceptance criteria',
  'Relevant comments / decisions',
  'Classification',
  'Repository analysis',
  'Visual source',
  'Implementation plan',
  'Git',
  'Implementation log',
  'Verification',
  'How to run locally',
  'How to test this work item manually',
  'Risks / known differences',
  'Final status'
] as const;
export type LedgerSection = (typeof LEDGER_SECTIONS)[number];

const CLASSIFICATIONS = ['frontend', 'backend', 'fullstack', 'investigation-only', 'infrastructure'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];
const PHASES = ['ingestion', 'investigation', 'git', 'implementation', 'verification', 'done', 'blocked'] as const;
export type TaskPhase = (typeof PHASES)[number];
export type FinalStatus = 'planned' | 'blocked' | 'implementing' | 'verifying' | 'done';

export interface TaskState {
  workItemKey: string;
  source: string;
  classification?: Classification;
  phase: TaskPhase;
  baseBranch?: string;
  baseSha?: string;
  workingBranch?: string;
  visualSource?: string;
  skills: string[];
  updatedAt: string;
}

export interface TaskDirs {
  taskDocsDir: string;
  stateDir: string;
}

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SOURCE_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const PENDING = '_Not yet recorded._';
const PHASE_STATUS: Record<TaskPhase, FinalStatus> = {
  ingestion: 'planned',
  investigation: 'planned',
  git: 'planned',
  implementation: 'implementing',
  verification: 'verifying',
  done: 'done',
  blocked: 'blocked'
};
const INGESTION_SECTIONS: LedgerSection[] = ['Source', 'Requirement', 'Acceptance criteria', 'Relevant comments / decisions'];
const MAX_COMMENT_LINES = 20;
const MAX_COMMENT_CHARS = 500;

export function assertWorkItemKey(key: string): void {
  if (!KEY_RE.test(key) || key.includes('..')) throw new Error(`invalid work item key "${key.slice(0, 80)}": use letters, digits, ".", "_" and "-" only`);
}

export function taskDocPath(dirs: TaskDirs, key: string): string {
  assertWorkItemKey(key);
  return `${dirs.taskDocsDir}/${key}.md`;
}

export function taskStatePath(dirs: TaskDirs, key: string): string {
  assertWorkItemKey(key);
  return `${dirs.stateDir}/${key}.json`;
}

/** Blockquote every line so external text can never start a heading, list or fence of its own. */
export function quoteExternal(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
const oneLineBullet = (text: string): string => oneLine(text).replace(/^[#>*+-]+\s*/, '');

const external = (text: string): string => redactSecrets(text);

function ingestionBodies(item: WorkItem, syncedAt: string): Record<string, string> {
  const criteria =
    item.acceptanceCriteria.length > 0
      ? item.acceptanceCriteria.map((c) => `- ${oneLineBullet(external(c))}`).join('\n')
      : item.metadata?.acceptanceCriteria === 'unavailable'
        ? '_Explicit acceptance criteria were unavailable from the source._'
        : PENDING;
  const comments =
    item.comments.length > 0
      ? item.comments
          .slice(0, MAX_COMMENT_LINES)
          .map((c) => `- **${oneLineBullet(external(c.author ?? 'unknown'))}**${c.createdAt ? ` (${oneLine(external(c.createdAt))})` : ''}: ${oneLine(external(c.body)).slice(0, MAX_COMMENT_CHARS)}`)
          .join('\n')
      : '_None._';
  return {
    Source: [`- Source ID: ${oneLine(item.source)}`, `- Work item: ${oneLine(item.key)}`, `- URL: ${item.rawUrl ? oneLine(item.rawUrl) : 'n/a'}`, `- Last synced: ${oneLine(syncedAt)}`].join('\n'),
    Requirement: item.description.trim() === '' ? '_No description provided._' : quoteExternal(external(item.description)),
    'Acceptance criteria': criteria,
    'Relevant comments / decisions': comments
  };
}

export function renderLedger(item: WorkItem, opts: { syncedAt: string }): string {
  assertWorkItemKey(item.key);
  const bodies = ingestionBodies(item, opts.syncedAt);
  const title = oneLine(external(item.title)).replace(/^#+\s*/, '');
  const sections = LEDGER_SECTIONS.map((name) => `## ${name}\n${name === 'Final status' ? 'planned' : (bodies[name] ?? PENDING)}\n`);
  return `# ${item.key} - ${title}\n\n${sections.join('\n')}`;
}

interface Fence {
  char: string;
  len: number;
}

/** One CommonMark fence step: an opener needs 3+ backticks or tildes; only the same character, at least as long, closes it. */
function fenceStep(line: string, open: Fence | null): { open: Fence | null; isFenceLine: boolean } {
  const m = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (open === null) {
    if (m && !(m[1][0] === '`' && m[2].includes('`'))) return { open: { char: m[1][0], len: m[1].length }, isFenceLine: true };
    return { open, isFenceLine: false };
  }
  if (m && m[1][0] === open.char && m[1].length >= open.len && m[2].trim() === '') return { open: null, isFenceLine: true };
  return { open, isFenceLine: true };
}

export function parseLedger(md: string): { preamble: string; sections: Array<{ name: string; body: string }> } {
  const preambleLines: string[] = [];
  const sections: Array<{ name: string; lines: string[] }> = [];
  let fence: Fence | null = null;
  for (const line of md.split('\n')) {
    const wasOpen = fence !== null;
    const step = fenceStep(line, fence);
    fence = step.open;
    const heading = !wasOpen && !step.isFenceLine ? line.match(/^## (.+?)\s*$/) : null;
    if (heading) sections.push({ name: heading[1], lines: [] });
    else if (sections.length === 0) preambleLines.push(line);
    else sections[sections.length - 1].lines.push(line);
  }
  return { preamble: preambleLines.join('\n').trim(), sections: sections.map((s) => ({ name: s.name, body: s.lines.join('\n').trim() })) };
}

/** A section body that can neither start a heading of its own nor leave a fence open over later sections. */
function sanitizeBody(body: string): string {
  let fence: Fence | null = null;
  const lines = body
    .trim()
    .split('\n')
    .map((line) => {
      const wasOpen = fence !== null;
      const step = fenceStep(line, fence);
      fence = step.open;
      return !wasOpen && !step.isFenceLine && /^#{1,2}(?:\s|$)/.test(line) ? `\\${line}` : line;
    });
  const open = fence as Fence | null;
  if (open) lines.push(open.char.repeat(open.len));
  return lines.join('\n');
}

function serializeLedger(preamble: string, sections: Array<{ name: string; body: string }>): string {
  return `${preamble}\n\n${sections.map((s) => `## ${s.name}\n${s.body}\n`).join('\n')}`;
}

export function setLedgerSection(md: string, section: LedgerSection, body: string): string {
  if (!(LEDGER_SECTIONS as readonly string[]).includes(section)) throw new Error(`unknown ledger section "${section}"`);
  const { preamble, sections } = parseLedger(md);
  const existing = sections.find((s) => s.name === section);
  const clean = sanitizeBody(body);
  if (existing) existing.body = clean;
  else sections.push({ name: section, body: clean });
  return serializeLedger(preamble, sections);
}

export function parseTaskState(text: string): TaskState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('invalid task state: not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('invalid task state: not an object');
  const r = raw as Record<string, unknown>;
  const str = (name: string, optional = false): string | undefined => {
    const v = r[name];
    if (v === undefined && optional) return undefined;
    if (typeof v !== 'string' || v === '' || v.length > 200) throw new Error(`invalid task state: "${name}"`);
    return v;
  };
  const key = str('workItemKey')!;
  assertWorkItemKey(key);
  const source = str('source')!;
  if (!SOURCE_ID_RE.test(source)) throw new Error('invalid task state: "source"');
  const phase = str('phase')!;
  if (!(PHASES as readonly string[]).includes(phase)) throw new Error('invalid task state: "phase"');
  const classification = str('classification', true);
  if (classification !== undefined && !(CLASSIFICATIONS as readonly string[]).includes(classification)) throw new Error('invalid task state: "classification"');
  const skills = r.skills;
  if (!Array.isArray(skills) || skills.length > 50 || skills.some((s) => typeof s !== 'string' || s.length > 64)) throw new Error('invalid task state: "skills"');
  const state: TaskState = { workItemKey: key, source, phase: phase as TaskPhase, skills: skills as string[], updatedAt: str('updatedAt')! };
  if (classification !== undefined) state.classification = classification as Classification;
  for (const name of ['baseBranch', 'baseSha', 'workingBranch', 'visualSource'] as const) {
    const v = str(name, true);
    if (v !== undefined) state[name] = v;
  }
  return state;
}

export function readTaskState(root: string, dirs: TaskDirs, key: string): TaskState | null {
  const text = safeReadFile(root, taskStatePath(dirs, key));
  return text === null ? null : parseTaskState(text);
}

export function readLedger(root: string, dirs: TaskDirs, key: string): string | null {
  return safeReadFile(root, taskDocPath(dirs, key));
}

function writeState(root: string, dirs: TaskDirs, state: TaskState): void {
  safeWriteFile(root, taskStatePath(dirs, state.workItemKey), `${JSON.stringify(state, null, 2)}\n`);
}

/** Checkpoint 1 (spec §29): create the ledger and state, or refresh only the source-derived sections. */
export function ingestWorkItem(root: string, dirs: TaskDirs, item: WorkItem, opts: { now?: string; classification?: Classification } = {}): TaskState {
  assertWorkItemKey(item.key);
  const now = opts.now ?? new Date().toISOString();
  const existingState = readTaskState(root, dirs, item.key);
  const existingLedger = readLedger(root, dirs, item.key);
  let ledger = renderLedger(item, { syncedAt: now });
  if (existingLedger !== null) {
    const fresh = parseLedger(ledger);
    let merged = existingLedger;
    for (const name of INGESTION_SECTIONS) merged = setLedgerSection(merged, name, fresh.sections.find((s) => s.name === name)!.body);
    ledger = merged;
  }
  const state: TaskState = existingState
    ? { ...existingState, updatedAt: now }
    : { workItemKey: item.key, source: item.source, ...(opts.classification ? { classification: opts.classification } : {}), phase: 'ingestion', skills: [], updatedAt: now };
  safeWriteFile(root, taskDocPath(dirs, item.key), ledger);
  writeState(root, dirs, state);
  return state;
}

/** Record a checkpoint: new phase, optional section bodies and state fields. `Final status` is derived from the phase. */
export function recordCheckpoint(
  root: string,
  dirs: TaskDirs,
  key: string,
  update: { phase: TaskPhase; sections?: Partial<Record<Exclude<LedgerSection, 'Final status'>, string>>; state?: Partial<Omit<TaskState, 'workItemKey' | 'phase' | 'updatedAt'>> },
  now: string = new Date().toISOString()
): TaskState {
  if (update.sections && 'Final status' in update.sections) throw new Error('"Final status" is derived from the phase and cannot be set directly');
  const state = readTaskState(root, dirs, key);
  const ledger = readLedger(root, dirs, key);
  if (state === null || ledger === null) throw new Error(`${key} is not ingested yet: ingest the work item first`);
  let next = ledger;
  for (const [name, body] of Object.entries(update.sections ?? {})) next = setLedgerSection(next, name as LedgerSection, body);
  next = setLedgerSection(next, 'Final status', PHASE_STATUS[update.phase]);
  const merged: TaskState = { ...state, ...(update.state ?? {}), workItemKey: key, phase: update.phase, updatedAt: now };
  // Validate and scan both payloads before writing either, so a refusal never leaves a half-updated pair of files.
  parseTaskState(JSON.stringify(merged));
  for (const [what, text] of [['task ledger', next], ['task state', JSON.stringify(merged)]] as const) {
    const secret = findSecret(text);
    if (secret) throw new Error(`refusing to update the ${what} of ${key}: the content looks like it contains a secret (${secret})`);
  }
  safeWriteFile(root, taskDocPath(dirs, key), next);
  writeState(root, dirs, merged);
  return merged;
}

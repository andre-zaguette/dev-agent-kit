import { currentBranch, dirtyFiles, isAncestor } from './git.js';
import { readLedger, readTaskState, type TaskDirs, type TaskPhase, type TaskState, type WorkspaceState } from './ledger.js';
import { KNOWLEDGE_NAMES, checkFreshness, readKnowledgeIn } from './repo-memory.js';
import type { TaskSourceConfig } from './task-sources/types.js';
import { isOwnRepository, workspaceRoot, type WorkspaceConfig } from './workspaces.js';

export interface WorkspaceReport {
  workspace: string;
  ok: boolean;
  reasons: string[];
  notes: string[];
}

export type ResumeCheck =
  | { ok: true; state: TaskState; phase: TaskPhase; sourceConfigured: boolean; staleKnowledge: string[]; workspaceReports: WorkspaceReport[] }
  | { ok: false; reasons: string[]; state?: TaskState; workspaceReports?: WorkspaceReport[] };

/**
 * Spec §10: validate the saved state against the repository before continuing. Returns reasons to
 * reconcile instead of assuming the ledger is current. Uncommitted work never blocks a resume.
 */
export function checkResume(root: string, cfg: TaskDirs & { knowledgeDir: string; taskSources: TaskSourceConfig[]; workspaces?: WorkspaceConfig[] }, key: string): ResumeCheck {
  let state: TaskState | null;
  let ledger: string | null;
  try {
    state = readTaskState(root, cfg, key);
    ledger = readLedger(root, cfg, key);
  } catch (error) {
    return { ok: false, reasons: [(error as Error).message] };
  }
  if (state === null) return { ok: false, reasons: [`no saved state for ${key}`] };
  if (ledger === null) return { ok: false, reasons: [`the task ledger for ${key} is missing`], state };

  const reasons: string[] = [];
  let workspaceReports: WorkspaceReport[] = [];
  if (state.workspaces !== undefined) {
    workspaceReports = Object.entries(state.workspaces).map(([name, recorded]) => checkWorkspace(root, cfg.workspaces ?? [], name, recorded));
    for (const report of workspaceReports) reasons.push(...report.reasons.map((r) => `${report.workspace}: ${r}`));
  } else if (state.workingBranch !== undefined) {
    const branch = currentBranch(root);
    if (branch !== state.workingBranch) reasons.push(`on branch "${branch ?? 'detached HEAD'}" but the task recorded "${state.workingBranch}"`);
  }
  if (state.workspaces === undefined && state.baseSha !== undefined && !isAncestor(root, state.baseSha, 'HEAD')) {
    reasons.push(`the recorded base commit ${state.baseSha} is not in the current history (rebased or replaced?)`);
  }
  if (reasons.length > 0) return { ok: false, reasons, state, ...(state.workspaces !== undefined ? { workspaceReports } : {}) };

  const staleKnowledge: string[] = [];
  for (const name of KNOWLEDGE_NAMES) {
    let doc;
    try {
      doc = readKnowledgeIn(root, cfg.knowledgeDir, name);
    } catch (error) {
      return { ok: false, reasons: [(error as Error).message], state };
    }
    if (doc !== null && checkFreshness(root, doc).state !== 'fresh') staleKnowledge.push(name);
  }
  return { ok: true, state, phase: state.phase, sourceConfigured: cfg.taskSources.some((s) => s.id === state.source), staleKnowledge, workspaceReports };
}

function checkWorkspace(root: string, configured: WorkspaceConfig[], name: string, recorded: WorkspaceState): WorkspaceReport {
  const reasons: string[] = [];
  const notes: string[] = [];
  const done = (): WorkspaceReport => ({ workspace: name, ok: reasons.length === 0, reasons, notes });
  const ws = configured.find((w) => w.name === name);
  if (!ws) {
    reasons.push('recorded by the task but missing from the workspaces configuration');
    return done();
  }
  let dir: string;
  try {
    dir = workspaceRoot(root, ws);
  } catch (error) {
    reasons.push((error as Error).message.replace(/^workspace "[^"]*": /, ''));
    return done();
  }
  if (!isOwnRepository(dir)) {
    reasons.push('not a Git repository');
    return done();
  }
  if (recorded.workingBranch !== undefined) {
    const branch = currentBranch(dir);
    if (branch !== recorded.workingBranch) reasons.push(`on branch "${branch ?? 'detached HEAD'}" but the task recorded "${recorded.workingBranch}"`);
  }
  if (recorded.baseSha !== undefined && !isAncestor(dir, recorded.baseSha, 'HEAD')) {
    reasons.push(`the recorded base commit ${recorded.baseSha} is not in the current history (rebased or replaced?)`);
  }
  const dirty = dirtyFiles(dir);
  if (dirty !== null && dirty.length > 0) notes.push(`uncommitted changes in ${dirty.length} file${dirty.length === 1 ? '' : 's'}`);
  return done();
}

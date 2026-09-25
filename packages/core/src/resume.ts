import { currentBranch, isAncestor } from './git.js';
import { readLedger, readTaskState, type TaskDirs, type TaskPhase, type TaskState } from './ledger.js';
import { KNOWLEDGE_NAMES, checkFreshness, readKnowledgeIn } from './repo-memory.js';
import type { TaskSourceConfig } from './task-sources/types.js';

export type ResumeCheck =
  | { ok: true; state: TaskState; phase: TaskPhase; sourceConfigured: boolean; staleKnowledge: string[] }
  | { ok: false; reasons: string[]; state?: TaskState };

/**
 * Spec §10: validate the saved state against the repository before continuing. Returns reasons to
 * reconcile instead of assuming the ledger is current. Uncommitted work never blocks a resume.
 */
export function checkResume(root: string, cfg: TaskDirs & { knowledgeDir: string; taskSources: TaskSourceConfig[] }, key: string): ResumeCheck {
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
  if (state.workingBranch !== undefined) {
    const branch = currentBranch(root);
    if (branch !== state.workingBranch) reasons.push(`on branch "${branch ?? 'detached HEAD'}" but the task recorded "${state.workingBranch}"`);
  }
  if (state.baseSha !== undefined && !isAncestor(root, state.baseSha, 'HEAD')) {
    reasons.push(`the recorded base commit ${state.baseSha} is not in the current history (rebased or replaced?)`);
  }
  if (reasons.length > 0) return { ok: false, reasons, state };

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
  return { ok: true, state, phase: state.phase, sourceConfigured: cfg.taskSources.some((s) => s.id === state.source), staleKnowledge };
}

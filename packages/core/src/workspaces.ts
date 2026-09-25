import { realpathSync, statSync } from 'node:fs';
import { resolveInside } from './safe-fs.js';

export type WorkspaceRole = 'library' | 'backend' | 'api' | 'frontend' | 'infra' | 'other';

export interface WorkspaceConfig {
  name: string;
  path: string;
  role?: WorkspaceRole;
  dependsOn: string[];
  baseBranch?: string;
}

interface HasWorkspaces {
  workspaces: WorkspaceConfig[];
}

/** The real directory of a workspace inside `root`; throws naming the workspace when it is unsafe or absent. */
export function workspaceRoot(root: string, ws: WorkspaceConfig): string {
  let target: string;
  try {
    target = resolveInside(root, ws.path);
  } catch (error) {
    throw new Error(`workspace "${ws.name}": ${(error as Error).message}`);
  }
  let stat;
  try {
    stat = statSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`workspace "${ws.name}": directory "${ws.path}" does not exist`);
    throw error;
  }
  if (!stat.isDirectory()) throw new Error(`workspace "${ws.name}": "${ws.path}" is not a directory`);
  return realpathSync(target);
}

export function findWorkspace(cfg: HasWorkspaces, name: string): WorkspaceConfig {
  const found = cfg.workspaces.find((w) => w.name === name);
  if (!found) throw new Error(`unknown workspace "${name}" (known: ${cfg.workspaces.map((w) => w.name).sort().join(', ') || 'none'})`);
  return found;
}

/** Dependencies first; ties are broken alphabetically. Iterative Kahn sort. */
function topologicalOrder(all: WorkspaceConfig[]): WorkspaceConfig[] {
  const byName = new Map(all.map((w) => [w.name, w]));
  const pending = new Map(all.map((w) => [w.name, new Set(w.dependsOn.filter((d) => byName.has(d)))]));
  const out: WorkspaceConfig[] = [];
  while (pending.size > 0) {
    const ready = [...pending.entries()].filter(([, deps]) => deps.size === 0).map(([name]) => name).sort();
    if (ready.length === 0) throw new Error(`workspaces form a dependency cycle among: ${[...pending.keys()].sort().join(', ')}`);
    const next = ready[0];
    out.push(byName.get(next)!);
    pending.delete(next);
    for (const deps of pending.values()) deps.delete(next);
  }
  return out;
}

export function orderWorkspaces(cfg: HasWorkspaces, opts: { only?: string[]; withDeps?: boolean } = {}): WorkspaceConfig[] {
  const ordered = topologicalOrder(cfg.workspaces);
  if (!opts.only) return ordered;
  const wanted = new Set<string>();
  const visit = (name: string): void => {
    const stack = [name];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (wanted.has(current)) continue;
      wanted.add(current);
      if (opts.withDeps) stack.push(...findWorkspace(cfg, current).dependsOn);
    }
  };
  for (const name of opts.only) {
    findWorkspace(cfg, name);
    visit(name);
  }
  return ordered.filter((w) => wanted.has(w.name));
}

import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { getProjectRoot } from './project.js';

export interface ResolveProjectPathOptions {
  toolName: string;
  label: string;
  extension?: string;
}

function escapesRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

/** True when `p` exists as a filesystem entry, including a dangling symlink (Follow-up #2). */
function existsAsEntry(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Cap on symlink dereferences while resolving a chain, mirroring the OS ELOOP limit (Follow-up round 2). */
const MAX_SYMLINK_HOPS = 40;

/**
 * Resolve `p` to its real path, following symlinks on every existing segment,
 * including a *chain* of symlinks where an earlier link points at a later,
 * still-dangling one (Follow-up #2 / round 2) — a dangling symlink counts as
 * existing so it can't be used as a fake "does not exist yet" tail to
 * smuggle a write outside the root. If `p` (or a tail of it) does not exist
 * at all, realpath its nearest existing ancestor and re-append the
 * non-existing tail, so a not-yet-created file's path can still be checked
 * for containment via any symlinked parent.
 */
function realpathOfNearestAncestor(p: string): string {
  let current = p;
  let pendingTail: string[] = [];
  let hops = 0;

  for (;;) {
    const localTail: string[] = [];
    while (!existsAsEntry(current)) {
      const parent = path.dirname(current);
      if (parent === current) break;
      localTail.unshift(path.basename(current));
      current = parent;
    }
    pendingTail = [...localTail, ...pendingTail];

    const stat = lstatSync(current);
    if (!stat.isSymbolicLink()) {
      const real = realpathSync(current);
      return pendingTail.length > 0 ? path.join(real, ...pendingTail) : real;
    }

    try {
      // Resolves in one shot whenever the whole chain bottoms out at an
      // existing target (including a live target reached through several
      // live intermediate links).
      const real = realpathSync(current);
      return pendingTail.length > 0 ? path.join(real, ...pendingTail) : real;
    } catch {
      // Dangling somewhere down the chain: follow this one link manually
      // (resolve its target against its own directory, since it doesn't
      // exist to be followed by realpathSync) and keep going — the target
      // may itself be another symlink, dangling or not.
      hops += 1;
      if (hops > MAX_SYMLINK_HOPS) {
        throw new Error('too many levels of symbolic links');
      }
      const target = readlinkSync(current);
      current = path.resolve(path.dirname(current), target);
    }
  }
}

/**
 * Resolve a tool-supplied path against the project root and reject anything
 * that lands outside it (spec §9). Returns the absolute path.
 *
 * Containment is checked twice: once on the logical (possibly symlinked)
 * path, and once on the realpath of the project root and of the resolved
 * path's nearest existing ancestor — so a symlink inside the root that
 * points outside it cannot be used to escape.
 */
export function resolveProjectPath(inputPath: string, options: ResolveProjectPathOptions): string {
  const { toolName, label, extension } = options;
  const projectRoot = getProjectRoot();
  const resolved = path.resolve(projectRoot, inputPath);

  if (escapesRoot(projectRoot, resolved)) {
    throw new Error(`${toolName}: ${label} "${inputPath}" resolves outside the project root "${projectRoot}".`);
  }

  let realRoot: string;
  try {
    realRoot = realpathSync(projectRoot);
  } catch {
    realRoot = projectRoot;
  }
  let realResolved: string;
  try {
    realResolved = realpathOfNearestAncestor(resolved);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${toolName}: ${label} "${inputPath}" could not be resolved: ${message}`);
  }
  if (escapesRoot(realRoot, realResolved)) {
    throw new Error(`${toolName}: ${label} "${inputPath}" resolves outside the project root "${projectRoot}".`);
  }

  if (extension && path.extname(resolved).toLowerCase() !== extension) {
    throw new Error(`${toolName}: ${label} "${inputPath}" must have a ${extension} extension.`);
  }
  return resolved;
}

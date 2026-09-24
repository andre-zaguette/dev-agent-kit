import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { findSecret } from './secrets.js';

/**
 * Resolve `relPath` under `root`. Refuses absolute paths, anything that escapes `root`, and any
 * symbolic link on the way down (the root itself is realpath'd once and may be a link).
 */
export function resolveInside(root: string, relPath: string): string {
  if (relPath === '' || path.isAbsolute(relPath)) throw new Error(`path must be relative to the project: "${relPath}"`);
  const realRoot = realpathSync(root);
  const target = path.resolve(realRoot, relPath);
  const rel = path.relative(realRoot, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`path escapes the project root: "${relPath}"`);
  }
  let current = realRoot;
  for (const segment of rel.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error(`refusing to use a symbolic link: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
  }
  return target;
}

export function safeWriteFile(root: string, relPath: string, content: string): string {
  const secret = findSecret(content);
  if (secret) throw new Error(`refusing to write ${relPath}: the content looks like it contains a secret (${secret})`);
  const target = resolveInside(root, relPath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
  return target;
}

/** File content, or null when it does not exist. Throws on a symlink or an escaping path. */
export function safeReadFile(root: string, relPath: string): string | null {
  const target = resolveInside(root, relPath);
  try {
    return readFileSync(target, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

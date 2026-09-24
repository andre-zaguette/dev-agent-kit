import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const WORKSPACE_PREFIX = 'fak-bench-';
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

/** Copy `fixtureDir` into a fresh temp dir. Symlinks and special files are refused, never followed. */
export function createWorkspace(fixtureDir: string, options: { maxBytes?: number } = {}): string {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const ws = realpathSync(mkdtempSync(path.join(tmpdir(), WORKSPACE_PREFIX)));
  let total = 0;
  const copy = (src: string, dst: string, rel: string) => {
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const from = path.join(src, entry.name);
      const to = path.join(dst, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`fixture ${fixtureDir} contains a symbolic link: ${childRel}`);
      if (entry.isDirectory()) {
        mkdirSync(to);
        copy(from, to, childRel);
      } else if (entry.isFile()) {
        total += lstatSync(from).size;
        if (total > maxBytes) throw new Error(`fixture ${fixtureDir} is larger than ${maxBytes} bytes`);
        copyFileSync(from, to);
      } else {
        throw new Error(`fixture ${fixtureDir} contains a special file: ${childRel}`);
      }
    }
  };
  try {
    copy(fixtureDir, ws, '');
  } catch (error) {
    rmSync(ws, { recursive: true, force: true });
    throw error;
  }
  return ws;
}

export function removeWorkspace(dir: string): void {
  const resolved = path.resolve(dir);
  const root = realpathSync(tmpdir());
  if (path.dirname(resolved) !== root || !path.basename(resolved).startsWith(WORKSPACE_PREFIX)) {
    throw new Error(`refusing to remove ${dir}: not a bench workspace`);
  }
  rmSync(resolved, { recursive: true, force: true });
}

import { accessSync, constants, readFileSync, readdirSync, statSync, existsSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const KIT_PACKAGE_NAMES = ['dev-agent-kit', 'frontend-agent-kit'];

/** Walk up from `fromDir` to the kit root (a checkout or an installed copy): the directory that holds skills/ and a package.json named "dev-agent-kit" (or its historical name "frontend-agent-kit"). */
export function findKitRoot(fromDir: string = HERE): string {
  let current = path.resolve(fromDir);
  for (;;) {
    const pkgPath = path.join(current, 'package.json');
    if (existsSync(pkgPath) && existsSync(path.join(current, 'skills'))) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
      if (pkg.name !== undefined && KIT_PACKAGE_NAMES.includes(pkg.name)) return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`frontend-agent: could not find the kit checkout above "${fromDir}".`);
    }
    current = parent;
  }
}

export function readKitVersion(): string {
  const pkg = JSON.parse(readFileSync(path.join(HERE, '..', 'package.json'), 'utf8')) as { version: string };
  return pkg.version;
}

/** Resolve `command` against env.PATH without spawning a shell. Returns the absolute path or null. */
export function which(command: string, env: NodeJS.ProcessEnv): string | null {
  const dirs = (env.PATH ?? '').split(path.delimiter).filter((dir) => dir.length > 0);
  for (const dir of dirs) {
    const candidate = path.join(dir, command);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not present or not executable here — keep looking
    }
  }
  return null;
}

export function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * Guard against a symlinked DIRECTORY on the write path sending writes outside the project.
 * Walks from `dir` up to the first existing ancestor (inclusive) and requires its real path
 * to be `rootDir`'s real path or nested inside it. Throws otherwise.
 */
export function assertRealDirInsideRoot(dir: string, rootDir: string): void {
  let realRoot: string;
  try {
    realRoot = realpathSync(rootDir);
  } catch {
    throw new Error(`frontend-agent: invalid root directory ${rootDir}`);
  }

  let current = path.resolve(dir);
  let real: string;
  for (;;) {
    try {
      real = realpathSync(current);
      break;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error(`frontend-agent: ${dir} resolves outside the project root; refusing to write there.`);
      }
      current = parent;
    }
  }

  const rel = path.relative(realRoot, real);
  if (rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) {
    throw new Error(`frontend-agent: ${dir} resolves outside the project root (${real}); refusing to write there.`);
  }
}

/** All files under `dir`, as sorted relative paths with "/" separators. */
export function listFilesRecursive(dir: string): string[] {
  const files: string[] = [];
  const walk = (current: string, prefix: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(current, entry.name), rel);
      else if (entry.isFile()) files.push(rel);
    }
  };
  walk(dir, '');
  return files.sort();
}

/**
 * The directory `--project` is resolved against. npm changes into the kit checkout for `npm run …` and keeps the caller's directory in
 * INIT_CWD, so INIT_CWD is trusted only then (from the checkout root or one of its packages); anywhere else (an installed kit, a monorepo workspace script) the process directory is right.
 */
export function effectiveCwd(env: NodeJS.ProcessEnv, cwd: string, kitRoot: string): string {
  if (!env.INIT_CWD) return cwd;
  try {
    const here = realpathSync(cwd);
    const kit = realpathSync(kitRoot);
    return here === kit || here.startsWith(kit + path.sep) ? env.INIT_CWD : cwd;
  } catch {
    return cwd;
  }
}

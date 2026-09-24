import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listFilesRecursive, sha256File } from './util.js';

export const MANIFEST_FILE = '.frontend-agent-kit-manifest.json';

export interface SkillsManifest {
  kitVersion: string;
  skills: Record<string, Record<string, string>>;
}

export interface SyncReport {
  targetDir: string;
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: string[];
  skipped: Array<{ path: string; reason: string }>;
}

const SKILL_NAME_RE = /^[A-Za-z0-9._-]+$/;
const HASH_RE = /^[0-9a-f]{64}$/;

function manifestError(manifestPath: string, reason: string): Error {
  return new Error(`frontend-agent: ${manifestPath} is corrupt or was tampered with (${reason}); remove it and re-run install.`);
}

/** Reject a manifest file key that is not a safe relative, '/'-separated path. */
function isSafeRelativeKey(key: unknown): key is string {
  if (typeof key !== 'string' || key.length === 0) return false;
  if (path.isAbsolute(key)) return false;
  if (key.includes('\\')) return false;
  const segments = key.split('/');
  for (const segment of segments) {
    if (segment.length === 0 || segment === '.' || segment === '..') return false;
  }
  return true;
}

function validateManifestShape(parsed: unknown, manifestPath: string, targetDir: string): asserts parsed is SkillsManifest {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw manifestError(manifestPath, 'not a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.skills !== 'object' || obj.skills === null || Array.isArray(obj.skills)) {
    throw manifestError(manifestPath, 'missing "skills" object');
  }
  for (const [skill, files] of Object.entries(obj.skills as Record<string, unknown>)) {
    if (skill === '.' || skill === '..' || !SKILL_NAME_RE.test(skill)) {
      throw manifestError(manifestPath, `invalid skill name "${skill}"`);
    }
    if (typeof files !== 'object' || files === null || Array.isArray(files)) {
      throw manifestError(manifestPath, `invalid file map for skill "${skill}"`);
    }
    const skillDir = path.join(targetDir, skill);
    for (const [key, hash] of Object.entries(files as Record<string, unknown>)) {
      if (!isSafeRelativeKey(key)) {
        throw manifestError(manifestPath, `invalid file path "${key}" in skill "${skill}"`);
      }
      const resolved = path.resolve(skillDir, key);
      const rel = path.relative(skillDir, resolved);
      if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
        throw manifestError(manifestPath, `file path "${key}" in skill "${skill}" escapes the skill directory`);
      }
      if (typeof hash !== 'string' || !HASH_RE.test(hash)) {
        throw manifestError(manifestPath, `invalid hash for "${skill}/${key}"`);
      }
    }
  }
}

/**
 * Refuse to read/write the manifest through a symbolic link. lstat (not existsSync) so a
 * dangling symlink is still caught, instead of being silently treated as "file absent".
 * Returns true when the manifest path exists as a regular file.
 */
function assertManifestNotSymlink(manifestPath: string): boolean {
  let stat;
  try {
    stat = lstatSync(manifestPath);
  } catch {
    return false; // doesn't exist yet — fine
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`frontend-agent: ${manifestPath} is a symbolic link; refusing to read or write it.`);
  }
  return true;
}

export function readManifest(targetDir: string): SkillsManifest {
  const manifestPath = path.join(targetDir, MANIFEST_FILE);
  if (!assertManifestNotSymlink(manifestPath)) return { kitVersion: '', skills: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw manifestError(manifestPath, (error as Error).message);
  }
  validateManifestShape(parsed, manifestPath, targetDir);
  return parsed;
}

export function listSourceSkills(sourceDir: string): string[] {
  return readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(sourceDir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

/** Check if a path is a symbolic link without following it. */
function isSymlink(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    return lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

/** R1': Check every existing path component from rootDir (exclusive) down to targetPath (inclusive) for symlinks.
    Returns the first symlink found (relative path from rootDir) or null.
    Throws when targetPath does not resolve inside rootDir at all (e.g. a sibling directory
    like "<target>-evil" that merely shares a string prefix with rootDir). */
export function symlinkOnPath(rootDir: string, targetPath: string): string | null {
  const normalizedRoot = path.resolve(rootDir);
  const normalizedTarget = path.resolve(targetPath);

  const relativePath = path.relative(normalizedRoot, normalizedTarget);
  if (relativePath === '..' || relativePath.startsWith('..' + path.sep) || path.isAbsolute(relativePath)) {
    throw new Error(`frontend-agent: ${targetPath} resolves outside ${rootDir}; refusing to write there.`);
  }

  const components = relativePath.split(path.sep).filter((c) => c.length > 0);

  let current = normalizedRoot;
  for (const component of components) {
    current = path.join(current, component);
    if (existsSync(current)) {
      try {
        if (lstatSync(current).isSymbolicLink()) {
          return path.relative(normalizedRoot, current);
        }
      } catch {
        // If lstat fails, skip
      }
    }
  }
  return null;
}

/** R2': Check if an unmanaged target skill dir can be adopted. Conditions:
    - Not a symlink
    - SKILL.md exists in target and is identical to source
    - Files that exist in both source and target are identical (missing files allowed, extra files allowed)
*/
function isIdenticalUnmanagedSkill(sourceSkillDir: string, targetSkillDir: string, targetDir: string): boolean {
  if (!existsSync(targetSkillDir)) return false;
  if (symlinkOnPath(targetDir, targetSkillDir) !== null) return false;

  // SKILL.md must exist and be identical
  const skillMdSrc = path.join(sourceSkillDir, 'SKILL.md');
  const skillMdDst = path.join(targetSkillDir, 'SKILL.md');
  if (!existsSync(skillMdDst) || sha256File(skillMdSrc) !== sha256File(skillMdDst)) {
    return false;
  }

  // For all other files: if they exist in both, they must be identical
  const sourceFiles = listFilesRecursive(sourceSkillDir);
  for (const rel of sourceFiles) {
    const src = path.join(sourceSkillDir, rel);
    const dst = path.join(targetSkillDir, rel);
    if (existsSync(dst) && sha256File(src) !== sha256File(dst)) {
      return false;
    }
  }
  return true;
}

/** Remove empty directories under `dir` (bottom-up), and `dir` itself when it ends up empty. Do not follow symlinks. */
function pruneEmptyDirs(dir: string, rootDir?: string): void {
  if (!existsSync(dir)) return;
  // Use rootDir if provided for symlink checking, otherwise just check the dir itself
  if (rootDir && symlinkOnPath(rootDir, dir) !== null) return;
  if (!rootDir && isSymlink(dir)) return;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const childPath = path.join(dir, entry.name);
      if (!rootDir && isSymlink(childPath)) continue;
      if (rootDir && symlinkOnPath(rootDir, childPath) !== null) continue;
      pruneEmptyDirs(childPath, rootDir);
    }
  }
  if (readdirSync(dir).length === 0) rmdirSync(dir);
}

export function syncSkills(
  sourceDir: string,
  targetDir: string,
  options: { kitVersion: string; force?: boolean }
): SyncReport {
  const force = options.force ?? false;
  const report: SyncReport = { targetDir, added: [], updated: [], removed: [], unchanged: [], skipped: [] };
  mkdirSync(targetDir, { recursive: true });
  const manifest = readManifest(targetDir);
  const nextManifest: SkillsManifest = { kitVersion: options.kitVersion, skills: {} };

  const removeIfUnchanged = (key: string, filePath: string, recordedHash: string) => {
    if (!existsSync(filePath)) return;
    const symlinkComponent = symlinkOnPath(targetDir, filePath);
    if (symlinkComponent !== null) {
      report.skipped.push({ path: key, reason: 'is a symbolic link; not followed' });
      return;
    }
    if (force || sha256File(filePath) === recordedHash) {
      rmSync(filePath);
      report.removed.push(key);
    } else {
      report.skipped.push({ path: key, reason: 'modified locally; left in place and no longer managed' });
    }
  };

  const sourceSkills = listSourceSkills(sourceDir);
  for (const skill of sourceSkills) {
    const managed = manifest.skills[skill];
    const targetSkillDir = path.join(targetDir, skill);

    // R1': Check if skill dir is a symlink before touching it
    if (existsSync(targetSkillDir) && symlinkOnPath(targetDir, targetSkillDir) !== null) {
      if (managed) {
        report.skipped.push({ path: skill, reason: 'is a symbolic link; not followed' });
        nextManifest.skills[skill] = managed;
      } else {
        report.skipped.push({ path: skill, reason: 'is a symbolic link; not followed' });
      }
      continue;
    }

    // R2/R3: Handle unmanaged skills - adopt if identical, otherwise skip (never force-override)
    if (!managed && existsSync(targetSkillDir)) {
      if (isIdenticalUnmanagedSkill(path.join(sourceDir, skill), targetSkillDir, targetDir)) {
        // Adopt the identical skill - proceed normally (will add missing files)
      } else {
        report.skipped.push({ path: skill, reason: 'exists and is not managed by frontend-agent-kit (remove or rename it to install the kit version)' });
        continue;
      }
    }

    const entry: Record<string, string> = {};
    const sourceFiles = listFilesRecursive(path.join(sourceDir, skill));
    for (const rel of sourceFiles) {
      const key = `${skill}/${rel}`;
      const src = path.join(sourceDir, skill, rel);
      const dst = path.join(targetSkillDir, rel);
      const srcHash = sha256File(src);

      if (!existsSync(dst)) {
        // R1': Check if any path component is a symlink before creating
        const dstParent = path.dirname(dst);
        const symlinkComponent = symlinkOnPath(targetDir, dst);
        if (symlinkComponent !== null) {
          report.skipped.push({ path: key, reason: 'is a symbolic link; not followed' });
          if (managed) entry[rel] = managed[rel] ?? srcHash;
          continue;
        }
        mkdirSync(dstParent, { recursive: true });
        copyFileSync(src, dst);
        report.added.push(key);
        entry[rel] = srcHash;
        continue;
      }

      // R1': Check if any path component is a symlink before reading/writing
      const symlinkComponent = symlinkOnPath(targetDir, dst);
      if (symlinkComponent !== null) {
        report.skipped.push({ path: key, reason: 'is a symbolic link; not followed' });
        if (managed) entry[rel] = managed[rel] ?? srcHash;
        continue;
      }

      const dstHash = sha256File(dst);
      if (dstHash === srcHash) {
        report.unchanged.push(key);
        entry[rel] = srcHash;
        continue;
      }
      const recorded = managed?.[rel];
      if (force || (recorded !== undefined && recorded === dstHash)) {
        copyFileSync(src, dst);
        report.updated.push(key);
        entry[rel] = srcHash;
      } else {
        report.skipped.push({ path: key, reason: 'modified locally since the last install' });
        if (recorded !== undefined) entry[rel] = recorded;
      }
    }

    for (const [rel, recordedHash] of Object.entries(managed ?? {})) {
      if (!sourceFiles.includes(rel)) {
        const prevSkippedCount = report.skipped.length;
        removeIfUnchanged(`${skill}/${rel}`, path.join(targetSkillDir, rel), recordedHash);
        // If the file was skipped (symlink or local edit), keep it in the manifest
        if (report.skipped.length > prevSkippedCount) {
          entry[rel] = recordedHash;
        }
      }
    }
    if (existsSync(targetSkillDir) && symlinkOnPath(targetDir, targetSkillDir) === null) {
      for (const child of readdirSync(targetSkillDir, { withFileTypes: true })) {
        if (child.isDirectory()) {
          pruneEmptyDirs(path.join(targetSkillDir, child.name), targetDir);
        }
      }
    }
    nextManifest.skills[skill] = entry;
  }

  for (const [skill, files] of Object.entries(manifest.skills)) {
    if (sourceSkills.includes(skill)) continue;
    const targetSkillDir = path.join(targetDir, skill);
    // R1': Don't touch symlinked skill dirs
    if (symlinkOnPath(targetDir, targetSkillDir) !== null) {
      for (const [rel] of Object.entries(files)) {
        report.skipped.push({ path: `${skill}/${rel}`, reason: 'is a symbolic link; not followed' });
      }
      continue;
    }
    for (const [rel, recordedHash] of Object.entries(files)) {
      removeIfUnchanged(`${skill}/${rel}`, path.join(targetSkillDir, rel), recordedHash);
    }
    pruneEmptyDirs(targetSkillDir, targetDir);
  }

  const manifestPath = path.join(targetDir, MANIFEST_FILE);
  assertManifestNotSymlink(manifestPath);
  writeFileSync(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`);
  return report;
}

import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import { detectBaseBranch, headSha, isGitRepo, runGit } from './git.js';
import { classifyPath } from './repo-index.js';
import { findSecret } from './secrets.js';

export type Severity = 'error' | 'warning' | 'info';
export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';

export interface DiffFile {
  path: string;
  status: FileStatus;
  oldPath?: string;
}

export interface DiffFinding {
  id: string;
  severity: Severity;
  message: string;
  files?: string[];
}

export interface DiffReview {
  base: string;
  files: DiffFile[];
  findings: DiffFinding[];
  truncated: boolean;
}

const MAX_FILES = 500;
const MAX_PATCH_BYTES = 2 * 1024 * 1024;
const MAX_UNTRACKED_SCANNED = 100;
const MAX_UNTRACKED_BYTES = 256 * 1024;
const MANY_FILES = 25;
const MAX_LISTED = 10;

const MANIFEST_RE = /(?:^|\/)(?:package\.json|requirements[^/]*\.txt|pyproject\.toml|Pipfile|setup\.py|composer\.json|Gemfile|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(?:\.kts)?|[^/]+\.(?:csproj|fsproj|vbproj))$/;
const LOCKFILE_RE = /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock|packages\.lock\.json|Cargo\.lock|go\.sum)$/;
const GENERATED_RE = /(?:^|\/)(?:node_modules|dist|build|target|bin|obj|vendor|__pycache__|\.next|\.nuxt|\.venv|coverage)\//;
const BINARY_RE = /\.(?:pyc|class|jar|dll|exe|so|o|zip|tar|gz|png|jpe?g|gif|ico|pdf|min\.js|min\.css)$/i;
const SOURCE_ROLES = new Set(['route', 'controller', 'service', 'repository', 'model', 'component']);

const STATUS: Record<string, FileStatus> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'added', T: 'modified' };

function listed(paths: string[]): string[] {
  return paths.slice(0, MAX_LISTED);
}

function isCommit(root: string, rev: string): boolean {
  return runGit(root, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]).ok;
}

/** The commit to compare against: an explicit base, else the base branch (local, then origin/) merged with HEAD. */
function resolveBase(root: string, base: string | undefined, baseBranch: string | undefined): { rev: string; missing?: string } {
  if (base !== undefined) {
    if (base.startsWith('-') || !isCommit(root, base)) throw new Error(`"${base}" is not a commit`);
    return { rev: mergeBase(root, base) };
  }
  const branch = detectBaseBranch(root, baseBranch);
  if (!branch || branch.startsWith('-')) return { rev: 'HEAD' };
  for (const candidate of [branch, `origin/${branch}`]) {
    if (!isCommit(root, candidate)) continue;
    const mb = runGit(root, ['merge-base', candidate, 'HEAD']);
    if (mb.ok && mb.stdout.trim()) return { rev: mb.stdout.trim() };
  }
  return { rev: 'HEAD', missing: branch };
}

function mergeBase(root: string, base: string): string {
  const mb = runGit(root, ['merge-base', base, 'HEAD']);
  return mb.ok && mb.stdout.trim() ? mb.stdout.trim() : base;
}

function unquote(p: string): string {
  if (!p.startsWith('"') || !p.endsWith('"')) return p;
  return p.slice(1, -1).replace(/\\(["\\])/g, '$1');
}

/** Labels of secrets found in added lines, per file. Values are never kept. */
function scanPatch(patch: string): Map<string, Set<string>> {
  const hits = new Map<string, Set<string>>();
  let file = '';
  let inHeader = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      inHeader = true;
      file = '';
    } else if (inHeader) {
      if (line.startsWith('+++ ')) {
        const target = line.slice(4).replace(/\r$/, '').replace(/\t.*$/, '');
        file = target === '/dev/null' ? '' : unquote(target).replace(/^b\//, '');
      } else if (line.startsWith('@@')) inHeader = false;
    } else if (line.startsWith('+') && file) {
      const label = findLineSecret(line.slice(1));
      if (label) (hits.get(file) ?? hits.set(file, new Set()).get(file)!).add(label);
    }
  }
  return hits;
}

const SCAN_WINDOW = 2048;
const MAX_WINDOWS = 32;
const LITERAL_ASSIGNMENT_RE = /\b(?:password|passwd|secret|token|api[_-]?key)\w*\s*[:=]\s*['"][^'"\s]{8,}['"]/i;

/** Label of a secret in one line. Long lines are scanned in bounded windows; plain credential-named code is not a secret. */
function findLineSecret(line: string): string | null {
  for (let i = 0, n = 0; i < line.length && n < MAX_WINDOWS; i += SCAN_WINDOW, n++) {
    const label = findSecret(line.slice(i, i + SCAN_WINDOW));
    if (label === null) continue;
    if (label !== 'credential assignment') return label;
    if (LITERAL_ASSIGNMENT_RE.test(line.slice(i, i + SCAN_WINDOW))) return label;
  }
  return null;
}

const MIGRATION_EXT_RE = /\.(?:py|sql|cs|java|kt|rb|php|js|ts|mjs|cjs|xml|ya?ml)$/i;
const MIGRATION_NAME_RE = /^(?:\d|[VvUuRr]\d)|migration/i;

/** A shipped, immutable migration: a code or SQL file in a migrations directory with a migration-style name. */
function isMigration(p: string): boolean {
  if (classifyPath(p) !== 'migration') return false;
  const name = p.slice(p.lastIndexOf('/') + 1);
  return MIGRATION_EXT_RE.test(name) && MIGRATION_NAME_RE.test(name) && !/snapshot|lock|_journal/i.test(name);
}

function readCapped(file: string): string | null {
  let fd: number | undefined;
  try {
    if (!lstatSync(file).isFile()) return null;
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile()) return null;
    const buffer = Buffer.alloc(Math.min(stat.size, MAX_UNTRACKED_BYTES));
    readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.includes(0) ? null : buffer.toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function reviewDiff(root: string, opts: { base?: string; baseBranch?: string } = {}): DiffReview {
  if (!isGitRepo(root)) throw new Error(`${root} is not a git repository`);
  if (headSha(root) === null) throw new Error('diff review needs a repository with at least one commit');
  const { rev: base, missing } = resolveBase(root, opts.base, opts.baseBranch);

  const files: DiffFile[] = [];
  const tokens = runGit(root, ['diff', '--relative', '--name-status', '-z', '-M', '--no-color', '--no-ext-diff', base, '--']).stdout.split('\0');
  for (let i = 0; i < tokens.length; ) {
    const code = tokens[i++];
    if (!code) continue;
    const kind = code[0];
    if (kind === 'R' || kind === 'C') {
      const oldPath = tokens[i++];
      const newPath = tokens[i++];
      if (newPath) files.push({ path: newPath, status: STATUS[kind], ...(kind === 'R' ? { oldPath } : {}) });
    } else {
      const p = tokens[i++];
      if (p) files.push({ path: p, status: STATUS[kind] ?? 'modified' });
    }
  }
  const untracked = runGit(root, ['ls-files', '-z', '--others', '--exclude-standard']).stdout.split('\0').filter(Boolean);
  for (const p of untracked) files.push({ path: p, status: 'untracked' });

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const truncated = files.length > MAX_FILES;
  if (truncated) files.length = MAX_FILES;

  const findings: DiffFinding[] = [];
  const add = (id: string, severity: Severity, message: string, paths?: string[]): void => {
    findings.push({ id, severity, message, ...(paths?.length ? { files: listed(paths) } : {}) });
  };
  if (missing) add('base-not-found', 'warning', `Base branch "${missing}" was not found locally or on origin; only changes since HEAD were reviewed.`);
  if (truncated) add('truncated', 'info', `More than ${MAX_FILES} files changed; only the first ${MAX_FILES} (by path) were reviewed.`);
  if (files.length === 0) {
    add('empty-diff', 'info', 'No changes against the base.');
    return { base, files, findings, truncated };
  }

  const patchRaw = runGit(root, ['-c', 'core.quotePath=false', 'diff', '--relative', '--src-prefix=a/', '--dst-prefix=b/', '-U0', '--no-color', '--no-ext-diff', '--no-textconv', '-M', base, '--']).stdout;
  const patch = patchRaw.length > MAX_PATCH_BYTES ? patchRaw.slice(0, MAX_PATCH_BYTES) : patchRaw;
  if (patch !== patchRaw) add('patch-truncated', 'info', 'The diff is very large; secrets were scanned only in its first 2 MB.');
  const hits = scanPatch(patch);
  const listedPaths = new Set(files.map((f) => f.path));
  for (const p of untracked.filter((u) => listedPaths.has(u)).slice(0, MAX_UNTRACKED_SCANNED)) {
    const text = readCapped(path.join(root, p));
    if (text === null) continue;
    for (const line of text.split('\n')) {
      const label = findLineSecret(line);
      if (label) (hits.get(p) ?? hits.set(p, new Set()).get(p)!).add(label);
    }
  }
  if (hits.size > 0) {
    const detail = [...hits].map(([file, labels]) => `${file} (${[...labels].join(', ')})`);
    add('secret-in-diff', 'error', `Added lines look like secrets: ${listed(detail).join('; ')}. Values are not shown; remove and rotate them.`, [...hits.keys()]);
  }

  const paths = (pred: (f: DiffFile) => boolean): string[] => files.filter(pred).map((f) => f.path);
  const edited = files.filter((f) => f.status !== 'added' && f.status !== 'untracked' && (isMigration(f.path) || (f.oldPath !== undefined && isMigration(f.oldPath))));
  if (edited.length) add('migration-edited', 'error', 'Shipped migrations were edited, deleted or renamed; add a new migration instead.', edited.map((f) => f.oldPath ?? f.path));
  const addedMigrations = paths((f) => (f.status === 'added' || f.status === 'untracked') && isMigration(f.path));
  if (addedMigrations.length) add('migration-added', 'info', 'New migrations: check they are reversible and match the model changes.', addedMigrations);

  const manifests = paths((f) => MANIFEST_RE.test(f.path));
  const locks = paths((f) => LOCKFILE_RE.test(f.path));
  if (manifests.length) add('dependencies-changed', 'warning', 'Dependency manifests changed; confirm every new dependency is intended.', [...manifests, ...locks]);
  else if (locks.length) add('lockfile-only', 'warning', 'A lockfile changed without its manifest; this is usually accidental.', locks);

  const sources = paths((f) => f.status !== 'deleted' && SOURCE_ROLES.has(classifyPath(f.path)));
  const tests = files.some((f) => f.status !== 'deleted' && classifyPath(f.path) === 'test');
  if (sources.length && !tests) add('no-tests', 'warning', 'Source files changed but no test file was added or changed.', sources);

  const generated = paths((f) => GENERATED_RE.test(f.path) || BINARY_RE.test(f.path));
  if (generated.length) add('generated-or-binary', 'warning', 'Generated, vendored or binary files are part of the change; they usually should not be committed.', generated);

  const known = new Set(runGit(root, ['ls-tree', '-d', '--name-only', '-z', base]).stdout.split('\0').filter(Boolean));
  const fresh = new Set<string>();
  for (const f of files) {
    const top = f.path.split('/')[0];
    if (f.path.includes('/') && f.status !== 'deleted' && !known.has(top)) fresh.add(top);
  }
  if (fresh.size) add('new-top-level-dir', 'info', 'New top-level directories: check they follow the repository layout.', [...fresh]);
  if (files.length > MANY_FILES) add('many-files', 'info', `${files.length} files changed; consider splitting the change.`);
  return { base, files, findings, truncated };
}

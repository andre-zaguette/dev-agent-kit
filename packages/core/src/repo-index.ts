import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { headSha, isGitRepo, runGit } from './git.js';
import { detectProjectProfile, type ProjectProfile } from './project-profile.js';

export type Role = 'test' | 'migration' | 'route' | 'controller' | 'service' | 'repository' | 'model' | 'schema' | 'component' | 'config' | 'other';

export interface IndexedFile {
  path: string;
  role: Role;
}

export interface Feature {
  name: string;
  files: IndexedFile[];
  roles: Role[];
}

export interface RepoIndex {
  profile: ProjectProfile;
  headSha: string | null;
  fileCount: number;
  truncated: boolean;
  topDirs: Array<{ name: string; files: number }>;
  extensions: Array<{ ext: string; files: number }>;
  roles: Partial<Record<Role, string[]>>;
  features: Feature[];
  conventions: { fileNaming: 'kebab-case' | 'snake_case' | 'camelCase' | 'PascalCase' | 'mixed' | 'unknown'; testSuffix?: string; testDirs: string[] };
}

const DEFAULT_MAX_FILES = 20_000;
const DEFAULT_MAX_DIRS = 20_000;
const MAX_DEPTH = 8;
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'target', 'bin', 'obj', 'vendor', '.venv', 'venv', '__pycache__', '.next', '.nuxt', '.output',
  '.svelte-kit', 'out', 'coverage', '.dev-agent', '.worktrees', '.idea', '.vscode', '.gradle', '.cache', 'tmp', 'log'
]);
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'e2e']);
const UI_EXT = new Set(['tsx', 'jsx', 'vue', 'svelte']);
const ROLE_DIRS = new Set([
  'controllers', 'controller', 'handlers', 'views', 'services', 'service', 'usecases', 'actions', 'repositories', 'repository', 'dao', 'models', 'model',
  'entities', 'entity', 'schemas', 'dto', 'dtos', 'serializers', 'routes', 'route', 'router', 'routers', 'migrations', 'migrate', 'migration', 'config',
  'settings', 'components', 'pages', 'db', 'database', 'layouts', 'hooks'
]);
const GENERIC_DIRS = new Set([
  'src', 'app', 'apps', 'lib', 'main', 'java', 'kotlin', 'resources', 'com', 'org', 'net', 'io', 'web', 'api', 'http', 'public', 'internal', 'domain',
  'utils', 'util', 'helpers', 'common', 'shared', 'types', 'constants', 'base', 'core', 'example', 'examples', ...TEST_DIRS, ...ROLE_DIRS
]);
const ROLE_WORDS = new Set(['controller', 'service', 'repository', 'model', 'dto', 'schema', 'test', 'tests', 'spec', 'request', 'response', 'entity', 'handler', 'view', 'views', 'serializer', 'routes', 'urls', 'migration', 'settings', 'config']);
const GENERIC_STEMS = new Set(['index', 'main', 'app', 'utils', 'util', 'helpers', 'common', 'base', 'types', 'constants', 'init', '__init__']);
const MAX_FEATURES = 60;
const MAX_FILES_PER_FEATURE = 15;
const MAX_ROLE_EXAMPLES = 12;

const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1);
const extOf = (file: string): string => (file.lastIndexOf('.') > 0 ? file.slice(file.lastIndexOf('.') + 1) : '');
const stemOf = (file: string): string => (file.lastIndexOf('.') > 0 ? file.slice(0, file.lastIndexOf('.')) : file);

const NON_CODE_EXT = new Set(['md', 'mdx', 'txt', 'rst', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'pdf', 'lock', 'csv', 'woff', 'woff2', 'ttf', 'mp4', 'zip']);

export function classifyPath(relPath: string): Role {
  const lower = relPath.toLowerCase();
  const segs = lower.split('/');
  const file = segs[segs.length - 1];
  const dirs = segs.slice(0, -1);
  const stem = stemOf(file);
  const ext = extOf(file);
  if (NON_CODE_EXT.has(ext)) return 'other';

  if (
    dirs.some((d) => TEST_DIRS.has(d) || d.endsWith('.tests') || d.endsWith('.test')) ||
    file.includes('.test.') || file.includes('.spec.') || /_test\.[^.]+$/.test(file) || file.endsWith('_spec.rb') ||
    /tests?\.(java|kt|php)$/.test(file) || file.endsWith('tests.cs') || file.startsWith('test_')
  ) return 'test';
  if (dirs.includes('migrations') || dirs.includes('migrate') || dirs.includes('migration')) return 'migration';
  if (dirs.some((d) => d === 'routes' || d === 'route' || d === 'router' || d === 'routers') || stem === 'routes' || stem === 'urls' || stem === 'router') return 'route';
  if (UI_EXT.has(ext) && dirs.some((d) => d === 'components' || d === 'pages' || d === 'views' || d === 'layouts')) return 'component';
  if (dirs.some((d) => d === 'controllers' || d === 'controller' || d === 'handlers' || d === 'views') || stem.includes('controller') || stem.includes('handler') || stem === 'views') return 'controller';
  if (dirs.some((d) => d === 'services' || d === 'service' || d === 'usecases' || d === 'actions') || stem.endsWith('service') || stem.endsWith('usecase')) return 'service';
  if (dirs.some((d) => d === 'repositories' || d === 'repository' || d === 'dao') || stem.endsWith('repository') || stem.endsWith('dao')) return 'repository';
  if (dirs.some((d) => d === 'models' || d === 'entities' || d === 'entity') || stem === 'models' || stem.endsWith('entity') || stem.endsWith('model')) return 'model';
  if (dirs.some((d) => d === 'schemas' || d === 'dto' || d === 'dtos' || d === 'serializers') || stem === 'serializers' || /(dto|schema|serializer|request)$/.test(stem)) return 'schema';
  if (dirs.some((d) => d === 'config' || d === 'settings') || stem === 'settings' || stem === 'config') return 'config';
  return 'other';
}

function singular(word: string): string {
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && !word.endsWith('is') ? word.slice(0, -1) : word;
}

/** Split on non-alphanumerics and camelCase boundaries, lower-cased. */
function words(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

export function featureKey(relPath: string): string | null {
  const segs = relPath.split('/');
  const dirs = segs.slice(0, -1);
  for (let i = dirs.length - 1; i >= 0; i--) {
    const dir = dirs[i].toLowerCase();
    if (dir.length > 0 && !GENERIC_DIRS.has(dir) && !dir.endsWith('.tests') && !dir.endsWith('.test') && !dir.startsWith('.')) return singular(dir);
  }
  const file = segs[segs.length - 1];
  const stem = stemOf(file);
  if (GENERIC_STEMS.has(stem.toLowerCase())) return null;
  const token = words(stem).find((w) => !ROLE_WORDS.has(w) && w.length >= 3 && !GENERIC_STEMS.has(w));
  return token ? singular(token) : null;
}

function namingStyle(stem: string): 'kebab-case' | 'snake_case' | 'camelCase' | 'PascalCase' | null {
  const s = stem.replace(/^_+|_+$/g, '');
  if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(s)) return 'kebab-case';
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(s)) return 'snake_case';
  if (/^[a-z][a-z0-9]*([A-Z][a-z0-9]*)+$/.test(s)) return 'camelCase';
  if (/^[A-Z][a-z0-9]+([A-Z][a-z0-9]*)*$/.test(s) && /[a-z]/.test(s)) return /[A-Z].*[A-Z]/.test(s) ? 'PascalCase' : null;
  return null;
}

function testSuffixOf(file: string): string | null {
  const ext = extOf(file);
  if (/\.test\.[^.]+$/.test(file)) return `.test.${ext}`;
  if (/\.spec\.[^.]+$/.test(file)) return `.spec.${ext}`;
  if (/_test\.[^.]+$/.test(file)) return `_test.${ext}`;
  if (file.endsWith('_spec.rb')) return '_spec.rb';
  const m = file.match(/(Tests?)\.(java|kt|php|cs)$/);
  if (m) return `${m[1]}.${m[2]}`;
  if (file.startsWith('test_')) return `test_*.${ext}`;
  return null;
}

function tally(values: string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** Files git tracks or would track (ignored ones excluded), as repo-relative paths; null outside a git repository. */
function gitFileList(root: string): string[] | null {
  if (!isGitRepo(root)) return null;
  const result = runGit(root, ['-c', 'core.quotePath=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate']);
  return result.ok ? result.stdout.split('\0').filter(Boolean).sort() : null;
}

function underExcluded(rel: string, exclude: string[]): boolean {
  return exclude.some((e) => rel === e || rel.startsWith(`${e}/`));
}

/** A bounded, path-only map of the repository: it never opens a file. Inside git, ignored files are left out. */
export function indexRepository(root: string, opts: { maxFiles?: number; maxDirs?: number; exclude?: string[] } = {}): RepoIndex {
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const maxDirs = opts.maxDirs ?? DEFAULT_MAX_DIRS;
  const exclude = (opts.exclude ?? []).map((e) => e.replace(/^\.?\/+|\/+$/g, '')).filter(Boolean);
  const files: IndexedFile[] = [];
  let truncated = false;

  const listed = gitFileList(root);
  if (listed !== null) {
    for (const rel of listed) {
      const segs = rel.split('/');
      if (segs.length - 1 > MAX_DEPTH || segs.slice(0, -1).some((d) => SKIP_DIRS.has(d)) || underExcluded(rel, exclude)) continue;
      try {
        if (!lstatSync(path.join(root, rel)).isFile()) continue;
      } catch {
        continue;
      }
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }
      files.push({ path: rel, role: classifyPath(rel) });
    }
  } else {
    const queue: Array<{ rel: string; depth: number }> = [{ rel: '', depth: 0 }];
    for (let head = 0; head < queue.length && !truncated; head++) {
      const { rel, depth } = queue[head];
      let entries;
      try {
        entries = readdirSync(path.join(root, rel), { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) {
          if (depth < MAX_DEPTH && !SKIP_DIRS.has(entry.name) && !underExcluded(childRel, exclude)) {
            if (queue.length >= maxDirs) {
              truncated = true;
              break;
            }
            queue.push({ rel: childRel, depth: depth + 1 });
          }
        } else if (entry.isFile()) {
          if (files.length >= maxFiles) {
            truncated = true;
            break;
          }
          files.push({ path: childRel, role: classifyPath(childRel) });
        }
      }
    }
  }

  const topDirs = tally(files.filter((f) => f.path.includes('/')).map((f) => f.path.slice(0, f.path.indexOf('/'))))
    .slice(0, 15)
    .map(([name, count]) => ({ name, files: count }));
  const extensions = tally(files.map((f) => extOf(baseName(f.path))).filter(Boolean))
    .slice(0, 8)
    .map(([ext, count]) => ({ ext, files: count }));

  const roles: Partial<Record<Role, string[]>> = {};
  for (const role of ['test', 'migration', 'route', 'controller', 'service', 'repository', 'model', 'schema', 'component', 'config'] as Role[]) {
    const ofRole = files.filter((f) => f.role === role);
    if (ofRole.length === 0) continue;
    const examples = tally(ofRole.map((f) => (f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : f.path)))
      .slice(0, MAX_ROLE_EXAMPLES)
      .map(([p]) => p);
    roles[role] = examples;
  }

  const byFeature = new Map<string, IndexedFile[]>();
  for (const file of files) {
    if (file.role === 'config') continue;
    const key = featureKey(file.path);
    if (key === null) continue;
    (byFeature.get(key) ?? byFeature.set(key, []).get(key)!).push(file);
  }
  const features: Feature[] = [];
  for (const [name, list] of byFeature) {
    const distinct = [...new Set(list.map((f) => f.role).filter((r) => r !== 'other'))].sort();
    if (!((list.length >= 2 && distinct.length >= 2) || list.length >= 3)) continue;
    features.push({ name, files: list.slice(0, MAX_FILES_PER_FEATURE), roles: distinct });
  }
  features.sort((a, b) => b.roles.length - a.roles.length || b.files.length - a.files.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  features.length = Math.min(features.length, MAX_FEATURES);

  const styles = files
    .filter((f) => f.role !== 'migration' && f.role !== 'config')
    .map((f) => namingStyle(stemOf(baseName(f.path))))
    .filter((s): s is NonNullable<typeof s> => s !== null);
  const styleTally = tally(styles);
  const fileNaming: RepoIndex['conventions']['fileNaming'] =
    styles.length < 5 ? 'unknown' : styleTally[0][1] / styles.length >= 0.7 ? (styleTally[0][0] as RepoIndex['conventions']['fileNaming']) : 'mixed';

  const testFiles = files.filter((f) => f.role === 'test');
  const suffixTally = tally(testFiles.map((f) => testSuffixOf(baseName(f.path))).filter((s): s is string => s !== null));
  const testSuffix = suffixTally.length > 0 && suffixTally[0][1] >= 2 ? suffixTally[0][0] : undefined;
  const testDirs = tally(
    testFiles
      .map((f) => {
        const segs = f.path.split('/');
        const at = segs.findIndex((s, i) => i < segs.length - 1 && (TEST_DIRS.has(s.toLowerCase()) || s.toLowerCase().endsWith('.tests')));
        return at === -1 ? null : segs.slice(0, at + 1).join('/');
      })
      .filter((d): d is string => d !== null)
  )
    .slice(0, 5)
    .map(([d]) => d);

  return {
    profile: detectProjectProfile(root),
    headSha: headSha(root),
    fileCount: files.length,
    truncated,
    topDirs,
    extensions,
    roles,
    features,
    conventions: { fileNaming, ...(testSuffix ? { testSuffix } : {}), testDirs }
  };
}

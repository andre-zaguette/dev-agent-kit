import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { detectBaseBranch, isGitRepo } from './git.js';

export interface ProjectProfile {
  languages: string[];
  frameworks: string[];
  packageManager?: string;
  testCommands: string[];
  lintCommands: string[];
  typecheckCommands: string[];
  database?: string;
  migrationTool?: string;
  queue?: string;
  docker: boolean;
  baseBranch?: string;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  packageManager?: string;
}

type Category = 'test' | 'lint' | 'typecheck';

const SCRIPT_NAMES: Record<Category, string[]> = {
  test: ['test'],
  lint: ['lint'],
  typecheck: ['typecheck', 'type-check']
};
const PYTHON_TOOL_COMMANDS: Record<Category, Array<[string, string]>> = {
  test: [['pytest', 'pytest']],
  lint: [['ruff', 'ruff check .']],
  typecheck: [['mypy', 'mypy .']]
};
const NODE_FRAMEWORKS: Array<[string, string]> = [
  ['react', 'react'],
  ['next', 'next'],
  ['vue', 'vue'],
  ['nuxt', 'nuxt'],
  ['@angular/core', 'angular'],
  ['@nestjs/core', 'nestjs'],
  ['express', 'express'],
  ['tailwindcss', 'tailwind']
];
const PYTHON_FRAMEWORKS: Array<[string, string]> = [
  ['django', 'django'],
  ['djangorestframework', 'drf'],
  ['fastapi', 'fastapi']
];
const NODE_PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'];
const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

function read(root: string, rel: string): string | null {
  try {
    return readFileSync(path.join(root, rel), 'utf8');
  } catch {
    return null;
  }
}

const has = (root: string, rel: string): boolean => existsSync(path.join(root, rel));

function readPackageJson(root: string): PackageJson | null {
  const text = read(root, 'package.json');
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as PackageJson) : null;
  } catch {
    return null;
  }
}

/** True when `name` appears in `text` as a whole requirement name (django-cors-headers is not django). */
function mentions(text: string, name: string): boolean {
  return new RegExp(`(^|[^a-z0-9_-])${name}([^a-z0-9_-]|$)`).test(text);
}

function detectPackageManager(root: string, pkg: PackageJson | null): string | undefined {
  const declared = typeof pkg?.packageManager === 'string' ? pkg.packageManager.split('@')[0] : undefined;
  if (declared && NODE_PACKAGE_MANAGERS.includes(declared)) return declared;
  if (has(root, 'pnpm-lock.yaml')) return 'pnpm';
  if (has(root, 'yarn.lock')) return 'yarn';
  if (has(root, 'bun.lockb') || has(root, 'bun.lock')) return 'bun';
  if (has(root, 'package-lock.json')) return 'npm';
  if (has(root, 'poetry.lock')) return 'poetry';
  if (has(root, 'uv.lock')) return 'uv';
  return pkg ? 'npm' : undefined;
}

function scriptCommand(pm: string, name: string): string {
  if (pm === 'npm') return name === 'test' ? 'npm test' : `npm run ${name}`;
  if (pm === 'bun') return `bun run ${name}`;
  return `${pm} ${name}`;
}

function makeTargets(root: string): Set<string> {
  const targets = new Set<string>();
  for (const match of (read(root, 'Makefile') ?? '').matchAll(/^([A-Za-z0-9_-]+):/gm)) targets.add(`make ${match[1]}`);
  for (const match of (read(root, 'Taskfile.yml') ?? '').matchAll(/^ {2}([A-Za-z0-9_-]+):/gm)) targets.add(`task ${match[1]}`);
  return targets;
}

export function detectProjectProfile(root: string): ProjectProfile {
  const pkg = readPackageJson(root);
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const pyText = `${read(root, 'pyproject.toml') ?? ''}\n${read(root, 'requirements.txt') ?? ''}`.toLowerCase();
  const isPython = has(root, 'pyproject.toml') || has(root, 'requirements.txt') || has(root, 'manage.py') || has(root, 'setup.py');
  const compose = COMPOSE_FILES.map((f) => read(root, f) ?? '').join('\n').toLowerCase();

  const languages: string[] = [];
  if (pkg) languages.push(has(root, 'tsconfig.json') || 'typescript' in deps ? 'typescript' : 'javascript');
  if (isPython) languages.push('python');
  if (has(root, 'composer.json')) languages.push('php');

  const frameworks = NODE_FRAMEWORKS.filter(([dep]) => dep in deps).map(([, name]) => name);
  for (const [requirement, name] of PYTHON_FRAMEWORKS) if (mentions(pyText, requirement)) frameworks.push(name);
  if (has(root, 'manage.py') && !frameworks.includes('django')) frameworks.push('django');

  const packageManager = detectPackageManager(root, pkg);
  const nodePm = packageManager && NODE_PACKAGE_MANAGERS.includes(packageManager) ? packageManager : 'npm';
  const targets = makeTargets(root);
  const commandsFor = (category: Category): string[] => {
    const fromScripts = SCRIPT_NAMES[category].filter((name) => typeof pkg?.scripts?.[name] === 'string').map((name) => scriptCommand(nodePm, name));
    if (fromScripts.length > 0) return fromScripts;
    const fromTargets = SCRIPT_NAMES[category].flatMap((name) => [`make ${name}`, `task ${name}`]).filter((command) => targets.has(command));
    if (fromTargets.length > 0) return fromTargets;
    return PYTHON_TOOL_COMMANDS[category].filter(([tool]) => mentions(pyText, tool)).map(([, command]) => command);
  };

  const profile: ProjectProfile = {
    languages,
    frameworks,
    testCommands: commandsFor('test'),
    lintCommands: commandsFor('lint'),
    typecheckCommands: commandsFor('typecheck'),
    docker: has(root, 'Dockerfile') || COMPOSE_FILES.some((f) => has(root, f))
  };
  if (packageManager) profile.packageManager = packageManager;

  const prismaProvider = read(root, 'prisma/schema.prisma')?.match(/provider\s*=\s*"(postgresql|mysql|sqlite|sqlserver|mongodb)"/)?.[1];
  const composeDb = compose.match(/image:\s*["']?(postgres|mysql|mariadb)/)?.[1];
  const database =
    prismaProvider ??
    ('pg' in deps || 'postgres' in deps ? 'postgresql' : undefined) ??
    ('mysql2' in deps || 'mysql' in deps ? 'mysql' : undefined) ??
    ('sqlite3' in deps || 'better-sqlite3' in deps ? 'sqlite' : undefined) ??
    (mentions(pyText, 'psycopg2-binary') || mentions(pyText, 'psycopg2') || mentions(pyText, 'psycopg') ? 'postgresql' : undefined) ??
    (composeDb === 'postgres' ? 'postgresql' : composeDb === 'mariadb' ? 'mysql' : composeDb);
  if (database) profile.database = database;

  const migrationTool = has(root, 'alembic.ini') ? 'alembic' : has(root, 'prisma') ? 'prisma' : frameworks.includes('django') ? 'django' : undefined;
  if (migrationTool) profile.migrationTool = migrationTool;

  const queue = /image:\s*["']?rabbitmq/.test(compose) ? 'rabbitmq' : mentions(pyText, 'celery') ? 'celery' : 'bullmq' in deps ? 'bullmq' : undefined;
  if (queue) profile.queue = queue;

  if (isGitRepo(root)) {
    const baseBranch = detectBaseBranch(root);
    if (baseBranch) profile.baseBranch = baseBranch;
  }
  return profile;
}

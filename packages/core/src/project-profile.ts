import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
  queues?: string[];
  cache?: string;
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
  ['fastapi', 'fastapi'],
  ['flask', 'flask']
];
const NODE_PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'];
const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

const MAX_READ_CHARS = 1_000_000;

function read(root: string, rel: string): string | null {
  try {
    const text = readFileSync(path.join(root, rel), 'utf8');
    return text.length > MAX_READ_CHARS ? text.slice(0, MAX_READ_CHARS) : text;
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


interface Extra {
  languages: string[];
  frameworks: string[];
  packageManager?: string;
  test: string[];
  lint: string[];
  typecheck: string[];
  database?: string;
  migrationTool?: string;
  queues: string[];
  cache?: string;
}

const gem = (text: string, name: string): boolean => new RegExp(`^\\s*gem\\s+['"]${name}['"]`, 'm').test(text);
const SKIP_SCAN = new Set(['node_modules', '.git', 'bin', 'obj', 'target', 'build', 'dist', 'vendor']);
const MAX_SCAN_ENTRIES = 50;

/** *.sln / *.csproj in the root and one level below (bounded; skips build and dependency directories). */
function dotnetProjectFiles(root: string): string[] {
  const found: string[] = [];
  const collect = (dir: string, depth: number): void => {
    let entries;
    try {
      entries = readdirSync(path.join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.slice(0, MAX_SCAN_ENTRIES)) {
      const rel = dir === '' ? entry.name : `${dir}/${entry.name}`;
      if (entry.isFile() && (entry.name.endsWith('.sln') || entry.name.endsWith('.csproj'))) found.push(rel);
      else if (depth === 0 && entry.isDirectory() && !entry.name.startsWith('.') && !SKIP_SCAN.has(entry.name)) collect(rel, 1);
    }
  };
  collect('', 0);
  return found;
}

function detectExtra(root: string): Extra {
  const extra: Extra = { languages: [], frameworks: [], test: [], lint: [], typecheck: [], queues: [] };
  const queue = (name: string) => extra.queues.includes(name) || extra.queues.push(name);

  // PHP
  const composerText = read(root, 'composer.json');
  if (composerText !== null) {
    let composer: { require?: Record<string, string>; 'require-dev'?: Record<string, string>; scripts?: Record<string, unknown> } = {};
    try {
      const value: unknown = JSON.parse(composerText);
      if (value && typeof value === 'object' && !Array.isArray(value)) composer = value as typeof composer;
    } catch {
      // an unreadable manifest still means a PHP project
    }
    const deps: Record<string, string> = { ...composer.require, ...composer['require-dev'] };
    extra.languages.push('php');
    extra.packageManager = 'composer';
    if ('laravel/framework' in deps) {
      extra.frameworks.push('laravel');
      extra.migrationTool = 'laravel';
    }
    if ('symfony/framework-bundle' in deps || 'symfony/symfony' in deps) extra.frameworks.push('symfony');
    const script = (name: string): boolean => composer.scripts !== undefined && Object.hasOwn(composer.scripts, name);
    if (script('test')) extra.test.push('composer test');
    else if ('phpunit/phpunit' in deps) extra.test.push('vendor/bin/phpunit');
    if (script('lint')) extra.lint.push('composer lint');
    else if ('laravel/pint' in deps) extra.lint.push('vendor/bin/pint --test');
    if (script('analyse')) extra.typecheck.push('composer analyse');
    else if ('phpstan/phpstan' in deps) extra.typecheck.push('vendor/bin/phpstan analyse');
    const env = read(root, '.env.example') ?? read(root, '.env') ?? '';
    const conn = env.match(/^DB_CONNECTION=(\w+)/m)?.[1];
    if (conn === 'pgsql') extra.database = 'postgresql';
    else if (conn === 'mysql' || conn === 'mariadb') extra.database = 'mysql';
    else if (conn === 'sqlsrv') extra.database = 'sqlserver';
    if ('php-amqplib/php-amqplib' in deps) queue('rabbitmq');
    if ('predis/predis' in deps || 'ext-redis' in deps) extra.cache = 'redis';
  }

  // C#
  const dotnet = dotnetProjectFiles(root);
  if (dotnet.length > 0) {
    extra.languages.push('csharp');
    extra.packageManager ??= 'dotnet';
    extra.test.push('dotnet test');
    extra.typecheck.push('dotnet build');
    const text = dotnet
      .filter((f) => f.endsWith('.csproj'))
      .slice(0, 20)
      .map((f) => read(root, f) ?? '')
      .join('\n');
    if (text.includes('Microsoft.NET.Sdk.Web') || text.includes('Microsoft.AspNetCore')) extra.frameworks.push('aspnetcore');
    if (text.includes('Npgsql')) extra.database = 'postgresql';
    else if (text.includes('Pomelo.EntityFrameworkCore.MySql') || text.includes('MySql.Data')) extra.database = 'mysql';
    else if (text.includes('Microsoft.EntityFrameworkCore.SqlServer') || text.includes('System.Data.SqlClient') || text.includes('Microsoft.Data.SqlClient')) extra.database = 'sqlserver';
    if (text.includes('Microsoft.EntityFrameworkCore')) extra.migrationTool = 'efcore';
    if (text.includes('RabbitMQ.Client')) queue('rabbitmq');
    if (text.includes('StackExchange.Redis')) extra.cache = 'redis';
  }

  // Java
  const pom = read(root, 'pom.xml');
  const gradle = read(root, 'build.gradle') ?? read(root, 'build.gradle.kts');
  if (pom !== null || gradle !== null) {
    extra.languages.push('java');
    const text = `${pom ?? ''}\n${gradle ?? ''}`.toLowerCase();
    if (pom !== null) {
      extra.packageManager ??= 'maven';
      extra.test.push('mvn test');
    } else {
      extra.packageManager ??= 'gradle';
      extra.test.push(has(root, 'gradlew') ? './gradlew test' : 'gradle test');
    }
    if (text.includes('spring-boot')) extra.frameworks.push('spring');
    if (text.includes('postgresql')) extra.database = 'postgresql';
    else if (text.includes('mysql-connector') || text.includes('mariadb-java-client')) extra.database = 'mysql';
    else if (text.includes('mssql-jdbc')) extra.database = 'sqlserver';
    if (text.includes('flyway')) extra.migrationTool = 'flyway';
    else if (text.includes('liquibase')) extra.migrationTool = 'liquibase';
    if (text.includes('spring-boot-starter-amqp')) queue('rabbitmq');
    if (text.includes('spring-boot-starter-data-redis') || text.includes('jedis') || text.includes('lettuce')) extra.cache = 'redis';
  }

  // Ruby
  const gemfile = read(root, 'Gemfile');
  if (gemfile !== null) {
    extra.languages.push('ruby');
    extra.packageManager ??= 'bundler';
    if (gem(gemfile, 'rails')) {
      extra.frameworks.push('rails');
      extra.migrationTool = 'rails';
    }
    if (gem(gemfile, 'rspec-rails') || gem(gemfile, 'rspec')) extra.test.push('bundle exec rspec');
    else if (extra.frameworks.includes('rails')) extra.test.push('bin/rails test');
    if (gem(gemfile, 'rubocop')) extra.lint.push('bundle exec rubocop');
    if (gem(gemfile, 'pg')) extra.database = 'postgresql';
    else if (gem(gemfile, 'mysql2')) extra.database = 'mysql';
    if (gem(gemfile, 'bunny')) queue('rabbitmq');
    if (gem(gemfile, 'redis') || gem(gemfile, 'sidekiq')) extra.cache = 'redis';
  }
  return extra;
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
  const extra = detectExtra(root);
  for (const language of extra.languages) if (!languages.includes(language)) languages.push(language);

  const frameworks = NODE_FRAMEWORKS.filter(([dep]) => dep in deps).map(([, name]) => name);
  for (const [requirement, name] of PYTHON_FRAMEWORKS) if (mentions(pyText, requirement)) frameworks.push(name);
  if (has(root, 'manage.py') && !frameworks.includes('django')) frameworks.push('django');
  for (const framework of extra.frameworks) if (!frameworks.includes(framework)) frameworks.push(framework);

  const packageManager = detectPackageManager(root, pkg) ?? extra.packageManager;
  const nodePm = packageManager && NODE_PACKAGE_MANAGERS.includes(packageManager) ? packageManager : 'npm';
  const targets = makeTargets(root);
  const commandsFor = (category: Category): string[] => {
    const fromScripts = SCRIPT_NAMES[category].filter((name) => typeof pkg?.scripts?.[name] === 'string').map((name) => scriptCommand(nodePm, name));
    if (fromScripts.length > 0) return fromScripts;
    const fromTargets = SCRIPT_NAMES[category].flatMap((name) => [`make ${name}`, `task ${name}`]).filter((command) => targets.has(command));
    if (fromTargets.length > 0) return fromTargets;
    const fromPython = PYTHON_TOOL_COMMANDS[category].filter(([tool]) => mentions(pyText, tool)).map(([, command]) => command);
    return fromPython.length > 0 ? fromPython : extra[category === 'test' ? 'test' : category === 'lint' ? 'lint' : 'typecheck'];
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
    extra.database ??
    (composeDb === 'postgres' ? 'postgresql' : composeDb === 'mariadb' ? 'mysql' : composeDb);
  if (database) profile.database = database;

  const migrationTool = has(root, 'alembic.ini') ? 'alembic' : has(root, 'prisma') ? 'prisma' : frameworks.includes('django') ? 'django' : extra.migrationTool;
  if (migrationTool) profile.migrationTool = migrationTool;

  const queues = [
    /image:\s*["']?rabbitmq/.test(compose) || mentions(pyText, 'pika') || mentions(pyText, 'aio-pika') || 'amqplib' in deps || 'amqp-connection-manager' in deps ? 'rabbitmq' : undefined,
    mentions(pyText, 'celery') ? 'celery' : undefined,
    'bullmq' in deps ? 'bullmq' : undefined
  ].filter((q): q is string => q !== undefined);
  for (const q of extra.queues) if (!queues.includes(q)) queues.push(q);
  if (queues.length > 0) {
    profile.queue = queues[0];
    profile.queues = queues;
  }

  const cache = /image:\s*["']?redis/.test(compose) || 'redis' in deps || 'ioredis' in deps || 'bullmq' in deps || mentions(pyText, 'redis') || mentions(pyText, 'django-redis') || extra.cache === 'redis' ? 'redis' : undefined;
  if (cache) profile.cache = cache;

  if (isGitRepo(root)) {
    const baseBranch = detectBaseBranch(root);
    if (baseBranch) profile.baseBranch = baseBranch;
  }
  return profile;
}

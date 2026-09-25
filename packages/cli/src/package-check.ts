import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Files a working installed copy needs. */
export const REQUIRED_PACKED = [
  'LICENSE',
  'bin/dev-agent.mjs',
  'bin/frontend-agent.mjs',
  'integrations/claude/CLAUDE.md',
  'integrations/codex/AGENTS.md',
  'skills/figma-to-code/SKILL.md',
  'packages/cli/package.json',
  'packages/cli/bin/dev-agent.mjs',
  'packages/cli/bin/frontend-agent.mjs',
  'packages/cli/src/dev-index.ts',
  'packages/core/src/index.ts',
  'packages/mcp-server/src/index.ts'
];

const FORBIDDEN: Array<[RegExp, string]> = [
  [/(^|\/)tests?\//, 'test files'],
  [/(^|\/)evals\//, 'evals'],
  [/(^|\/)\.worktrees\//, 'worktrees'],
  [/(^|\/)docs\/superpowers\//, 'planning documents'],
  [/(^|\/)\.env(\.|$)/, 'environment files'],
  [/(^|\/)\.dev-agent\//, 'local task state'],
  [/(^|\/)\.frontend-agent\//, 'local kit state'],
  [/\.pyc$/, 'bytecode'],
  [/(^|\/)node_modules\//, 'node_modules']
];

export function checkPackedFiles(paths: string[]): string[] {
  const problems: string[] = [];
  const have = new Set(paths);
  for (const required of REQUIRED_PACKED) if (!have.has(required)) problems.push(`missing required file ${required}`);
  for (const file of paths) {
    const hit = FORBIDDEN.find(([re]) => re.test(file));
    if (hit) problems.push(`forbidden ${hit[1]} in the package: ${file}`);
  }
  return problems;
}

type Manifest = { name?: string; version?: string; private?: boolean; bin?: Record<string, string>; files?: string[]; dependencies?: Record<string, string> };

function readManifest(file: string): Manifest {
  return JSON.parse(readFileSync(file, 'utf8')) as Manifest;
}

/** Problems that would make the root package unpublishable or inconsistent with its workspaces. */
export function checkManifest(root: string): string[] {
  const problems: string[] = [];
  const pkg = readManifest(path.join(root, 'package.json'));
  if (pkg.private) problems.push('root package.json is private');
  for (const [name, target] of Object.entries(pkg.bin ?? {})) {
    if (!existsSync(path.join(root, target))) problems.push(`bin ${name} points to missing file ${target}`);
  }
  for (const entry of pkg.files ?? []) {
    if (!/[*]/.test(entry) && !existsSync(path.join(root, entry))) problems.push(`files entry ${entry} does not exist`);
  }
  const packagesDir = path.join(root, 'packages');
  const workspaces = existsSync(packagesDir) ? readdirSync(packagesDir).filter((d) => existsSync(path.join(packagesDir, d, 'package.json'))) : [];
  for (const dir of workspaces) {
    const ws = readManifest(path.join(packagesDir, dir, 'package.json'));
    if (ws.version !== pkg.version) problems.push(`workspace ${dir} has version ${ws.version}, the root has ${pkg.version}`);
    if (dir === 'evals') continue; // benchmarks are development tooling and do not ship
    for (const [dep, range] of Object.entries(ws.dependencies ?? {})) {
      if (pkg.dependencies?.[dep] !== range) problems.push(`dependency ${dep}@${range} of packages/${dir} is not declared in the root package`);
    }
  }
  return problems;
}

const BUILTINS = new Set(['fs', 'path', 'os', 'url', 'util', 'child_process', 'crypto', 'http', 'https', 'net', 'stream', 'events', 'assert', 'module', 'readline', 'zlib', 'buffer', 'process', 'timers', 'worker_threads']);
const IMPORT_RES = [
  /(?:^|\n)[ \t]*(?:import|export)\s+(?:type\s+)?[\w*{}\s,$]+?\s+from\s*(['"])([^'"\n]+)\1/g,
  /\bimport\s*\(\s*(['"])([^'"\n]+)\1/g,
  /(?:^|\n)[ \t]*import\s+(['"])([^'"\n]+)\1/g
];

function packageOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** Runtime imports of the packed sources that would fail once installed: relative targets that are not packed, bare packages that are not root dependencies. */
export function checkImports(root: string, packed: string[]): string[] {
  const problems = new Set<string>();
  const have = new Set(packed);
  const pkg = readManifest(path.join(root, 'package.json'));
  const isRuntimeSource = (f: string): boolean => /^(bin\/.*\.mjs|packages\/[^/]+\/(src|bin)\/.*\.(ts|mjs))$/.test(f);
  for (const file of packed.filter(isRuntimeSource)) {
    const text = readFileSync(path.join(root, file), 'utf8');
    for (const match of IMPORT_RES.flatMap((re) => [...text.matchAll(re)])) {
      const specifier = match[2];
      if (specifier.startsWith('node:') || BUILTINS.has(specifier)) continue;
      if (specifier.startsWith('.')) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
        const candidates = [target, target.replace(/\.js$/, '.ts'), target.replace(/\.js$/, '.mjs')];
        if (!candidates.some((c) => have.has(c))) problems.add(`${file} imports ${specifier}, which is not in the package`);
      } else if (!(packageOf(specifier) in (pkg.dependencies ?? {}))) {
        problems.add(`${file} imports ${packageOf(specifier)}, which is not a dependency of the root package`);
      }
    }
    for (const match of text.matchAll(/new URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[2]));
      if (!have.has(target)) problems.add(`${file} refers to ${match[2]}, which is not in the package`);
    }
  }
  return [...problems];
}

/** Every skill directory in the repository must ship with its SKILL.md. */
export function checkSkillsPacked(root: string, packed: string[]): string[] {
  const have = new Set(packed);
  const dir = path.join(root, 'skills');
  if (!existsSync(dir)) return ['skills/ does not exist'];
  return readdirSync(dir)
    .filter((name) => existsSync(path.join(dir, name, 'SKILL.md')) && !have.has(`skills/${name}/SKILL.md`))
    .map((name) => `skill ${name} is not in the package`);
}

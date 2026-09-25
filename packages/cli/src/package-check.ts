import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Files a working installed copy needs. */
export const REQUIRED_PACKED = [
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

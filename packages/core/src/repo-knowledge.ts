import { existsSync } from 'node:fs';
import path from 'node:path';
import { redactSecrets } from './secrets.js';
import type { RepoIndex, Role } from './repo-index.js';
import { DEFAULT_KNOWLEDGE_DIR, knowledgePath, readKnowledgeIn, writeKnowledge, type KnowledgeName } from './repo-memory.js';

const MAX_BODY = 6000;
const BACKEND_FRAMEWORKS = ['django', 'drf', 'fastapi', 'flask', 'nestjs', 'express', 'laravel', 'symfony', 'aspnetcore', 'spring', 'rails'];
const FRONTEND_FRAMEWORKS = ['react', 'vue', 'nuxt', 'next', 'angular', 'tailwind'];
const ROLE_ORDER: Role[] = ['route', 'controller', 'service', 'repository', 'model', 'schema', 'component', 'migration', 'test', 'config'];

const cap = (text: string): string => (text.length > MAX_BODY ? `${text.slice(0, MAX_BODY - 2)}\n…` : text);
const list = (items: string[] | undefined): string => (items && items.length > 0 ? items.join(', ') : '-');

function repository(index: RepoIndex): string {
  const p = index.profile;
  const lines = [
    '# Repository',
    '',
    `- Languages: ${list(p.languages)}`,
    `- Frameworks: ${list(p.frameworks)}`,
    `- Package manager: ${p.packageManager ?? '-'}`,
    `- Database: ${p.database ?? '-'}${p.migrationTool ? ` (migrations: ${p.migrationTool})` : ''}`,
    `- Queues: ${list(p.queues)}`,
    `- Cache: ${p.cache ?? '-'}`,
    `- Docker: ${p.docker ? 'yes' : 'no'}`,
    `- Files indexed: ${index.fileCount}${index.truncated ? ' (truncated)' : ''}`,
    '',
    '## Top directories',
    ...(index.topDirs.length > 0 ? index.topDirs.map((d) => `- ${d.name}/ (${d.files} files)`) : ['- none']),
    '',
    '## File types',
    ...(index.extensions.length > 0 ? index.extensions.map((e) => `- .${e.ext} (${e.files})`) : ['- none'])
  ];
  return cap(lines.join('\n'));
}

function commands(index: RepoIndex): string {
  const p = index.profile;
  const row = (label: string, items: string[]): string => `- ${label}: ${items.length > 0 ? items.join(', ') : 'none detected'}`;
  return cap(['# Commands', '', 'Taken from the repository manifests and scripts; verify before relying on them.', '', `- Ecosystems: ${list(p.languages)}`, row('test', p.testCommands), row('lint', p.lintCommands), row('typecheck', p.typecheckCommands)].join('\n'));
}

function architecture(index: RepoIndex): string {
  const lines = ['# Architecture', '', '## Layers (role: example directories)'];
  const present = ROLE_ORDER.filter((r) => index.roles[r]);
  if (present.length === 0) lines.push('- none recognized');
  for (const role of present) lines.push(`- ${role}: ${index.roles[role]!.slice(0, 6).join(', ')}`);
  lines.push('', '## Features (name — roles — examples)');
  if (index.features.length === 0) lines.push('- none recognized');
  for (const f of index.features.slice(0, 12)) lines.push(`- ${f.name} — ${f.roles.join(', ')} — ${f.files.slice(0, 4).map((x) => x.path).join(', ')}`);
  lines.push('', '## Conventions', `- File naming: ${index.conventions.fileNaming}`, `- Test file suffix: ${index.conventions.testSuffix ?? 'not consistent'}`, `- Test directories: ${list(index.conventions.testDirs)}`);
  return cap(lines.join('\n'));
}

function backend(index: RepoIndex): string {
  const p = index.profile;
  const lines = ['# Backend', '', `- Frameworks: ${list(p.frameworks.filter((f) => BACKEND_FRAMEWORKS.includes(f)))}`, `- Database: ${p.database ?? '-'}`, `- Migration tool: ${p.migrationTool ?? '-'}`, `- Migration directories: ${list(index.roles.migration)}`, `- Queues: ${list(p.queues)}`, `- Cache: ${p.cache ?? '-'}`, '', '## Layers present'];
  for (const role of ['route', 'controller', 'service', 'repository', 'model', 'schema'] as Role[]) if (index.roles[role]) lines.push(`- ${role}: ${index.roles[role]!.slice(0, 6).join(', ')}`);
  lines.push('', `Follow the closest existing feature (\`dev-agent repo similar <words>\`) and add a new migration instead of editing a shipped one.`);
  return cap(lines.join('\n'));
}

function frontend(index: RepoIndex): string {
  const p = index.profile;
  const lines = ['# Frontend', '', `- Frameworks: ${list(p.frameworks.filter((f) => FRONTEND_FRAMEWORKS.includes(f)))}`, `- Component directories: ${list(index.roles.component)}`, `- File naming: ${index.conventions.fileNaming}`, `- Test file suffix: ${index.conventions.testSuffix ?? 'not consistent'}`];
  return cap(lines.join('\n'));
}

/** Markdown bodies for the knowledge files a repository index supports. Paths, counts and profile values only. */
export function renderKnowledge(index: RepoIndex): Partial<Record<KnowledgeName, string>> {
  const out: Partial<Record<KnowledgeName, string>> = { repository: repository(index), commands: commands(index), architecture: architecture(index) };
  const p = index.profile;
  if (p.frameworks.some((f) => BACKEND_FRAMEWORKS.includes(f)) || p.queues !== undefined || p.database !== undefined) out.backend = backend(index);
  if (p.frameworks.some((f) => FRONTEND_FRAMEWORKS.includes(f))) out.frontend = frontend(index);
  return out;
}

export const GENERATED_MARKER = '<!-- generated by dev-agent repo index: regenerated on every run, edits are lost -->';

/** Write the rendered knowledge, stamped with HEAD. Generated files are regenerated; a file someone wrote by hand is never touched. */
export function writeRepoKnowledge(
  root: string,
  index: RepoIndex,
  knowledgeDir: string = DEFAULT_KNOWLEDGE_DIR
): { written: KnowledgeName[]; skipped: KnowledgeName[]; sourceSha: string } {
  if (index.headSha === null) throw new Error('repo index --write needs a git repository with at least one commit');
  const written: KnowledgeName[] = [];
  const skipped: KnowledgeName[] = [];
  for (const [name, body] of Object.entries(renderKnowledge(index)) as Array<[KnowledgeName, string]>) {
    const existing = readKnowledgeIn(root, knowledgeDir, name);
    if ((existing === null && existsSync(path.join(root, knowledgePath(knowledgeDir, name)))) || (existing !== null && !existing.body.includes(GENERATED_MARKER))) {
      skipped.push(name);
      continue;
    }
    writeKnowledge(root, name, `${GENERATED_MARKER}\n\n${redactSecrets(body)}`, { sourceSha: index.headSha }, knowledgeDir);
    written.push(name);
  }
  return { written, skipped, sourceSha: index.headSha };
}

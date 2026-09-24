import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { changedSince, headSha } from './git.js';

export const KNOWLEDGE_NAMES = ['repository', 'architecture', 'frontend', 'backend', 'commands'] as const;
export type KnowledgeName = (typeof KNOWLEDGE_NAMES)[number];

export interface KnowledgeDoc {
  name: KnowledgeName;
  sourceSha: string;
  updatedAt: string;
  body: string;
}

export type Freshness = { state: 'fresh' } | { state: 'stale'; changedFiles: string[] } | { state: 'unknown'; reason: string };

const SHA_RE = /^[0-9a-f]{7,40}$/;
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bghp_[A-Za-z0-9]{20,}/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, 'GitHub token'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'API key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*['"]?[^\s'"]{8,}/i, 'credential assignment']
];

/** Label of the first secret-looking pattern in `text`, or null. */
export function findSecret(text: string): string | null {
  for (const [pattern, label] of SECRET_PATTERNS) if (pattern.test(text)) return label;
  return null;
}

export function knowledgePath(knowledgeDir: string, name: string): string {
  if (!(KNOWLEDGE_NAMES as readonly string[]).includes(name)) throw new Error(`unknown knowledge file "${name}"`);
  return path.join(knowledgeDir, `${name}.md`);
}

function assertNotSymlink(target: string): void {
  try {
    if (lstatSync(target).isSymbolicLink()) throw new Error(`refusing to write through a symbolic link: ${target}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export function writeKnowledge(knowledgeDir: string, name: KnowledgeName, body: string, meta: { sourceSha: string; updatedAt?: string }): string {
  const file = knowledgePath(knowledgeDir, name);
  if (!SHA_RE.test(meta.sourceSha)) throw new Error(`invalid sourceSha "${meta.sourceSha}"`);
  const secret = findSecret(body);
  if (secret) throw new Error(`refusing to write ${name}.md: the body looks like it contains a secret (${secret})`);
  assertNotSymlink(knowledgeDir);
  assertNotSymlink(file);
  mkdirSync(knowledgeDir, { recursive: true });
  const updatedAt = meta.updatedAt ?? new Date().toISOString();
  writeFileSync(file, `---\nsourceSha: ${meta.sourceSha}\nupdatedAt: ${updatedAt}\n---\n\n${body.trim()}\n`);
  return file;
}

export function readKnowledge(knowledgeDir: string, name: KnowledgeName): KnowledgeDoc | null {
  let text: string;
  try {
    text = readFileSync(knowledgePath(knowledgeDir, name), 'utf8');
  } catch {
    return null;
  }
  const match = text.match(/^---\nsourceSha: ([0-9a-f]{7,40})\nupdatedAt: (\S+)\n---\n\n?([\s\S]*)$/);
  if (!match) return null;
  return { name, sourceSha: match[1], updatedAt: match[2], body: match[3].trim() };
}

/** Compare a knowledge file's source commit with the repository's HEAD. Never reports fresh on doubt. */
export function checkFreshness(root: string, doc: KnowledgeDoc): Freshness {
  const head = headSha(root);
  if (head === null) return { state: 'unknown', reason: 'not a git repository or no commits' };
  if (head.startsWith(doc.sourceSha) || doc.sourceSha.startsWith(head)) return { state: 'fresh' };
  const changed = changedSince(root, doc.sourceSha);
  if (changed === null) return { state: 'unknown', reason: `source commit ${doc.sourceSha} is not in this history` };
  return changed.length === 0 ? { state: 'fresh' } : { state: 'stale', changedFiles: changed };
}

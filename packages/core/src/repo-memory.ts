import { readFileSync } from 'node:fs';
import path from 'node:path';
import { changedSince, headSha } from './git.js';
import { safeReadFile, safeWriteFile } from './safe-fs.js';

export { findSecret } from './secrets.js';

export const DEFAULT_KNOWLEDGE_DIR = '.dev-agent/knowledge';

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

export function knowledgePath(knowledgeDir: string, name: string): string {
  if (!(KNOWLEDGE_NAMES as readonly string[]).includes(name)) throw new Error(`unknown knowledge file "${name}"`);
  return path.join(knowledgeDir, `${name}.md`);
}

export function writeKnowledge(
  root: string,
  name: KnowledgeName,
  body: string,
  meta: { sourceSha: string; updatedAt?: string },
  knowledgeDir = DEFAULT_KNOWLEDGE_DIR
): string {
  const relFile = knowledgePath(knowledgeDir, name);
  if (!SHA_RE.test(meta.sourceSha)) throw new Error(`invalid sourceSha "${meta.sourceSha}"`);
  const updatedAt = meta.updatedAt ?? new Date().toISOString();
  return safeWriteFile(root, relFile, `---\nsourceSha: ${meta.sourceSha}\nupdatedAt: ${updatedAt}\n---\n\n${body.trim()}\n`);
}

function parseKnowledge(name: KnowledgeName, text: string): KnowledgeDoc | null {
  const match = text.match(/^---\nsourceSha: ([0-9a-f]{7,40})\nupdatedAt: (\S+)\n---\n\n?([\s\S]*)$/);
  if (!match) return null;
  return { name, sourceSha: match[1], updatedAt: match[2], body: match[3].trim() };
}

export function readKnowledge(knowledgeDir: string, name: KnowledgeName): KnowledgeDoc | null {
  let text: string;
  try {
    text = readFileSync(knowledgePath(knowledgeDir, name), 'utf8');
  } catch {
    return null;
  }
  return parseKnowledge(name, text);
}

/** Like readKnowledge, but `knowledgeDir` is relative to `root` and the read refuses symlinks and escapes. Throws on those; null when missing. */
export function readKnowledgeIn(root: string, knowledgeDir: string, name: KnowledgeName): KnowledgeDoc | null {
  const text = safeReadFile(root, knowledgePath(knowledgeDir, name));
  return text === null ? null : parseKnowledge(name, text);
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

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { KNOWLEDGE_NAMES, checkFreshness, readKnowledge } from './repo-memory.js';

export const MAX_INSTRUCTION_TOKENS = 1500;
export const MAX_SKILL_TOKENS = 2500;
const MIN_DUPLICATE_CHARS = 80;
const FRAMEWORK_RE = /\b(react|vue|nuxt|next\.js|angular|django|fastapi|nestjs|laravel|tailwind)\b/gi;
const MIN_FRAMEWORKS_FOR_FINDING = 3;

export type FindingKind = 'large-instruction-file' | 'duplicate-content' | 'framework-knowledge' | 'oversized-skill' | 'stale-knowledge';

export interface ContextFinding {
  kind: FindingKind;
  path: string;
  detail: string;
  removableTokens: number;
}

export interface ContextAuditReport {
  findings: ContextFinding[];
  alwaysOnTokens: number;
  /** Upper bound: findings can overlap (e.g. an oversized file's excess, framework lines and duplicates), so this sum may exceed what can actually be removed. */
  removableTokens: number;
}

interface Source {
  file: string;
  text: string;
  kind: 'instruction' | 'skill';
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function readIfFile(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function collectSources(root: string): Source[] {
  const sources: Source[] = [];
  const seenReal = new Set<string>();
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    const file = path.join(root, name);
    if (!existsSync(file)) continue;
    const real = realpathSync(file);
    if (seenReal.has(real)) continue;
    seenReal.add(real);
    const text = readIfFile(file);
    if (text !== null) sources.push({ file: name, text, kind: 'instruction' });
  }
  const seenSkills = new Set<string>();
  for (const skillsDir of ['.claude/skills', '.agents/skills']) {
    let entries: string[];
    try {
      entries = readdirSync(path.join(root, skillsDir), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      continue;
    }
    for (const skillName of entries.sort()) {
      if (seenSkills.has(skillName)) continue;
      const rel = `${skillsDir}/${skillName}/SKILL.md`;
      const text = readIfFile(path.join(root, rel));
      if (text === null) continue;
      seenSkills.add(skillName);
      sources.push({ file: rel, text, kind: 'skill' });
    }
  }
  return sources;
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length >= MIN_DUPLICATE_CHARS);
}

export function auditContext(root: string): ContextAuditReport {
  const findings: ContextFinding[] = [];
  const sources = collectSources(root);

  const firstSeen = new Map<string, string>();
  for (const source of sources) {
    for (const paragraph of paragraphs(source.text)) {
      const earlier = firstSeen.get(paragraph);
      if (earlier === undefined) {
        firstSeen.set(paragraph, source.file);
      } else {
        findings.push({
          kind: 'duplicate-content',
          path: source.file,
          detail: `paragraph already in ${earlier}: "${paragraph.slice(0, 60)}…"`,
          removableTokens: estimateTokens(paragraph)
        });
      }
    }
  }

  for (const source of sources) {
    const tokens = estimateTokens(source.text);
    if (source.kind === 'instruction') {
      if (tokens > MAX_INSTRUCTION_TOKENS) {
        findings.push({
          kind: 'large-instruction-file',
          path: source.file,
          detail: `~${tokens} tokens always loaded (limit ${MAX_INSTRUCTION_TOKENS}); move detail into skills`,
          removableTokens: tokens - MAX_INSTRUCTION_TOKENS
        });
      }
      const names = new Set([...source.text.matchAll(FRAMEWORK_RE)].map((m) => m[1].toLowerCase()));
      if (names.size >= MIN_FRAMEWORKS_FOR_FINDING) {
        const frameworkLines = source.text.split('\n').filter((line) => new RegExp(FRAMEWORK_RE.source, 'i').test(line));
        findings.push({
          kind: 'framework-knowledge',
          path: source.file,
          detail: `names ${[...names].sort().join(', ')}; load framework detail lazily from skills/references`,
          removableTokens: estimateTokens(frameworkLines.join('\n'))
        });
      }
    } else if (tokens > MAX_SKILL_TOKENS) {
      findings.push({
        kind: 'oversized-skill',
        path: source.file,
        detail: `~${tokens} tokens (limit ${MAX_SKILL_TOKENS}); move detail into references/`,
        removableTokens: tokens - MAX_SKILL_TOKENS
      });
    }
  }

  const knowledgeDir = path.join(root, '.dev-agent', 'knowledge');
  for (const name of KNOWLEDGE_NAMES) {
    const rel = `.dev-agent/knowledge/${name}.md`;
    if (!existsSync(path.join(knowledgeDir, `${name}.md`))) continue;
    const doc = readKnowledge(knowledgeDir, name);
    if (!doc) {
      findings.push({ kind: 'stale-knowledge', path: rel, detail: 'missing or malformed sourceSha frontmatter; regenerate', removableTokens: 0 });
      continue;
    }
    const freshness = checkFreshness(root, doc);
    if (freshness.state === 'stale') {
      findings.push({
        kind: 'stale-knowledge',
        path: rel,
        detail: `${freshness.changedFiles.length} file(s) changed since ${doc.sourceSha}; revalidate the affected sections`,
        removableTokens: estimateTokens(doc.body)
      });
    } else if (freshness.state === 'unknown') {
      findings.push({ kind: 'stale-knowledge', path: rel, detail: `cannot verify freshness: ${freshness.reason}`, removableTokens: estimateTokens(doc.body) });
    }
  }

  return {
    findings,
    alwaysOnTokens: sources.filter((s) => s.kind === 'instruction').reduce((sum, s) => sum + estimateTokens(s.text), 0),
    removableTokens: findings.reduce((sum, f) => sum + f.removableTokens, 0)
  };
}

export function formatAuditReport(report: ContextAuditReport): string {
  const lines = [`context audit — always-on: ~${report.alwaysOnTokens} tokens`];
  if (report.findings.length === 0) {
    lines.push('no findings');
  } else {
    for (const f of report.findings) lines.push(`  [${f.kind}] ${f.path} — ${f.detail} (~${f.removableTokens} tokens)`);
    lines.push(`removable: up to ~${report.removableTokens} tokens (findings may overlap)`);
  }
  return lines.join('\n');
}

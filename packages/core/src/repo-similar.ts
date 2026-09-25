import type { Feature, IndexedFile, RepoIndex, Role } from './repo-index.js';

export interface SimilarFeature {
  name: string;
  score: number;
  reason: 'name-match' | 'path-match' | 'most-complete';
  files: IndexedFile[];
  roles: Role[];
}

const MAX_QUERY_CHARS = 200;
const MAX_TOKENS = 20;
const MIN_ROLES_FOR_FALLBACK = 3;
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'add', 'new', 'create', 'make', 'endpoint', 'feature', 'that', 'this', 'from', 'into', 'use', 'using', 'implement', 'fix', 'update',
  'para', 'com', 'uma', 'que', 'dos', 'das', 'como'
]);

function singular(word: string): string {
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && !word.endsWith('is') ? word.slice(0, -1) : word;
}

function tokenize(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.slice(0, MAX_QUERY_CHARS).toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    const token = singular(match[0]);
    if (token.length >= 3 && !STOPWORDS.has(token)) seen.add(token);
    if (seen.size >= MAX_TOKENS) break;
  }
  return [...seen];
}

function pathWords(path: string): string[] {
  return path
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => singular(w.toLowerCase()));
}

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function toSimilar(feature: Feature, score: number, reason: SimilarFeature['reason']): SimilarFeature {
  return { name: feature.name, score, reason, files: feature.files, roles: feature.roles };
}

/** The existing features closest to a change, by name and by path words; a most-complete fallback when nothing matches. */
export function findSimilar(index: RepoIndex, query: string, limit = 3): SimilarFeature[] {
  const candidates = index.features.filter((f) => f.files.length >= 2);
  const tokens = tokenize(query);

  const scored: SimilarFeature[] = [];
  for (const feature of candidates) {
    const nameWords = new Set(pathWords(feature.name));
    const paths = new Set(feature.files.flatMap((f) => pathWords(f.path)));
    let score = 0;
    let named = false;
    for (const token of tokens) {
      if (nameWords.has(token)) {
        score += 3;
        named = true;
      } else if (paths.has(token)) {
        score += 1;
      }
    }
    if (score >= 1) scored.push(toSimilar(feature, Math.round((score + 0.1 * feature.roles.length) * 100) / 100, named ? 'name-match' : 'path-match'));
  }
  if (scored.length > 0) {
    return scored.sort((a, b) => b.score - a.score || b.files.length - a.files.length || byName(a.name, b.name)).slice(0, limit);
  }

  return candidates
    .filter((f) => f.roles.length >= MIN_ROLES_FOR_FALLBACK)
    .sort((a, b) => b.roles.length - a.roles.length || b.files.length - a.files.length || byName(a.name, b.name))
    .slice(0, limit)
    .map((f) => toSimilar(f, 0, 'most-complete'));
}

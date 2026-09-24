const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const NAME_RE = /^[A-Za-z0-9._/-]+$/;
const NON_TOPIC_RE = /^(?:main|master|develop|development|staging|production|HEAD)$|^(?:release|hotfix|dependabot|renovate)\//;
const MIN_TOPIC_BRANCHES = 3;
const DOMINANT_SHARE = 0.7;

export const DEFAULT_BRANCH_PATTERN = '{type}/{keyLower}-{slug}';
export type BranchType = 'feat' | 'fix' | 'chore' | 'docs' | 'refactor';

export function slugify(title: string, maxLength = 40): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug === '') return 'task';
  if (slug.length <= maxLength) return slug;
  const cut = slug.slice(0, maxLength);
  const lastDash = cut.lastIndexOf('-');
  return (lastDash > 10 ? cut.slice(0, lastDash) : cut).replace(/-+$/, '');
}

export function branchTypeFor(workItemType: string | undefined, classification: string | undefined): BranchType {
  const type = (workItemType ?? '').toLowerCase();
  if (/\b(?:bug|defect|incident|hotfix|fix)\b/.test(type)) return 'fix';
  if (/\bdoc(?:s|umentation)?\b/.test(type)) return 'docs';
  if (/\brefactor/.test(type)) return 'refactor';
  if (classification === 'infrastructure' || /\b(?:chore|maintenance|tech[- ]?debt)\b/.test(type)) return 'chore';
  return 'feat';
}

/** Throws unless `name` is a branch name this kit is willing to hand to git. */
export function assertBranchName(name: string): void {
  const bad =
    !NAME_RE.test(name) || name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock') || name.includes('..') || name.includes('//') || name.includes('/.');
  if (bad) throw new Error(`invalid branch name "${name.slice(0, 80)}"`);
}

export function renderBranchPattern(pattern: string, vars: { type: string; key: string; slug: string }): string {
  if (!KEY_RE.test(vars.key) || vars.key.includes('..')) throw new Error(`invalid work item key "${vars.key.slice(0, 80)}"`);
  const name = pattern.replace(/\{(\w+)\}/g, (_match, placeholder: string) => {
    switch (placeholder) {
      case 'type':
        return vars.type;
      case 'key':
        return vars.key;
      case 'keyLower':
        return vars.key.toLowerCase();
      case 'slug':
        return vars.slug;
      default:
        throw new Error(`unknown placeholder {${placeholder}} in branch pattern`);
    }
  });
  assertBranchName(name);
  return name;
}

/** A backticked pattern with placeholders on a "branch ...: `pattern`" line of an instruction file. */
export function findInstructedPattern(text: string): string | undefined {
  const match = text.match(/branch[^\n`]{0,40}[:=]\s*`([^`\n]*\{(?:key|keyLower|slug|type)\}[^`\n]*)`/i);
  return match?.[1].trim();
}

/** The pattern most remote topic branches follow, or undefined when there is no clear convention. */
export function inferPatternFromBranches(branches: string[]): string | undefined {
  const topics = branches.filter((b) => !NON_TOPIC_RE.test(b));
  if (topics.length < MIN_TOPIC_BRANCHES) return undefined;
  const shapes: Array<[RegExp, string]> = [
    [/^[a-z]+\/[a-z][a-z0-9]*-\d+-[a-z0-9-]+$/, '{type}/{keyLower}-{slug}'],
    [/^[a-z]+\/[A-Z][A-Z0-9]*-\d+-[a-z0-9-]+$/, '{type}/{key}-{slug}'],
    [/^[a-z][a-z0-9]*-\d+-[a-z0-9-]+$/, '{keyLower}-{slug}'],
    [/^[A-Z][A-Z0-9]*-\d+-[a-z0-9-]+$/, '{key}-{slug}']
  ];
  for (const [shape, pattern] of shapes) {
    if (topics.filter((b) => shape.test(b)).length / topics.length >= DOMINANT_SHARE) return pattern;
  }
  return undefined;
}

export function resolveBranchName(input: {
  key: string;
  title: string;
  workItemType?: string;
  classification?: string;
  configuredPattern?: string;
  instructionText?: string;
  remoteBranches?: string[];
}): { status: 'ok'; name: string; via: 'config' | 'instructions' | 'remote' | 'fallback' } | { status: 'ask'; reason: string } {
  const vars = { type: branchTypeFor(input.workItemType, input.classification), key: input.key, slug: slugify(input.title) };
  const ok = (pattern: string, via: 'config' | 'instructions' | 'remote' | 'fallback') => ({ status: 'ok' as const, name: renderBranchPattern(pattern, vars), via });

  if (input.configuredPattern) return ok(input.configuredPattern, 'config');
  const instructed = input.instructionText ? findInstructedPattern(input.instructionText) : undefined;
  if (instructed) return ok(instructed, 'instructions');
  const remote = input.remoteBranches ?? [];
  const inferred = inferPatternFromBranches(remote);
  if (inferred) return ok(inferred, 'remote');
  const topicCount = remote.filter((b) => !NON_TOPIC_RE.test(b)).length;
  if (topicCount >= MIN_TOPIC_BRANCHES) {
    return { status: 'ask', reason: `the ${topicCount} remote topic branches follow no consistent naming pattern; ask which convention to use (or set branchPattern in .dev-agent/config.yml)` };
  }
  return ok(DEFAULT_BRANCH_PATTERN, 'fallback');
}

import { compact, getPath, listAt, safeUrl, toText, toTextList } from './mapping.js';
import {
  NormalizationError,
  type ItemField,
  type SourceMapping,
  type WorkItem,
  type WorkItemAttachment,
  type WorkItemComment,
  type WorkItemLink,
  type WorkItemLinkType
} from './types.js';

const MAX_COMMENTS = 200;
const MAX_ATTACHMENTS = 100;
const MAX_LINKS = 100;
const BULLET_RE = /^\s*(?:[-*•]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(\S.*)$/;
// Matched on the trimmed line: every optional token is separated by a literal, so nothing backtracks.
const CRITERIA_HEADING_RE = /^(?:#{1,6}\s*)?(?:\*\*)?(?:acceptance criteria|crit[eé]rios de aceit(?:e|a[cç][aã]o))(?:\*\*)?:?(?:\*\*)?$/i;
const isCriteriaHeading = (line: string): boolean => line.length - line.trimStart().length <= 3 && CRITERIA_HEADING_RE.test(line.trim());
const LINK_TYPES: Record<string, WorkItemLinkType> = {
  parent: 'parent',
  epic: 'parent',
  child: 'child',
  children: 'child',
  subtask: 'child',
  'sub-task': 'child',
  blocks: 'blocks',
  'blocked-by': 'blocked-by',
  'is-blocked-by': 'blocked-by',
  'relates-to': 'relates-to',
  relates: 'relates-to',
  related: 'relates-to',
  duplicate: 'duplicate',
  duplicates: 'duplicate',
  'duplicate-of': 'duplicate',
  'is-duplicated-by': 'duplicate'
};

export interface RawWorkItemParts {
  item: unknown;
  comments?: unknown;
  attachments?: unknown;
  links?: unknown;
}

export interface CollectionLists {
  comments?: string;
  attachments?: string;
  links?: string;
}

/** Bullets under an "Acceptance criteria" heading. Stops at the first non-bullet line. */
export function extractAcceptanceCriteria(description: string): string[] {
  const lines = description.split(/\r?\n/);
  const start = lines.findIndex(isCriteriaHeading);
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue;
    const match = line.match(BULLET_RE);
    if (!match) break;
    out.push(match[1].trim());
  }
  return out;
}

export function normalizeLinkType(raw: string | undefined): WorkItemLinkType {
  if (raw === undefined) return 'other';
  return LINK_TYPES[raw.toLowerCase().trim().replace(/[\s_]+/g, '-')] ?? 'other';
}

const field = (mapped: Record<string, string>, name: string): string => mapped[name] ?? name;
const isObject = (entry: unknown): boolean => typeof entry === 'object' && entry !== null;

export function normalizeComments(mapping: SourceMapping, raw: unknown, listPath?: string): WorkItemComment[] {
  const m = mapping.comments;
  return listAt(raw, listPath)
    .slice(0, MAX_COMMENTS)
    .flatMap((entry) => {
      if (!isObject(entry)) return [];
      const body = toText(getPath(entry, field(m, 'body')));
      if (!body) return [];
      return [
        compact({
          id: toText(getPath(entry, field(m, 'id'))),
          author: toText(getPath(entry, field(m, 'author'))),
          body,
          createdAt: toText(getPath(entry, field(m, 'createdAt')))
        })
      ];
    });
}

export function normalizeAttachments(mapping: SourceMapping, raw: unknown, listPath?: string): WorkItemAttachment[] {
  const m = mapping.attachments;
  return listAt(raw, listPath)
    .slice(0, MAX_ATTACHMENTS)
    .flatMap((entry) => {
      if (!isObject(entry)) return [];
      const name = toText(getPath(entry, field(m, 'name')));
      if (!name) return [];
      return [
        compact({
          id: toText(getPath(entry, field(m, 'id'))) ?? name,
          name,
          mimeType: toText(getPath(entry, field(m, 'mimeType'))),
          url: safeUrl(getPath(entry, field(m, 'url')))
        })
      ];
    });
}

export function normalizeLinks(mapping: SourceMapping, raw: unknown, listPath?: string): WorkItemLink[] {
  const m = mapping.links;
  return listAt(raw, listPath)
    .slice(0, MAX_LINKS)
    .flatMap((entry) => {
      if (!isObject(entry)) return [];
      const key = toText(getPath(entry, field(m, 'key')));
      const url = safeUrl(getPath(entry, field(m, 'url')));
      if (!key && !url) return [];
      return [
        compact({
          type: normalizeLinkType(toText(getPath(entry, field(m, 'type')))),
          key,
          url,
          title: toText(getPath(entry, field(m, 'title')))
        })
      ];
    });
}

function criteriaFromString(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => (line.match(BULLET_RE)?.[1] ?? line).trim())
    .filter((line) => line !== '');
}

export function normalizeWorkItem(sourceId: string, mapping: SourceMapping, parts: RawWorkItemParts, lists: CollectionLists = {}): WorkItem {
  const raw = parts.item;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new NormalizationError('work item payload is not an object', ['item']);
  const at = (name: ItemField): unknown => (mapping.fields[name] === undefined ? undefined : getPath(raw, mapping.fields[name]!));

  const key = toText(at('key'));
  const title = toText(at('title'));
  const missing = [key === undefined ? 'key' : '', title === undefined ? 'title' : ''].filter(Boolean);
  if (key === undefined || title === undefined) throw new NormalizationError(`work item is missing required field(s): ${missing.join(', ')}`, missing);

  const description = toText(at('description')) ?? '';
  const criteriaValue = at('acceptanceCriteria');
  let criteria = Array.isArray(criteriaValue) ? toTextList(criteriaValue) : criteriaFromString(toText(criteriaValue) ?? '');
  let origin: 'field' | 'extracted' | 'unavailable' = criteria.length > 0 ? 'field' : 'unavailable';
  if (criteria.length === 0) {
    criteria = extractAcceptanceCriteria(description);
    if (criteria.length > 0) origin = 'extracted';
  }

  const labelsValue = at('labels');
  const labels = Array.isArray(labelsValue)
    ? toTextList(labelsValue)
    : (toText(labelsValue) ?? '')
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean);
  const assignee = compact({ id: toText(at('assigneeId')), name: toText(at('assigneeName')) });

  return compact({
    source: sourceId,
    id: toText(at('id')) ?? key,
    key,
    title,
    description,
    acceptanceCriteria: criteria,
    comments: normalizeComments(mapping, parts.comments, lists.comments),
    attachments: normalizeAttachments(mapping, parts.attachments, lists.attachments),
    links: normalizeLinks(mapping, parts.links, lists.links),
    status: toText(at('status')),
    type: toText(at('type')),
    priority: toText(at('priority')),
    labels: labels.length > 0 ? labels : undefined,
    assignee: Object.keys(assignee).length > 0 ? assignee : undefined,
    rawUrl: safeUrl(at('url')),
    metadata: { acceptanceCriteria: origin }
  });
}

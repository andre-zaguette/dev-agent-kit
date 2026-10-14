import { collectPages, httpJson, joinUrl, type HttpContext } from '../http.js';
import { WorkItemNotFoundError, type TaskSourceAdapter } from '../types.js';
import { buildWorkItem, makeAdapter, optional, type NativeDeps } from './common.js';

const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,19}-\d{1,9}$/;
const PAGE = 100;
const ISSUE_FIELDS = 'id,idReadable,summary,description,customFields(name,value(name,login,fullName)),tags(name),links(direction,linkType(name,sourceToTarget,targetToSource),issues(idReadable,summary)),attachments(id,name,mimeType,url)';
const COMMENT_FIELDS = 'id,text,created,author(login,fullName)';
type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** YouTrack's free-text link labels -> the vocabulary `normalizeLinkType` understands. */
const LINK_LABELS: Record<string, string> = {
  'subtask of': 'parent',
  'parent for': 'child',
  'is required for': 'blocks',
  'depends on': 'blocked-by',
  duplicates: 'duplicate',
  'is duplicated by': 'duplicate',
  'relates to': 'relates-to'
};

function fieldValue(fields: Obj[], name: string): Obj | string | undefined {
  const entry = fields.find((f) => f?.name === name);
  const value = Array.isArray(entry?.value) ? entry.value[0] : entry?.value;
  return typeof value === 'object' && value !== null ? (value as Obj) : typeof value === 'string' ? value : undefined;
}
const nameOf = (value: Obj | string | undefined): string | undefined => (typeof value === 'string' ? value : value?.name ?? value?.fullName ?? value?.login);

export function createYoutrackAdapter(deps: NativeDeps): TaskSourceAdapter {
  const { config, token } = deps;
  const base = config.baseUrl;
  if (!base) throw new Error(`source "${config.id}" needs a baseUrl`);
  const root: string = base; // narrowed copy: `load` is a hoisted declaration, so the guard above does not reach it
  const origin = new URL(base).origin;
  const ctx: HttpContext = { sourceId: config.id, fetch: deps.fetch, secrets: [token], headers: { Authorization: `Bearer ${token}` } };
  const web = (key: string): string => joinUrl(base, `/issue/${key}`);
  const absolute = (url: unknown): string | undefined => (typeof url === 'string' ? (url.startsWith('/') ? `${origin}${url}` : url) : undefined);

  async function load(identifier: string) {
    if (!KEY_RE.test(identifier)) throw new WorkItemNotFoundError(`"${identifier.slice(0, 64)}" is not a YouTrack issue id (for example PROJ-123)`);
    const issue = (await httpJson(ctx, joinUrl(root, `/api/issues/${identifier}?fields=${ISSUE_FIELDS}`))) as Obj;
    const custom = (issue.customFields ?? []) as Obj[];
    const assignee = fieldValue(custom, 'Assignee');
    const partial: string[] = [];
    const comments = await optional(
      'comments',
      partial,
      async () => {
        const { items, truncated } = await collectPages(
          async (page) => (await httpJson(ctx, joinUrl(root, `/api/issues/${identifier}/comments?fields=${COMMENT_FIELDS}&$top=${PAGE}&$skip=${page * PAGE}`))) as unknown[],
          PAGE
        );
        if (truncated) partial.push('comments');
        return items.map((c) => ({
          id: (c as Obj).id,
          author: (c as Obj).author?.fullName ?? (c as Obj).author?.login,
          body: (c as Obj).text,
          createdAt: typeof (c as Obj).created === 'number' ? new Date((c as Obj).created).toISOString() : undefined
        }));
      },
      [] as unknown[]
    );
    const links = ((issue.links ?? []) as Obj[]).flatMap((l) => {
      const t = l.linkType ?? {};
      const label = String(l.direction === 'OUTWARD' ? t.sourceToTarget : l.direction === 'INWARD' ? t.targetToSource : t.name ?? '').toLowerCase();
      return ((l.issues ?? []) as Obj[]).map((i) => ({ type: LINK_LABELS[label] ?? label, key: i.idReadable, title: i.summary, url: i.idReadable ? web(i.idReadable) : undefined }));
    });
    return buildWorkItem(config.id, {
      item: {
        id: issue.id,
        key: issue.idReadable,
        title: issue.summary,
        description: issue.description ?? '',
        status: nameOf(fieldValue(custom, 'State')),
        priority: nameOf(fieldValue(custom, 'Priority')),
        type: nameOf(fieldValue(custom, 'Type')),
        labels: ((issue.tags ?? []) as Obj[]).map((t) => t.name),
        assigneeId: typeof assignee === 'object' ? assignee?.login : undefined,
        assigneeName: nameOf(assignee),
        url: web(issue.idReadable)
      },
      comments,
      attachments: ((issue.attachments ?? []) as Obj[]).map((a) => ({ id: a.id, name: a.name, mimeType: a.mimeType, url: absolute(a.url) })),
      links,
      partial
    });
  }

  return makeAdapter(config.id, { search: false, comments: true, attachments: true, links: true, write: false }, load);
}

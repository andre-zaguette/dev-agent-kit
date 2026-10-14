import { collectPages, httpJson, joinUrl, type HttpContext } from '../http.js';
import { WorkItemNotFoundError, type TaskSourceAdapter } from '../types.js';
import { buildWorkItem, makeAdapter, optional, type NativeDeps } from './common.js';

const KEY_RE = /^[A-Z][A-Z0-9_]{1,19}-\d{1,9}$/;
const PAGE = 100;
const MAX_ADF_DEPTH = 20;
const FIELDS = 'summary,description,status,issuetype,priority,labels,assignee,attachment,issuelinks,parent,subtasks';
type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface AdfNode {
  type?: unknown;
  text?: unknown;
  content?: unknown;
  attrs?: Record<string, unknown>;
}

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

function render(node: unknown, depth: number): string {
  if (depth > MAX_ADF_DEPTH || node === null || typeof node !== 'object') return '';
  const n = node as AdfNode;
  const kids = (): unknown[] => (Array.isArray(n.content) ? n.content : []);
  const joined = (sep = ''): string => kids().map((k) => render(k, depth + 1)).join(sep);
  switch (n.type) {
    case 'text':
      return str(n.text) ?? '';
    case 'hardBreak':
      return '\n';
    case 'mention':
      return str(n.attrs?.text) ?? '@user';
    case 'emoji':
      return str(n.attrs?.text) ?? str(n.attrs?.shortName) ?? '';
    case 'inlineCard':
      return str(n.attrs?.url) ?? '';
    case 'paragraph':
    case 'heading':
      return `${joined()}\n\n`;
    case 'codeBlock':
      return `\`\`\`\n${joined()}\n\`\`\`\n\n`;
    case 'bulletList':
      return `${kids().map((k) => `- ${render(k, depth + 1).trim()}`).join('\n')}\n\n`;
    case 'orderedList':
      return `${kids().map((k, i) => `${i + 1}. ${render(k, depth + 1).trim()}`).join('\n')}\n\n`;
    case 'tableRow':
      return `${kids().map((k) => render(k, depth + 1).trim()).join(' | ')}\n`;
    case 'table':
      return `${joined()}\n`;
    default:
      return joined();
  }
}

/** Atlassian Document Format -> readable plain text. Strings pass through; unknown nodes contribute their text; never throws. */
export function adfToText(doc: unknown): string {
  if (typeof doc === 'string') return doc;
  return render(doc, 0).replace(/\n{3,}/g, '\n\n').trim();
}

export function createJiraAdapter(deps: NativeDeps): TaskSourceAdapter {
  const { config, token } = deps;
  const base = config.baseUrl;
  if (!base) throw new Error(`source "${config.id}" needs a baseUrl`);
  const bearer = config.auth === 'bearer';
  if (!bearer && !deps.email) throw new Error(`source "${config.id}" needs the e-mail variable ${config.emailEnv ?? '(emailEnv)'} for Basic auth`);
  const basic = bearer ? '' : Buffer.from(`${deps.email}:${token}`).toString('base64');
  const ctx: HttpContext = { sourceId: config.id, fetch: deps.fetch, secrets: [token, basic].filter(Boolean), headers: { Authorization: bearer ? `Bearer ${token}` : `Basic ${basic}` } };
  const api = joinUrl(base, `/rest/api/${bearer ? '2' : '3'}`);
  const browse = (key: string): string => joinUrl(base, `/browse/${key}`);
  const link = (type: string | undefined, issue: Obj | undefined) => (issue?.key ? [{ type, key: issue.key, title: issue.fields?.summary, url: browse(issue.key) }] : []);

  async function load(identifier: string) {
    if (!KEY_RE.test(identifier)) throw new WorkItemNotFoundError(`"${identifier.slice(0, 64)}" is not a Jira issue key (for example PROJ-123)`);
    const issue = (await httpJson(ctx, `${api}/issue/${identifier}?fields=${FIELDS}`)) as Obj;
    const f: Obj = issue.fields ?? {};
    const partial: string[] = [];
    const comments = await optional(
      'comments',
      partial,
      async () => {
        const { items, truncated } = await collectPages(async (page) => ((await httpJson(ctx, `${api}/issue/${identifier}/comment?startAt=${page * PAGE}&maxResults=${PAGE}`)) as Obj).comments ?? [], PAGE);
        if (truncated) partial.push('comments');
        return items.map((c) => ({ id: (c as Obj).id, author: (c as Obj).author?.displayName, body: adfToText((c as Obj).body), createdAt: (c as Obj).created }));
      },
      [] as unknown[]
    );
    return buildWorkItem(config.id, {
      item: {
        id: issue.id,
        key: issue.key,
        title: f.summary,
        description: adfToText(f.description ?? ''),
        status: f.status?.name,
        type: f.issuetype?.name,
        priority: f.priority?.name,
        labels: f.labels,
        assigneeId: f.assignee?.accountId ?? f.assignee?.name,
        assigneeName: f.assignee?.displayName,
        url: browse(issue.key)
      },
      comments,
      attachments: ((f.attachment ?? []) as Obj[]).map((a) => ({ id: a.id, name: a.filename, mimeType: a.mimeType, url: a.content })),
      links: [
        ...((f.issuelinks ?? []) as Obj[]).flatMap((l) => [...link(l.type?.outward, l.outwardIssue), ...link(l.type?.inward, l.inwardIssue)]),
        ...link('parent', f.parent),
        ...((f.subtasks ?? []) as Obj[]).flatMap((s) => link('child', s))
      ],
      partial
    });
  }

  return makeAdapter(config.id, { search: false, comments: true, attachments: true, links: true, write: false }, load);
}

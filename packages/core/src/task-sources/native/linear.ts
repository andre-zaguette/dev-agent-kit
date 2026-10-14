import { classifyMessage, httpJson, type HttpContext } from '../http.js';
import { WorkItemNotFoundError, type TaskSourceAdapter } from '../types.js';
import { buildWorkItem, makeAdapter, type NativeDeps } from './common.js';

const ENDPOINT = 'https://api.linear.app/graphql';
const KEY_RE = /^[A-Za-z][A-Za-z0-9]{0,9}-\d{1,9}$/;
type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const QUERY = `query WorkItem($id: String!) {
  issue(id: $id) {
    id identifier title description url priorityLabel
    state { name }
    assignee { id name }
    labels { nodes { name } }
    parent { identifier title url }
    children(first: 50) { nodes { identifier title url } }
    relations(first: 50) { nodes { type relatedIssue { identifier title url } } }
    inverseRelations(first: 50) { nodes { type issue { identifier title url } } }
    attachments(first: 50) { nodes { id title url } }
    comments(first: 100) { nodes { id body createdAt user { name } } pageInfo { hasNextPage } }
  }
}`;

const ref = (type: string, issue: Obj | null | undefined) => (issue?.identifier ? [{ type, key: issue.identifier, title: issue.title, url: issue.url }] : []);
const nodes = (value: unknown): Obj[] => (Array.isArray((value as Obj | undefined)?.nodes) ? (value as Obj).nodes : []);
const INVERSE: Record<string, string> = { blocks: 'blocked-by' };

export function createLinearAdapter(deps: NativeDeps): TaskSourceAdapter {
  const { config, token } = deps;
  const ctx: HttpContext = { sourceId: config.id, fetch: deps.fetch, secrets: [token], headers: { Authorization: token } };

  async function load(identifier: string) {
    if (!KEY_RE.test(identifier)) throw new WorkItemNotFoundError(`"${identifier.slice(0, 64)}" is not a Linear issue key (for example ENG-123)`);
    const payload = (await httpJson(ctx, ENDPOINT, { query: QUERY, variables: { id: identifier } })) as Obj;
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      throw classifyMessage(config.id, payload.errors.map((e: Obj) => String(e?.message ?? '')).join('; '), ctx.secrets);
    }
    const issue = payload.data?.issue as Obj | null | undefined;
    if (!issue) throw new WorkItemNotFoundError(`work item "${identifier}" was not found in source "${config.id}"`);
    const partial: string[] = [];
    if (issue.comments?.pageInfo?.hasNextPage) partial.push('comments');
    return buildWorkItem(config.id, {
      item: {
        id: issue.id,
        key: issue.identifier,
        title: issue.title,
        description: issue.description ?? '',
        status: issue.state?.name,
        priority: issue.priorityLabel,
        labels: nodes(issue.labels).map((l) => l.name),
        assigneeId: issue.assignee?.id,
        assigneeName: issue.assignee?.name,
        url: issue.url
      },
      comments: nodes(issue.comments).map((c) => ({ id: c.id, author: c.user?.name, body: c.body, createdAt: c.createdAt })),
      attachments: nodes(issue.attachments).map((a) => ({ id: a.id, name: a.title, url: a.url })),
      links: [
        ...ref('parent', issue.parent),
        ...nodes(issue.children).flatMap((c) => ref('child', c)),
        ...nodes(issue.relations).flatMap((r) => ref(String(r.type), r.relatedIssue)),
        ...nodes(issue.inverseRelations).flatMap((r) => ref(INVERSE[String(r.type)] ?? String(r.type), r.issue))
      ],
      partial
    });
  }

  return makeAdapter(config.id, { search: false, comments: true, attachments: true, links: true, write: false }, load);
}

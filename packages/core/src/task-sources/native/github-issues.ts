import { collectPages, httpJson, joinUrl, type HttpContext } from '../http.js';
import { WorkItemNotFoundError, type TaskSourceAdapter } from '../types.js';
import { buildWorkItem, ledgerKey, makeAdapter, optional, type NativeDeps } from './common.js';

const REF_RE = /^(?:([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})#|#)?(\d{1,9})$/;
// GitHub's real rules; `.` and `..` would let the path climb out of /repos/.
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME_RE = /^(?!\.\.?$)[A-Za-z0-9_.-]{1,100}$/;
const PAGE = 100;
type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function createGithubIssuesAdapter(deps: NativeDeps): TaskSourceAdapter {
  const { config, token } = deps;
  const base = config.baseUrl ?? 'https://api.github.com';
  const ctx: HttpContext = {
    sourceId: config.id,
    fetch: deps.fetch,
    secrets: [token],
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }
  };

  function parse(identifier: string): { owner: string; name: string; number: string } {
    const match = REF_RE.exec(identifier);
    if (!match) throw new WorkItemNotFoundError(`"${identifier.slice(0, 64)}" is not a GitHub issue reference (use owner/name#123, #123 or 123)`);
    const [owner, name] = match[1] ? [match[1], match[2]] : (config.repo ?? '/').split('/');
    if (!owner || !name) throw new WorkItemNotFoundError(`source "${config.id}" has no default repository for "${identifier}"`);
    if (!OWNER_RE.test(owner) || !NAME_RE.test(name)) throw new WorkItemNotFoundError(`"${identifier.slice(0, 64)}" is not a valid GitHub repository reference`);
    return { owner, name, number: match[3] };
  }

  async function load(identifier: string) {
    const { owner, name, number } = parse(identifier);
    const root = joinUrl(base, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}`);
    const issue = (await httpJson(ctx, root)) as Obj;
    const partial: string[] = [];
    const comments = await optional(
      'comments',
      partial,
      async () => {
        const { items, truncated } = await collectPages(async (page) => (await httpJson(ctx, `${root}/comments?per_page=${PAGE}&page=${page + 1}`)) as unknown[], PAGE);
        if (truncated) partial.push('comments');
        return items.map((c) => ({ id: (c as Obj).id, author: (c as Obj).user?.login, body: (c as Obj).body, createdAt: (c as Obj).created_at }));
      },
      [] as unknown[]
    );
    return buildWorkItem(config.id, {
      item: {
        id: issue.id,
        key: ledgerKey(name, number),
        title: issue.title,
        description: issue.body ?? '',
        status: issue.state,
        type: issue.pull_request ? 'pull-request' : 'issue',
        labels: ((issue.labels ?? []) as unknown[]).map((l) => (typeof l === 'string' ? l : (l as Obj).name)),
        assigneeId: (issue.assignees?.[0] ?? issue.assignee)?.id,
        assigneeName: (issue.assignees?.[0] ?? issue.assignee)?.login,
        url: issue.html_url
      },
      comments,
      partial,
      reference: `${owner}/${name}#${number}`
    });
  }

  return makeAdapter(config.id, { search: false, comments: true, attachments: false, links: false, write: false }, load);
}

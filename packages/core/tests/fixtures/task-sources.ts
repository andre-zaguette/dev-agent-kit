import type { McpToolCaller } from '../../src/task-sources/generic-mcp.ts';
import type { TaskSourceConfig } from '../../src/task-sources/types.ts';

const DESCRIPTION = 'Build the form.\n\nAcceptance criteria:\n- Email is validated\n- Submit disables while pending';

/** What both mock sources must normalize to (apart from `source`). */
export const EXPECTED_ITEM = {
  id: '123',
  key: 'APP-123',
  title: 'Add account form',
  description: DESCRIPTION,
  acceptanceCriteria: ['Email is validated', 'Submit disables while pending'],
  comments: [{ id: 'c1', author: 'Ana', body: 'Use the shared input', createdAt: '2026-09-20T10:00:00Z' }],
  attachments: [{ id: 'a1', name: 'mock.png', mimeType: 'image/png', url: 'https://files.example.test/a1' }],
  links: [{ type: 'blocks', key: 'APP-200', title: 'Backend endpoint' }],
  status: 'Open',
  type: 'Story',
  priority: 'High',
  labels: ['frontend', 'forms'],
  metadata: { acceptanceCriteria: 'extracted' }
};

export const sourceAConfig: TaskSourceConfig = {
  id: 'alpha',
  adapter: 'generic-mcp',
  server: 'alpha-tasks',
  default: true,
  identifiers: [/^APP-\d+$/],
  tools: {
    get: { name: 'get_issue', arg: 'key' },
    search: { name: 'search_issues', list: 'results' },
    comments: { name: 'get_comments', list: 'comments' },
    attachments: { name: 'get_attachments', list: 'attachments' },
    links: { name: 'get_links', list: 'links' }
  },
  mapping: {
    fields: { id: 'id', key: 'key', title: 'summary', description: 'description', status: 'status.name', priority: 'priority.name', labels: 'labels', type: 'issuetype.name' },
    comments: { id: 'id', author: 'user.name', body: 'text', createdAt: 'created' },
    attachments: { id: 'id', name: 'filename', mimeType: 'mime', url: 'content' },
    links: { type: 'type', key: 'issue.key', title: 'issue.summary' }
  }
};

export const sourceBConfig: TaskSourceConfig = {
  id: 'beta',
  adapter: 'generic-mcp',
  server: 'beta-desk',
  default: false,
  identifiers: [/^TCK-\d+$/],
  tools: {
    get: { name: 'read_ticket' },
    comments: { name: 'ticket_notes' },
    attachments: { name: 'ticket_files' },
    links: { name: 'ticket_relations' }
  },
  mapping: {
    fields: { id: 'ticket_id', key: 'reference', title: 'subject', description: 'body', status: 'state', priority: 'urgency', labels: 'tags', type: 'kind' },
    comments: { id: 'cid', author: 'from', body: 'message', createdAt: 'at' },
    attachments: { id: 'file_id', name: 'title', mimeType: 'content_type', url: 'href' },
    links: { type: 'relation', key: 'target', title: 'target_title' }
  }
};

type Handler = (args: Record<string, unknown>) => unknown;
export const callerFrom =
  (handlers: Record<string, Handler>): McpToolCaller =>
  async (server, tool, args) => {
    const handler = handlers[`${server}/${tool}`];
    if (!handler) throw new Error(`unknown tool ${server}/${tool}`);
    return handler(args);
  };

export const makeSourceACaller = (overrides: Record<string, Handler> = {}): McpToolCaller =>
  callerFrom({
    'alpha-tasks/get_issue': () => ({ id: '123', key: 'APP-123', summary: 'Add account form', description: DESCRIPTION, status: { name: 'Open' }, priority: { name: 'High' }, labels: ['frontend', 'forms'], issuetype: { name: 'Story' } }),
    'alpha-tasks/search_issues': () => ({ results: [{ key: 'APP-123', summary: 'Add account form', status: { name: 'Open' } }, { key: 'APP-124' }] }),
    'alpha-tasks/get_comments': () => ({ comments: [{ id: 'c1', user: { name: 'Ana' }, text: 'Use the shared input', created: '2026-09-20T10:00:00Z' }] }),
    'alpha-tasks/get_attachments': () => ({ attachments: [{ id: 'a1', filename: 'mock.png', mime: 'image/png', content: 'https://files.example.test/a1' }] }),
    'alpha-tasks/get_links': () => ({ links: [{ type: 'blocks', issue: { key: 'APP-200', summary: 'Backend endpoint' } }] }),
    ...overrides
  });

/** Source B answers in MCP envelopes (JSON inside a text content block), like a real server would. */
const envelope = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
export const makeSourceBCaller = (overrides: Record<string, Handler> = {}): McpToolCaller =>
  callerFrom({
    'beta-desk/read_ticket': () => envelope({ ticket_id: '123', reference: 'APP-123', subject: 'Add account form', body: DESCRIPTION, state: 'Open', urgency: 'High', tags: ['frontend', 'forms'], kind: 'Story' }),
    'beta-desk/ticket_notes': () => envelope([{ cid: 'c1', from: 'Ana', message: 'Use the shared input', at: '2026-09-20T10:00:00Z' }]),
    'beta-desk/ticket_files': () => envelope([{ file_id: 'a1', title: 'mock.png', content_type: 'image/png', href: 'https://files.example.test/a1' }]),
    'beta-desk/ticket_relations': () => envelope([{ relation: 'Blocks', target: 'APP-200', target_title: 'Backend endpoint' }]),
    ...overrides
  });

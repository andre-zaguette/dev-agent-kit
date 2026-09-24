export interface TaskSourceCapabilities {
  search: boolean;
  comments: boolean;
  attachments: boolean;
  links: boolean;
  write: boolean;
}

export interface WorkItemComment {
  id?: string;
  author?: string;
  body: string;
  createdAt?: string;
}

export interface WorkItemAttachment {
  id: string;
  name: string;
  mimeType?: string;
  url?: string;
  localPath?: string;
}

export type WorkItemLinkType = 'parent' | 'child' | 'blocks' | 'blocked-by' | 'relates-to' | 'duplicate' | 'other';

export interface WorkItemLink {
  type: WorkItemLinkType;
  key?: string;
  url?: string;
  title?: string;
}

export interface WorkItem {
  source: string;
  id: string;
  key: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  comments: WorkItemComment[];
  attachments: WorkItemAttachment[];
  links: WorkItemLink[];
  status?: string;
  type?: string;
  priority?: string;
  labels?: string[];
  assignee?: { id?: string; name?: string };
  rawUrl?: string;
  /** `acceptanceCriteria`: 'field' | 'extracted' | 'unavailable'; `partial`: optional lookups that failed. */
  metadata?: Record<string, unknown>;
}

export interface WorkItemSummary {
  key: string;
  title: string;
  status?: string;
  url?: string;
}

export interface TaskSourceAdapter {
  id: string;
  capabilities(): TaskSourceCapabilities;
  getWorkItem(identifier: string): Promise<WorkItem>;
  search?(query: string): Promise<WorkItemSummary[]>;
  getComments?(identifier: string): Promise<WorkItemComment[]>;
  getAttachments?(identifier: string): Promise<WorkItemAttachment[]>;
  getLinkedItems?(identifier: string): Promise<WorkItemLink[]>;
}

/** Reserved for a later version. Nothing in v0.7 implements or calls it. */
export interface WritableTaskSourceAdapter extends TaskSourceAdapter {
  addComment(identifier: string, text: string): Promise<void>;
  updateStatus?(identifier: string, status: string): Promise<void>;
  addLink?(identifier: string, link: string): Promise<void>;
}

export type ItemField =
  | 'id'
  | 'key'
  | 'title'
  | 'description'
  | 'acceptanceCriteria'
  | 'status'
  | 'type'
  | 'priority'
  | 'labels'
  | 'assigneeId'
  | 'assigneeName'
  | 'url';

/** Field name -> dotted path into the source payload. Collection maps use the canonical field names as keys. */
export interface SourceMapping {
  fields: Partial<Record<ItemField, string>>;
  comments: Record<string, string>;
  attachments: Record<string, string>;
  links: Record<string, string>;
}

export type ToolKind = 'get' | 'search' | 'comments' | 'attachments' | 'links';

export interface ToolRef {
  name: string;
  /** Name of the tool argument that receives the identifier (or query). Defaults per tool kind. */
  arg?: string;
  /** Dotted path to the array inside the tool result. Defaults to the result itself. */
  list?: string;
}

export interface TaskSourceConfig {
  id: string;
  adapter: string;
  server?: string;
  default: boolean;
  identifiers: RegExp[];
  tools: Partial<Record<ToolKind, ToolRef>>;
  mapping: SourceMapping;
}

export interface SourceRoute {
  id: string;
  identifiers: RegExp[];
  default: boolean;
}

export type Resolution =
  | { status: 'resolved'; source: string; via: 'explicit' | 'pattern' | 'default' }
  | { status: 'ambiguous'; candidates: string[] }
  | { status: 'probe'; candidates: string[] }
  | { status: 'unknown-source'; source: string; known: string[] }
  | { status: 'unresolved'; reason: string };

export class WorkItemNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkItemNotFoundError';
  }
}

export class SourceUnavailableError extends Error {
  constructor(
    message: string,
    readonly reason: 'auth' | 'unavailable'
  ) {
    super(message);
    this.name = 'SourceUnavailableError';
  }
}

export class NormalizationError extends Error {
  constructor(
    message: string,
    readonly missing: string[] = []
  ) {
    super(message);
    this.name = 'NormalizationError';
  }
}

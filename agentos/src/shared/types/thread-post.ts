export type ThreadPostKind = 'prompt' | 'update' | 'clarification' | 'file';

export type ThreadPostAuthor = 'user' | 'agent';

export interface ThreadPostAttachment {
  filename: string;
  /** Host filesystem path the file was resolved to. */
  path: string;
}

/**
 * A message in the Slack-style thread view — the primary, persisted conversation surface.
 * Captures inbound prompts and the updates/clarifications/files the agent posts. Slack, when
 * connected, mirrors agent posts as an echo; this store is the source of truth.
 */
export interface ThreadPost {
  id: string;
  threadId: string;
  kind: ThreadPostKind;
  author: ThreadPostAuthor;
  text: string;
  attachment?: ThreadPostAttachment;
  createdAt: number;
}

export interface ThreadPostAppendedEvent {
  threadId: string;
  post: ThreadPost;
}

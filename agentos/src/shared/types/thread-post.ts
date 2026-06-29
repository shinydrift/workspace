export type ThreadPostKind = 'prompt' | 'update' | 'clarification' | 'file';

export type ThreadPostAuthor = 'user' | 'agent';

/**
 * Agent processing status mirrored onto a prompt post — the Thread-view equivalent of the
 * Slack reaction lifecycle (👀 working → 🤖 autopilot / 🏛️ council → ✅ done / ❌ error).
 */
export type ThreadPostStatus = 'working' | 'autopilot' | 'council' | 'done' | 'error';

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
  /** Live agent-processing status; set on prompt posts and updated through the turn lifecycle. */
  status?: ThreadPostStatus;
  createdAt: number;
}

export interface ThreadPostAppendedEvent {
  threadId: string;
  post: ThreadPost;
}

export interface ThreadPostUpdatedEvent {
  threadId: string;
  post: ThreadPost;
}

export type ThreadPostKind = 'prompt' | 'update' | 'clarification' | 'file';

export type ThreadPostAuthor = 'user' | 'agent';

/**
 * Agent processing status shown on a prompt post — the Thread-view equivalent of the Slack
 * reaction lifecycle (👀 working → 🤖 autopilot / 🏛️ council → ✅ done / ❌ error). The transient
 * working/autopilot/council states are derived live in the renderer; only the terminal states are
 * persisted (see ThreadPostTerminalStatus).
 */
export type ThreadPostStatus = 'working' | 'autopilot' | 'council' | 'done' | 'error';

/**
 * The subset of ThreadPostStatus persisted per prompt post. Only terminal outcomes are stored — the
 * transient states would otherwise stick (a turn left mid-flight by a restart or interrupt never gets
 * a resolving event), so the live indicator is computed from the thread's current status instead.
 */
export type ThreadPostTerminalStatus = Extract<ThreadPostStatus, 'done' | 'error'>;

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
  /** Persisted terminal outcome of the prompt's turn (done/error); transient states are derived live. */
  status?: ThreadPostTerminalStatus;
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

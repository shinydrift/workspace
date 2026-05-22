import type { ClaudeEffort, CodexReasoning, Provider } from './provider';

// Stage status is now a free string — stages are defined per-project in the DB.
export type KanbanTaskStatus = string;

export interface KanbanStage {
  id: string;
  label: string;
  order: number;
  prompt?: string;
  provider?: Provider;
  model?: string;
  effort?: ClaudeEffort;
  reasoning?: CodexReasoning;
  saveToMemory?: boolean;
  /** computed, not persisted */
  terminal?: boolean;
}

export type KanbanTaskPriority = 'low' | 'medium' | 'high' | 'critical';

export type KanbanClassOfService = 'expedite' | 'standard' | 'intangible';

export type AgentRole = 'task-main' | `stage-${string}`;

export interface KanbanTask {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: string;
  priority: KanbanTaskPriority;
  progress: number; // 0–100
  assignedThreadId: string | null;
  mainThreadId: string | null;
  skillTags: string[];
  branch: string | null;
  worktreePath: string | null;
  classOfService: KanbanClassOfService;
  parentTaskId: string | null;
  dueAt: number | null;
  slackChannelId: string | null;
  slackThreadTs: string | null;
  blockedBy: string[]; // task IDs this task is blocked by
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  metadata: Record<string, unknown>;
}

export interface KanbanTaskNote {
  id: string;
  taskId: string;
  threadId: string | null;
  content: string;
  createdAt: number;
}

export type KanbanTaskReviewVerdict = 'approved' | 'changes_requested';

export type KanbanTaskEventKind =
  | 'created'
  | 'updated'
  | 'moved'
  | 'progress'
  | 'note'
  | 'assigned'
  | 'review'
  | 'blocker';

export interface KanbanTaskEvent {
  id: string;
  projectId: string;
  taskId: string;
  threadId: string | null;
  kind: KanbanTaskEventKind;
  data: Record<string, unknown>;
  createdAt: number;
}

export interface KanbanTaskFileChange {
  path: string;
  status: string;
}

export interface KanbanTaskGitSummary {
  branch: string | null;
  worktreePath: string | null;
  headSha: string;
  shortSha: string;
  subject: string;
  authorName: string;
  authoredAt: number;
  baseRef: string | null;
  totalChangedFiles: number;
  changedFiles: KanbanTaskFileChange[];
  isDirty: boolean | null;
}

export interface KanbanWipLimit {
  projectId: string;
  status: string;
  maxTasks: number;
}

export interface KanbanBoard {
  projectId: string;
  tasks: KanbanTask[];
  wipLimits: KanbanWipLimit[];
}

// ── IPC request/response types ────────────────────────────────────────────────

export interface KanbanListRequest {
  projectId: string;
  status?: string;
}

export interface KanbanCreateRequest {
  projectId: string;
  title: string;
  description?: string;
  priority?: KanbanTaskPriority;
  classOfService?: KanbanClassOfService;
  skillTags?: string[];
  parentTaskId?: string;
  status?: string;
  dueAt?: number | null;
  slackChannelId?: string | null;
  slackThreadTs?: string | null;
}

export interface KanbanMoveRequest {
  id: string;
  status: string;
  reason?: string;
}

export interface KanbanUpdateProgressRequest {
  id: string;
  progress: number;
  note?: string;
}

export interface KanbanAssignRequest {
  id: string;
  threadId: string;
}

export interface KanbanAddNoteRequest {
  id: string;
  content: string;
  threadId?: string;
}

export interface KanbanAddReviewRequest {
  id: string;
  verdict: KanbanTaskReviewVerdict;
  summary?: string;
  threadId?: string;
}

export interface KanbanSetBlockerRequest {
  id: string;
  blocked: boolean;
  summary?: string;
  threadId?: string;
}

export interface KanbanGetNotesRequest {
  taskId: string;
}

export interface KanbanSetWipLimitRequest {
  projectId: string;
  status: string;
  maxTasks: number;
}

// ── EventBus payload ──────────────────────────────────────────────────────────

export interface KanbanTaskMovedEvent {
  taskId: string;
  projectId: string;
  fromStatus: string;
  toStatus: string;
  task: KanbanTask;
  /** Thread that initiated the move. `null` for UI/system moves. */
  actorThreadId: string | null;
}

export interface KanbanTaskCreatedEvent {
  taskId: string;
  projectId: string;
  task: KanbanTask;
}

export interface KanbanTaskUnblockedEvent {
  taskId: string;
  projectId: string;
  mainThreadId: string | null;
  /** Title of the task whose completion removed the last blocker. */
  resolvedBlockerTitle: string;
}

export interface CfdSnapshot {
  date: number;
  counts: Record<string, number>;
}

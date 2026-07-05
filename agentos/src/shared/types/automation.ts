import type { KanbanTaskPriority } from './kanban';
import type { ClaudeEffort, CodexReasoning, Provider } from './provider';

export type AutomationSchedule =
  | { kind: 'cron'; expr: string }
  | { kind: 'every'; ms: number }
  | { kind: 'at'; iso: string };

export interface WebhookTrigger {
  secret: string;
  source?: 'github' | 'stripe' | 'slack' | string;
}

export type AutomationTrigger =
  | { kind: 'schedule'; schedule: AutomationSchedule }
  | { kind: 'manual' }
  | { kind: 'webhook'; webhook: WebhookTrigger };

export interface AutomationRunRecord {
  at: number;
  status: 'ok' | 'error' | 'skipped';
  error?: string;
  trigger: 'schedule' | 'manual' | 'webhook';
}

export interface AutomationNotification {
  channel: 'slack';
  onFailure: boolean;
  slackChannelId?: string;
}

export interface KanbanTaskTemplate {
  title: string;
  description?: string;
  priority?: KanbanTaskPriority;
  skillTags?: string[];
}

export interface AutomationJob {
  id: string;
  name: string;
  description?: string;
  projectId: string;
  trigger: AutomationTrigger;
  instructions: string;
  /** When set, the automation creates a kanban task instead of running a thread. */
  kanbanTaskTemplate?: KanbanTaskTemplate;
  /** When set, this is a built-in system automation managed by AgentOS. */
  isSystem?: boolean;
  /**
   * Agent settings pinned to the automation. When set, every run uses these instead of
   * resolving the project/app defaults at run time. When unset, the run inherits the
   * effective defaults (backward-compatible behavior).
   */
  provider?: Provider;
  model?: string;
  effort?: ClaudeEffort;
  reasoning?: CodexReasoning;
  notification?: AutomationNotification;
  enabled: boolean;
  deleteAfterRun: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastRunStatus?: 'ok' | 'error' | 'skipped';
  lastRunError?: string;
  runCountOk?: number;
  runCountError?: number;
  runHistory?: AutomationRunRecord[];
}

export interface AutomationCreateRequest {
  name: string;
  description?: string;
  projectId: string;
  trigger: AutomationTrigger;
  instructions: string;
  kanbanTaskTemplate?: KanbanTaskTemplate;
  provider?: Provider;
  model?: string;
  effort?: ClaudeEffort;
  reasoning?: CodexReasoning;
  notification?: AutomationNotification;
  enabled?: boolean;
  deleteAfterRun?: boolean;
}

export interface AutomationUpdateRequest {
  id: string;
  patch: Partial<Omit<AutomationJob, 'id' | 'createdAt'>>;
}

export const PERSONALITY_REFRESH_JOB_ID = 'agentos-builtin-personality-refresh';

export function personalityRefreshJobId(projectId: string): string {
  return `${PERSONALITY_REFRESH_JOB_ID}-${projectId}`;
}

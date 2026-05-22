import type { ClaudeEffort, CodexReasoning, Provider } from './provider';

export interface CouncilMember {
  provider: Provider;
  model: string;
  effort?: ClaudeEffort;
  reasoning?: CodexReasoning;
}

export interface CouncilConfig {
  id: string;
  name: string;
  members: CouncilMember[];
  createdAt: number;
  updatedAt: number;
}

export type CouncilRunStatus = 'pending' | 'running' | 'done' | 'error';

export interface CouncilRun {
  id: string;
  configId: string;
  parentThreadId: string;
  prompt: string;
  childThreadIds: string[];
  status: CouncilRunStatus;
  createdAt: number;
  completedAt?: number;
  expiresAt?: number;
}

// Structured payload an agent emits between the COUNCIL_OUTCOME sentinels.
export interface CouncilOutcomePayload {
  summary: string;
  answer: string;
  confidence?: number;
  caveats?: string[];
}

// Persisted record of a member submission, attached to the child thread.
export interface CouncilOutcomeRecord {
  runId: string;
  childThreadId: string;
  member: CouncilMember;
  status: 'submitted' | 'invalid' | 'error' | 'timeout';
  outcome?: CouncilOutcomePayload;
  raw?: string; // raw text when status === 'invalid'
  error?: string;
  submittedAt: number;
}

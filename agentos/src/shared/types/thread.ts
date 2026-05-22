import type { ClaudeEffort, CodexReasoning, Provider } from './provider';
import type { AgentRole } from './kanban';
import type { PersonalitySettings } from './settings';

export type ThreadStatus = 'running' | 'idle' | 'error' | 'stopped' | 'archived' | 'building';
export type AutopilotThreadState = 'idle' | 'thinking' | 'sent' | 'stopped' | 'blocked';

export interface TrayThread {
  id: string;
  name: string;
  projectName: string;
  status: ThreadStatus;
  autopilotEnabled: boolean;
  autopilotState?: AutopilotThreadState;
  lastActiveAt: number;
  lastMessage: string; // first line of last assistant message, max 120 chars
}

export interface ThreadLogEntry {
  id: string;
  timestamp: number; // unix ms
  data: string; // raw ANSI chunk
  source: 'stdout' | 'stderr' | 'system';
}

export interface Thread {
  id: string;
  name: string;
  projectId: string;
  workingDirectory: string;
  projectPath?: string;
  usingWorktree?: boolean;
  provider?: Provider;
  model?: string; // optional CLI --model override; resolved at thread creation from providerOrder
  effort?: ClaudeEffort; // optional per-thread --effort override for Claude
  reasoning?: CodexReasoning; // optional per-thread --reasoning override for Codex
  status: ThreadStatus;
  createdAt: number;
  lastActiveAt: number;
  pid?: number;
  exitCode?: number;
  queueDepth?: number;
  logBuffer: ThreadLogEntry[]; // in-memory ring buffer, max 2000
  promptHistory: string[];
  autopilotEnabled?: boolean;
  autopilotState?: AutopilotThreadState;
  autopilotLastReason?: string;
  autopilotConsecutiveTurns?: number;
  claudeSessionId?: string; // persisted session ID for headless --resume
  codexSessionId?: string; // persisted thread ID for codex exec resume
  geminiSessionId?: string; // persisted session ID for gemini --resume
  piSessionId?: string; // persisted session ID for pi --session resume
  archivedAt?: number; // set when thread is archived; worktree has been removed
  agentRole?: AgentRole; // kanban specialist role, if any
  taskId?: string; // kanban task this thread is currently working on
  skillTags?: string[]; // agent capabilities for task matching
  parentThreadId?: string; // set on council sub-threads — they collapse under this parent
  councilRunId?: string; // set on council sub-threads — links them to a CouncilRun
  recordingId?: string; // set when thread was created from a meeting recording
  sessionStartedAt?: number; // unix ms when current PTY session started; in-memory only, not persisted
  personalityOverride?: Partial<PersonalitySettings>; // merged on top of project personality at boot
}

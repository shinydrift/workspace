import type { ClaudeEffort, CodexReasoning, Provider } from '../provider';
import type { ThreadStatus } from '../thread';
import type { Message } from '../message';

export const THREAD_IPC_CHANNELS = {
  THREAD_CREATE: 'thread:create',
  THREAD_START: 'thread:start',
  THREAD_STOP: 'thread:stop',
  THREAD_DELETE: 'thread:delete',
  THREAD_ARCHIVE: 'thread:archive',
  THREAD_LIST: 'thread:list',
  THREAD_RENAME: 'thread:rename',
  THREAD_SET_AUTOPILOT: 'thread:setAutopilot',
  THREAD_SET_PROVIDER_MODEL: 'thread:setProviderModel',
  THREAD_INJECTION_STATUS: 'thread:getInjectionStatus',
  THREAD_DERIVE_PERSONALITY: 'thread:derivePersonality',
  TERMINAL_SEND_INPUT: 'terminal:sendInput',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_GET_HISTORY: 'terminal:getHistory',
  MESSAGES_LIST: 'messages:list',
  MESSAGES_CLEAR: 'messages:clear',
  MESSAGES_PENDING: 'messages:pending',
} as const;

export interface CreateThreadRequest {
  name: string;
  workingDirectory: string;
  provider?: Provider;
  model?: string;
  effort?: ClaudeEffort;
  reasoning?: CodexReasoning;
  createWorktree?: boolean;
  projectName?: string;
  projectPath?: string;
  subdir?: string;
}

export interface ThreadInjectionStatus {
  hasBoot: boolean;
  hasMemory: boolean;
  injected: boolean;
  error?: string;
}

export interface StartThreadRequest {
  threadId: string;
}

export interface SetThreadAutopilotRequest {
  threadId: string;
  enabled: boolean;
}

export interface SendInputRequest {
  threadId: string;
  input: string;
}

export interface ResizeTerminalRequest {
  threadId: string;
  cols: number;
  rows: number;
}

export interface TerminalDataEvent {
  threadId: string;
  data: string;
}

export interface ThreadStatusEvent {
  threadId: string;
  status: ThreadStatus;
  provider?: Provider;
  pid?: number;
  exitCode?: number;
  queueDepth?: number;
  autopilotEnabled?: boolean;
  autopilotState?: import('../thread').AutopilotThreadState;
  autopilotLastReason?: string;
  autopilotConsecutiveTurns?: number;
  sessionStartedAt?: number;
}

export interface ThreadRenamedEvent {
  threadId: string;
  name: string;
}

export interface MessageAppendedEvent {
  threadId: string;
  message: Message;
}

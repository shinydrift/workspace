import type { Provider } from './provider';

export type MessageRole = 'user' | 'assistant' | 'tool';

export type MessageContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export interface MessageNormalizedPayload {
  schemaVersion: 1;
  provider: Provider;
  role: MessageRole;
  blocks: MessageContentBlock[];
  raw?: {
    source: 'plain_text' | 'stream_json';
    payload: unknown;
  };
}

export interface Message {
  id: string;
  threadId: string;
  role: MessageRole;
  source?: 'human' | 'automation' | 'autopilot' | 'autopilot-decision';
  content: string;
  normalized?: MessageNormalizedPayload;
  timestamp: number;
  firstChunkAt?: number; // unix ms when first streaming byte arrived (assistant messages only)
}

export function parseAutopilotDecision(content: string): { action: string; reason: string } {
  try {
    const parsed = JSON.parse(content) as { action?: string; reason?: string };
    return { action: parsed.action ?? 'stop', reason: parsed.reason ?? content };
  } catch {
    return { action: 'stop', reason: content };
  }
}

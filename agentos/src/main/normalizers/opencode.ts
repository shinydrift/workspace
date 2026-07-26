import type { MessageContentBlock } from '../../shared/types';
import type { NormalizedMessageInput, NormalizedMessageResult, TokenUsage } from './types';
import { buildPlainTextResult, buildStreamResult, parseJsonLines, safeStringify, sumTokenUsage } from './types';

// opencode `run --format json` emits one JSON event per line. Every line carries a top-level
// `type`, `timestamp`, `sessionID` and a `part` payload:
//   - step_start   → part.type "step-start" (ignored; just marks a step boundary)
//   - text         → part.type "text", part.text is the FULL assistant-text snapshot so far for
//                    that part.id (successive lines grow it, they are not deltas)
//   - tool_use     → part.tool, part.callID, part.state.{status,input,output}
//   - step_finish  → part.type "step-finish", part.reason "stop"|"tool-calls", part.tokens.*
//   - error        → error.name, error.data.message

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function numberFrom(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function extractOpencodeTokenUsage(events: Array<Record<string, unknown>>): TokenUsage | undefined {
  return sumTokenUsage(events, (e) => {
    if (e.type !== 'step_finish') return null;
    const part = asRecord(e.part);
    const tokens = asRecord(part?.tokens);
    if (!tokens) return null;
    const cache = asRecord(tokens.cache);
    return {
      inputTokens: numberFrom(tokens.input),
      outputTokens: numberFrom(tokens.output),
      cacheReadTokens: cache ? numberFrom(cache.read) : undefined,
      cacheCreationTokens: cache ? numberFrom(cache.write) : undefined,
    };
  });
}

function buildFromOpencodeJsonEvents(
  input: NormalizedMessageInput,
  events: Array<Record<string, unknown>>
): NormalizedMessageResult | null {
  const blocks: MessageContentBlock[] = [];
  // opencode re-emits each text part as a growing full snapshot, so track the block index per
  // part.id and overwrite it in place rather than appending (which would duplicate the text).
  const textBlockIndexByPartId = new Map<string, number>();
  const errorParts: string[] = [];

  for (const event of events) {
    const type = typeof event.type === 'string' ? event.type : '';
    const part = asRecord(event.part);

    if (type === 'text' && part) {
      const partId = typeof part.id === 'string' ? part.id : '';
      const text = typeof part.text === 'string' ? part.text : '';
      if (!text) continue;
      const existingIdx = partId ? textBlockIndexByPartId.get(partId) : undefined;
      if (existingIdx !== undefined) {
        const existing = blocks[existingIdx];
        if (existing.type === 'text') existing.text = text; // replace with latest full snapshot
      } else {
        blocks.push({ type: 'text', text });
        if (partId) textBlockIndexByPartId.set(partId, blocks.length - 1);
      }
      continue;
    }

    if (type === 'tool_use' && part && input.role === 'assistant') {
      const state = asRecord(part.state) ?? {};
      const callId = typeof part.callID === 'string' ? part.callID : typeof part.id === 'string' ? part.id : '';
      if (!callId) continue;
      const toolName = typeof part.tool === 'string' ? part.tool : 'tool';
      blocks.push({ type: 'tool_use', id: callId, name: toolName, input: state.input ?? {} });
      const status = typeof state.status === 'string' ? state.status : '';
      if (status === 'completed' || status === 'error') {
        const output = typeof state.output === 'string' ? state.output : safeStringify(state.output ?? '');
        blocks.push({ type: 'tool_result', toolUseId: callId, content: output, isError: status === 'error' });
      }
      continue;
    }

    if (type === 'error') {
      const err = asRecord(event.error);
      const data = asRecord(err?.data);
      const message = typeof data?.message === 'string' ? data.message : typeof err?.name === 'string' ? err.name : '';
      if (message.trim()) errorParts.push(message.trim());
    }
  }

  if (input.role === 'assistant' && blocks.length === 0 && errorParts.length > 0) {
    blocks.push({ type: 'text', text: errorParts.join('\n') });
  }

  if (blocks.length === 0) return null;

  return buildStreamResult(input, 'opencode', blocks, events);
}

export function normalizeOpencode(input: NormalizedMessageInput): NormalizedMessageResult {
  const events = parseJsonLines(input.raw ?? input.text);
  if (events.length > 0) {
    const result = buildFromOpencodeJsonEvents(input, events);
    if (result) {
      result.tokenUsage = extractOpencodeTokenUsage(events);
      return result;
    }
  }
  return buildPlainTextResult(input);
}

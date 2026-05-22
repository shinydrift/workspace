import type { MessageContentBlock } from '../../shared/types';
import type { NormalizedMessageInput, NormalizedMessageResult } from './types';
import { appendBlock, buildPlainTextResult, buildStreamResult, extractRateLimitWindows, parseJsonLines } from './types';

function extractGeminiTokenUsage(events: Array<Record<string, unknown>>) {
  let model: string | undefined;
  let lastResult: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; model?: string } | undefined;
  for (const e of events) {
    const type = typeof e.type === 'string' ? e.type.toLowerCase() : '';
    if (type === 'init') {
      if (typeof e.model === 'string') model = e.model;
      continue;
    }
    if (type === 'result') {
      const stats = e.stats != null && typeof e.stats === 'object' ? (e.stats as Record<string, unknown>) : null;
      if (!stats) continue;
      const inputTokens = typeof stats.input_tokens === 'number' ? stats.input_tokens : 0;
      const outputTokens = typeof stats.output_tokens === 'number' ? stats.output_tokens : 0;
      if (inputTokens === 0 && outputTokens === 0) continue;
      const cacheReadTokens = typeof stats.cached === 'number' && stats.cached > 0 ? stats.cached : undefined;
      lastResult = { inputTokens, outputTokens, cacheReadTokens, model };
    }
  }
  return lastResult;
}

function buildFromGeminiJsonEvents(
  input: NormalizedMessageInput,
  events: Array<Record<string, unknown>>
): NormalizedMessageResult | null {
  const blocks: MessageContentBlock[] = [];
  const errorParts: string[] = [];

  for (const event of events) {
    const type = typeof event.type === 'string' ? event.type.toLowerCase() : '';
    if (!type) continue;

    if (type === 'message') {
      const role = typeof event.role === 'string' ? event.role.toLowerCase() : '';
      const content = typeof event.content === 'string' ? event.content : '';
      if (role === 'assistant' && content) {
        if (input.role === 'assistant') appendBlock(blocks, 'text', content);
      } else if (role === 'user' && input.role === 'user' && content) {
        appendBlock(blocks, 'text', content);
      }
      continue;
    }

    if (input.role === 'assistant' && type === 'tool_use') {
      const toolId = typeof event.tool_id === 'string' ? event.tool_id : '';
      const toolName = typeof event.tool_name === 'string' ? event.tool_name : 'tool';
      if (!toolId) continue;
      blocks.push({
        type: 'tool_use',
        id: toolId,
        name: toolName,
        input: event.parameters ?? {},
      });
      continue;
    }

    if (input.role === 'assistant' && type === 'tool_result') {
      const toolUseId = typeof event.tool_id === 'string' ? event.tool_id : '';
      if (!toolUseId) continue;
      const content = typeof event.output === 'string' ? event.output : JSON.stringify(event.output ?? '');
      const status = typeof event.status === 'string' ? event.status.toLowerCase() : '';
      blocks.push({
        type: 'tool_result',
        toolUseId,
        content,
        isError: status === 'error' || status === 'failed',
      });
      continue;
    }

    if ((type === 'error' || type === 'result') && typeof event.error === 'string' && event.error.trim()) {
      errorParts.push(event.error.trim());
    }
  }

  if (input.role === 'assistant') {
    if (blocks.length === 0 && errorParts.length > 0) {
      blocks.push({ type: 'text', text: errorParts.join('\n') });
    }
  }

  if (blocks.length === 0) return null;

  return buildStreamResult(input, 'gemini', blocks, events);
}

export function normalizeGemini(input: NormalizedMessageInput): NormalizedMessageResult {
  const events = parseJsonLines(input.raw ?? input.text);
  if (events.length > 0) {
    const result = buildFromGeminiJsonEvents(input, events);
    if (result) {
      result.tokenUsage = extractGeminiTokenUsage(events);
      result.rateLimitWindows = extractRateLimitWindows(events);
      return result;
    }
  }
  return buildPlainTextResult(input);
}

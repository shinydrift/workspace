import type { MessageContentBlock } from '../../shared/types';
import { scanJsonObjects } from '../../shared/utils/scanJsonObjects';
import type { RateLimitWindow } from '../../shared/types/analytics';
import type { NormalizedMessageInput, NormalizedMessageResult, TokenUsage } from './types';
import {
  appendBlock,
  buildPlainTextResult,
  buildStreamResult,
  extractRateLimitWindows,
  safeStringify,
  sumTokenUsage,
} from './types';

type ContentItem = {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
};

type StreamJsonEvent = {
  type?: string;
  event?: StreamJsonEvent; // stream_event wrapper
  message?: {
    id?: string;
    content?: ContentItem[];
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    model?: string;
  }; // assistant type
  delta?: { type?: string; text?: string; thinking?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
  content_block?: { type?: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown };
  content?: ContentItem[];
  tool_use_id?: string;
  tool_result?: unknown;
  content_result?: unknown;
  is_error?: boolean;
};

function toToolResultContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    // Anthropic tool_result content may be an array of content blocks.
    // Only text blocks are extracted; non-text blocks (e.g. image) are intentionally dropped
    // because the display layer has no way to render them inline.
    return value
      .filter(
        (item): item is { type: string; text: string } =>
          !!item &&
          typeof item === 'object' &&
          (item as Record<string, unknown>).type === 'text' &&
          typeof (item as Record<string, unknown>).text === 'string'
      )
      .map((item) => item.text)
      .join('\n');
  }
  return safeStringify(value ?? '');
}

function collectToolResultBlocks(events: StreamJsonEvent[]): MessageContentBlock[] {
  const out: MessageContentBlock[] = [];
  for (const raw of events) {
    const event: StreamJsonEvent = raw.type === 'stream_event' && raw.event ? raw.event : raw;
    if (event.type === 'tool_result') {
      const contentValue = event.content ?? event.tool_result ?? event.content_result;
      out.push({
        type: 'tool_result',
        toolUseId: event.tool_use_id ?? `tool-${out.length}`,
        content: toToolResultContent(contentValue),
        isError: Boolean(event.is_error),
      });
    } else if (event.type === 'user' && Array.isArray(event.message?.content)) {
      // Claude Code CLI format: tool results are inside user message events
      for (const item of event.message!.content!) {
        if (item.type === 'tool_result') {
          out.push({
            type: 'tool_result',
            toolUseId: item.tool_use_id ?? `tool-${out.length}`,
            content: toToolResultContent(item.content),
            isError: Boolean(item.is_error),
          });
        }
      }
    }
  }
  return out;
}

function parseStreamJsonEvents(text: string): StreamJsonEvent[] {
  return scanJsonObjects(text) as StreamJsonEvent[];
}

function buildBlocksFromContent(content: ContentItem[]): MessageContentBlock[] {
  const blocks: MessageContentBlock[] = [];
  for (const item of content) {
    if (item.type === 'text' && item.text) {
      blocks.push({ type: 'text', text: item.text });
    } else if (item.type === 'thinking') {
      const thinkingText = typeof item.thinking === 'string' ? item.thinking : item.text;
      if (thinkingText) blocks.push({ type: 'thinking', text: thinkingText });
    } else if (item.type === 'tool_use') {
      blocks.push({
        type: 'tool_use',
        id: item.id ?? `tool-${blocks.length}`,
        name: item.name ?? 'tool',
        input: item.input,
      });
    }
  }
  return blocks;
}

/** Builds blocks from fully-formed `assistant` events. Returns null if none are present. */
function buildFromAssistantEvents(events: StreamJsonEvent[]): MessageContentBlock[] | null {
  const assistantEvents = events
    .map((e): StreamJsonEvent => (e.type === 'stream_event' && e.event ? e.event : e))
    .filter((e) => e.type === 'assistant' && e.message?.content);
  if (assistantEvents.length === 0) return null; // no assistant events → caller should use delta path
  const blocks: MessageContentBlock[] = [];
  for (const e of assistantEvents) {
    if (e.message?.content) blocks.push(...buildBlocksFromContent(e.message.content));
  }
  return blocks; // empty array means events existed but produced no recognised blocks
}

/** Reconstructs blocks from streaming content_block_delta / content_block_start events. */
function buildFromStreamDeltas(events: StreamJsonEvent[]): MessageContentBlock[] {
  const blocks: MessageContentBlock[] = [];

  for (const raw of events) {
    const event: StreamJsonEvent = raw.type === 'stream_event' && raw.event ? raw.event : raw;

    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      appendBlock(blocks, 'text', event.delta.text);
      continue;
    }
    if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
      appendBlock(blocks, 'thinking', event.delta.thinking ?? event.delta.text);
      continue;
    }

    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      blocks.push({
        type: 'tool_use',
        id: event.content_block.id ?? `tool-${blocks.length}`,
        name: event.content_block.name ?? 'tool',
        input: event.content_block.input,
      });
      continue;
    }

    if (event.type === 'tool_result') {
      blocks.push({
        type: 'tool_result',
        toolUseId: event.tool_use_id ?? `tool-${blocks.length}`,
        content: toToolResultContent(event.content ?? event.tool_result ?? event.content_result),
        isError: Boolean(event.is_error),
      });
      continue;
    }

    if (event.type === 'user' && Array.isArray(event.message?.content)) {
      // Claude Code CLI format: tool results are inside user message events
      for (const item of event.message!.content!) {
        if (item.type === 'tool_result') {
          blocks.push({
            type: 'tool_result',
            toolUseId: item.tool_use_id ?? `tool-${blocks.length}`,
            content: toToolResultContent(item.content),
            isError: Boolean(item.is_error),
          });
        }
      }
      continue;
    }

    if (Array.isArray(event.content)) {
      for (const item of event.content) {
        if (item.type === 'text') {
          appendBlock(blocks, 'text', item.text);
          continue;
        }
        if (item.type === 'thinking') {
          appendBlock(blocks, 'thinking', typeof item.thinking === 'string' ? item.thinking : item.text);
          continue;
        }
        if (item.type === 'tool_use') {
          blocks.push({
            type: 'tool_use',
            id: item.id ?? `tool-${blocks.length}`,
            name: item.name ?? 'tool',
            input: item.input,
          });
        }
      }
    }

    if (event.content_block?.type === 'text') {
      appendBlock(blocks, 'text', event.content_block.text);
    } else if (event.content_block?.type === 'thinking') {
      appendBlock(blocks, 'thinking', event.content_block.thinking ?? event.content_block.text);
    }
  }

  return blocks;
}

function buildBlocksFromEvents(events: StreamJsonEvent[]): MessageContentBlock[] {
  const toolResultBlocks = collectToolResultBlocks(events);
  const fromAssistant = buildFromAssistantEvents(events);
  if (fromAssistant !== null) {
    if (fromAssistant.length > 0 || toolResultBlocks.length > 0) {
      return [...fromAssistant, ...toolResultBlocks];
    }
    // Assistant events were present but produced no recognised blocks and no tool results.
    // Fall through to delta reconstruction.
  }
  return buildFromStreamDeltas(events);
}

function extractStreamJsonTokenUsage(events: StreamJsonEvent[]): TokenUsage | undefined {
  return sumTokenUsage(events as Array<Record<string, unknown>>, (raw) => {
    const event: StreamJsonEvent =
      raw.type === 'stream_event' && raw.event ? (raw.event as StreamJsonEvent) : (raw as StreamJsonEvent);
    if (event.type === 'message_start' && event.message) {
      // message_start carries input tokens and cache stats; output_tokens is 0 for streaming.
      return {
        inputTokens: event.message.usage?.input_tokens ?? 0,
        outputTokens: 0,
        cacheReadTokens: event.message.usage?.cache_read_input_tokens ?? 0,
        cacheCreationTokens: event.message.usage?.cache_creation_input_tokens ?? 0,
        model: event.message.model,
      };
    }
    if (event.type === 'message_delta' && event.usage) {
      // message_delta carries the cumulative output token count; input is already in message_start.
      return {
        inputTokens: 0,
        outputTokens: event.usage.output_tokens ?? 0,
      };
    }
    return null;
  });
}

// Interactive mode emits one `assistant` JSONL entry per chunk, with the final
// chunk carrying the cumulative `message.usage`. Earlier chunks for the same
// message.id may also carry partial usage, so dedupe last-wins per id (avoids
// double-counting within a message), then sum across distinct ids (handles
// multi-turn flushes).
function extractAssistantEventTokenUsage(events: StreamJsonEvent[]): TokenUsage | undefined {
  const lastUsageByMsgId = new Map<
    string,
    { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; model?: string }
  >();
  for (const raw of events) {
    const event: StreamJsonEvent = raw.type === 'stream_event' && raw.event ? raw.event : raw;
    if (event.type !== 'assistant' || !event.message?.usage || !event.message.id) continue;
    const u = event.message.usage;
    if ((u.input_tokens ?? 0) === 0 && (u.output_tokens ?? 0) === 0) continue;
    lastUsageByMsgId.set(event.message.id, {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
      model: event.message.model,
    });
  }
  if (lastUsageByMsgId.size === 0) return undefined;
  return sumTokenUsage(
    Array.from(lastUsageByMsgId.values()) as unknown as Array<Record<string, unknown>>,
    (raw) =>
      raw as {
        inputTokens?: number;
        outputTokens?: number;
        cacheReadTokens?: number;
        cacheCreationTokens?: number;
        model?: string;
      }
  );
}

function extractTokenUsage(events: StreamJsonEvent[]): TokenUsage | undefined {
  // Stream-json (headless) is authoritative when present: it always emits message_start,
  // and its final `assistant` event also carries message.usage which would double-count.
  // Interactive JSONL has no message_start, so fall through to the assistant-event path.
  const hasStreamJsonEnvelope = events.some((raw) => {
    const event: StreamJsonEvent = raw.type === 'stream_event' && raw.event ? raw.event : raw;
    return event.type === 'message_start' || event.type === 'message_delta';
  });
  if (hasStreamJsonEnvelope) return extractStreamJsonTokenUsage(events);
  return extractAssistantEventTokenUsage(events);
}

function extractRateLimits(events: StreamJsonEvent[]): RateLimitWindow[] | undefined {
  return extractRateLimitWindows(events as Array<Record<string, unknown>>);
}

// Split a multi-turn Claude stream into one NormalizedMessageResult per LLM turn.
// Each distinct message.id in the assistant events represents a separate API turn.
export function normalizeClaudeMessages(input: NormalizedMessageInput): NormalizedMessageResult[] {
  if (input.role !== 'assistant') return [buildPlainTextResult(input)];

  const events = parseStreamJsonEvents(input.text);
  if (events.length === 0) return [buildPlainTextResult(input)];

  // Group event indices by message.id, unwrapping stream_event wrappers, preserving first-seen order.
  const turnMap = new Map<string, number[]>();
  const turnOrder: string[] = [];
  for (let idx = 0; idx < events.length; idx++) {
    const event = events[idx];
    const unwrapped: StreamJsonEvent = event.type === 'stream_event' && event.event ? event.event : event;
    if (unwrapped.type === 'assistant' && unwrapped.message?.id) {
      const msgId = unwrapped.message.id;
      if (!turnMap.has(msgId)) {
        turnMap.set(msgId, []);
        turnOrder.push(msgId);
      }
      turnMap.get(msgId)!.push(idx);
    }
  }

  // Single turn (or no assistant events): fall back to regular normalization.
  if (turnOrder.length <= 1) return [normalizeClaude(input)];

  // Multiple turns: one result per turn, skipping turns that produce no blocks.
  const results: NormalizedMessageResult[] = [];
  for (let i = 0; i < turnOrder.length; i++) {
    const msgId = turnOrder[i];
    const thisTurnStart = turnMap.get(msgId)![0];
    const nextTurnStart = i + 1 < turnOrder.length ? turnMap.get(turnOrder[i + 1])![0] : events.length;
    const turnEvents = events.slice(thisTurnStart, nextTurnStart);
    const blocks = buildBlocksFromEvents(turnEvents);
    if (blocks.length === 0) continue;
    results.push(buildStreamResult(input, input.provider, blocks, turnEvents));
  }

  if (results.length > 0) {
    const rateLimitWindows = extractRateLimits(events);
    if (rateLimitWindows) results[results.length - 1].rateLimitWindows = rateLimitWindows;
    // Attach cumulative token usage to the last result so downstream analytics
    // (emitTokenUsage in appendNormalizedMessageWithSource) still fires once per
    // multi-turn flush, matching single-turn normalizeClaude behavior.
    const tokenUsage = extractTokenUsage(events);
    if (tokenUsage) results[results.length - 1].tokenUsage = tokenUsage;
    return results;
  }
  return [normalizeClaude(input)];
}

export function normalizeClaude(input: NormalizedMessageInput): NormalizedMessageResult {
  const fallback = buildPlainTextResult(input);
  if (input.role !== 'assistant') return fallback;

  const events = parseStreamJsonEvents(input.text);
  if (events.length === 0) return fallback;

  const blocks = buildBlocksFromEvents(events);
  if (blocks.length === 0) return fallback;

  return {
    ...buildStreamResult(input, input.provider, blocks, events),
    tokenUsage: extractTokenUsage(events),
    rateLimitWindows: extractRateLimits(events),
  };
}

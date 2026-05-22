import type { MessageContentBlock } from '../../../shared/types';
import type { NormalizedMessageInput, NormalizedMessageResult } from '../types';
import { buildStreamResult, contentFromBlocks } from '../types';
import {
  buildCommandExecutionBlock,
  buildMcpToolCallBlock,
  extractTextFromUnknown,
  parseResponseItemPayload,
} from './blocks';

export const CodexEventType = {
  ThreadStarted: 'thread.started',
  TurnStarted: 'turn.started',
  TurnCompleted: 'turn.completed',
  ThreadCompleted: 'thread.completed',
  ItemStarted: 'item.started',
  ItemCompleted: 'item.completed',
  ItemDone: 'item.done',
  ResponseItem: 'response_item',
  EventMsg: 'event_msg',
  Error: 'error',
  TurnFailed: 'turn.failed',
  AccountRateLimitsUpdated: 'account/ratelimits/updated',
  AccountRateLimitsUpdatedLegacy: 'account.ratelimits.updated',
} as const;

export type CodexEventType = (typeof CodexEventType)[keyof typeof CodexEventType];

export function buildCodexMessageResult(
  input: NormalizedMessageInput,
  blocks: MessageContentBlock[],
  rawPayload: unknown
): NormalizedMessageResult | null {
  if (blocks.length === 0) return null;
  const content = contentFromBlocks(blocks);
  if (!content && blocks.every((b) => b.type !== 'tool_use' && b.type !== 'tool_result' && b.type !== 'thinking')) {
    return null;
  }
  return buildStreamResult(input, 'codex', blocks, rawPayload);
}

/**
 * Extracts plain text fragments from Codex events — shared by the normalizer and decodeCodexBuffer.
 * Only message-bearing events are considered; tool-use/tool-result events are ignored.
 */
export function extractCodexTextFragments(events: Array<Record<string, unknown>>): string[] {
  const texts: string[] = [];
  for (const event of events) {
    const type = typeof event.type === 'string' ? event.type.toLowerCase() : '';

    if (
      type === CodexEventType.ItemStarted ||
      type === CodexEventType.ItemCompleted ||
      type === CodexEventType.ItemDone
    ) {
      const item = event.item;
      if (!item || typeof item !== 'object') continue;
      const it = item as Record<string, unknown>;
      const itemType = typeof it.type === 'string' ? it.type.toLowerCase() : '';
      if (itemType === 'agent_message' || itemType === 'message') {
        const text = extractTextFromUnknown(it).join('').trim();
        if (text) texts.push(text);
      }
      continue;
    }

    if (type === CodexEventType.ResponseItem) {
      const payload = event.payload;
      if (!payload || typeof payload !== 'object') continue;
      const { textBlock } = parseResponseItemPayload(payload as Record<string, unknown>);
      if (textBlock && 'text' in textBlock) texts.push((textBlock as { type: 'text'; text: string }).text);
      continue;
    }

    if (type === CodexEventType.EventMsg) {
      const payload = event.payload;
      if (!payload || typeof payload !== 'object') continue;
      const pType = String((payload as Record<string, unknown>).type ?? '').toLowerCase();
      if (pType === 'task_complete') {
        const msg = (payload as Record<string, unknown>).last_agent_message;
        if (typeof msg === 'string' && msg.trim()) texts.push(msg.trim());
      }
    }
  }
  return texts;
}

export function buildFromCodexJsonEvents(
  input: NormalizedMessageInput,
  events: Array<Record<string, unknown>>
): NormalizedMessageResult | null {
  const blocks: MessageContentBlock[] = [];
  const errorParts: string[] = [];
  // Deduplicate terminal results (item.completed + item.done) by item id.
  const terminalItemIds = new Set<string>();

  for (const event of events) {
    const type = typeof event.type === 'string' ? event.type.toLowerCase() : '';
    if (!type) continue;

    if (
      type === CodexEventType.ThreadStarted ||
      type === CodexEventType.TurnStarted ||
      type === CodexEventType.TurnCompleted
    )
      continue;

    if (type === CodexEventType.AccountRateLimitsUpdated || type === CodexEventType.AccountRateLimitsUpdatedLegacy) {
      continue;
    }

    // Streaming format: item.started / item.completed / item.done
    if (
      type === CodexEventType.ItemStarted ||
      type === CodexEventType.ItemCompleted ||
      type === CodexEventType.ItemDone
    ) {
      const item = event.item;
      if (!item || typeof item !== 'object') continue;
      const it = item as Record<string, unknown>;
      const itemType = typeof it.type === 'string' ? it.type.toLowerCase() : '';

      if (type !== CodexEventType.ItemStarted) {
        // Deduplicate: only emit one terminal result per item id.
        const itemId = String(it.id ?? '');
        if (itemId && terminalItemIds.has(itemId)) continue;
        if (itemId) terminalItemIds.add(itemId);
      }

      if (itemType === 'command_execution') {
        blocks.push(buildCommandExecutionBlock(it, type));
      } else if (itemType === 'mcp_tool_call') {
        blocks.push(buildMcpToolCallBlock(it, type));
      } else if (itemType === 'agent_message' || itemType === 'message') {
        const extracted = extractTextFromUnknown(item);
        if (extracted.length > 0) blocks.push({ type: 'text', text: extracted.join('\n') });
      }
      continue;
    }

    // Session log format: response_item — payload carries the item type
    if (type === CodexEventType.ResponseItem) {
      const payload = event.payload;
      if (payload && typeof payload === 'object') {
        const { textBlock, otherBlocks } = parseResponseItemPayload(payload as Record<string, unknown>);
        if (textBlock) blocks.push(textBlock);
        blocks.push(...otherBlocks);
      }
      continue;
    }

    // Session log format: event_msg — task_complete carries last_agent_message
    if (type === CodexEventType.EventMsg) {
      const payload = event.payload;
      if (payload && typeof payload === 'object') {
        const pType = String((payload as Record<string, unknown>).type ?? '').toLowerCase();
        if (pType === 'task_complete') {
          const msg = (payload as Record<string, unknown>).last_agent_message;
          if (typeof msg === 'string' && msg.trim()) blocks.push({ type: 'text', text: msg.trim() });
        }
      }
      continue;
    }

    if (type === CodexEventType.Error || type === CodexEventType.TurnFailed) {
      const extracted = extractTextFromUnknown(event.error ?? event.message ?? event);
      if (extracted.length > 0) errorParts.push(...extracted);
      continue;
    }
  }

  if (blocks.length === 0 && errorParts.length === 0) return null;

  // If blocks have no text content, fall back to errorParts as the visible content.
  if (!contentFromBlocks(blocks) && errorParts.length > 0) {
    blocks.push({ type: 'text', text: errorParts.join('\n') });
  }

  return buildStreamResult(input, 'codex', blocks, events);
}

export function buildSplitMessagesFromCodexJsonEvents(
  input: NormalizedMessageInput,
  events: Array<Record<string, unknown>>
): NormalizedMessageResult[] {
  const results: NormalizedMessageResult[] = [];
  let pendingBlocks: MessageContentBlock[] = [];
  let pendingEvents: Array<Record<string, unknown>> = [];
  // Deduplicate terminal results by item id.
  const terminalItemIds = new Set<string>();

  const flush = (): void => {
    const result = buildCodexMessageResult(input, pendingBlocks, pendingEvents);
    if (result) results.push(result);
    pendingBlocks = [];
    pendingEvents = [];
  };

  const pushTextMessage = (text: string, event: Record<string, unknown>): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    pendingBlocks.push({ type: 'text', text: trimmed });
    pendingEvents.push(event);
    flush();
  };

  for (const event of events) {
    const type = typeof event.type === 'string' ? event.type.toLowerCase() : '';
    if (
      !type ||
      type === CodexEventType.ThreadStarted ||
      type === CodexEventType.TurnStarted ||
      type === CodexEventType.TurnCompleted
    )
      continue;

    if (
      type === CodexEventType.ItemStarted ||
      type === CodexEventType.ItemCompleted ||
      type === CodexEventType.ItemDone
    ) {
      const item = event.item;
      if (!item || typeof item !== 'object') continue;
      const it = item as Record<string, unknown>;
      const itemType = typeof it.type === 'string' ? it.type.toLowerCase() : '';

      if (type !== CodexEventType.ItemStarted) {
        // Deduplicate: only process one terminal result per item id.
        const itemId = String(it.id ?? '');
        if (itemId && terminalItemIds.has(itemId)) continue;
        if (itemId) terminalItemIds.add(itemId);
      }

      if (itemType === 'command_execution') {
        pendingEvents.push(event);
        pendingBlocks.push(buildCommandExecutionBlock(it, type));
        continue;
      }

      if (itemType === 'mcp_tool_call') {
        pendingEvents.push(event);
        pendingBlocks.push(buildMcpToolCallBlock(it, type));
        continue;
      }

      if (itemType === 'agent_message' || itemType === 'message') {
        const extracted = extractTextFromUnknown(item).join('\n').trim();
        pushTextMessage(extracted, event);
      }
      continue;
    }

    if (type === CodexEventType.ResponseItem) {
      const payload = event.payload;
      if (!payload || typeof payload !== 'object') continue;
      const { textBlock, otherBlocks } = parseResponseItemPayload(payload as Record<string, unknown>);
      if (textBlock) {
        pushTextMessage((textBlock as { type: 'text'; text: string }).text, event);
      } else if (otherBlocks.length > 0) {
        pendingEvents.push(event);
        pendingBlocks.push(...otherBlocks);
      }
      continue;
    }

    if (type === CodexEventType.EventMsg) {
      const payload = event.payload;
      if (payload && typeof payload === 'object') {
        const pType = String((payload as Record<string, unknown>).type ?? '').toLowerCase();
        if (pType === 'task_complete') {
          const msg = (payload as Record<string, unknown>).last_agent_message;
          if (typeof msg === 'string' && msg.trim()) pushTextMessage(msg, event);
        }
      }
      continue;
    }

    if (type === CodexEventType.Error || type === CodexEventType.TurnFailed) {
      const extracted = extractTextFromUnknown(event.error ?? event.message ?? event)
        .join('\n')
        .trim();
      if (extracted) {
        pendingEvents.push(event);
        pendingBlocks.push({ type: 'text', text: extracted });
        flush();
      }
      continue;
    }
  }

  flush();
  return results;
}

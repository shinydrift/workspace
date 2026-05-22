import type { MessageContentBlock } from '../../shared/types';
import { scanJsonObjects } from '../../shared/utils/scanJsonObjects';

// Shared type for stream-JSON events (renderer-side, subset of main process type).
type StreamEvent = {
  type?: string;
  event?: StreamEvent;
  message?: {
    role?: string;
    content?: Array<{
      type?: string;
      text?: string;
      thinking?: string;
      id?: string;
      name?: string;
      input?: unknown;
      tool_use_id?: string;
      is_error?: boolean;
      content?: unknown;
    }>;
  };
  delta?: { type?: string; text?: string; thinking?: string };
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
};

// Parse concatenated JSON objects (no newline separators) from Claude PTY output.
function scanJsonEvents(raw: string): StreamEvent[] {
  if (!raw.includes('"type"')) return [];
  return scanJsonObjects(raw) as StreamEvent[];
}

function unwrap(rawEvent: StreamEvent): StreamEvent {
  if (rawEvent.type === 'stream_event' && rawEvent.event) {
    return {
      ...rawEvent.event,
      tool_use_id: rawEvent.event.tool_use_id ?? rawEvent.tool_use_id,
      is_error: rawEvent.event.is_error ?? rawEvent.is_error,
      content: rawEvent.event.content ?? rawEvent.content,
    };
  }
  return rawEvent;
}

function appendBlock(blocks: MessageContentBlock[], type: 'text' | 'thinking', text: string): void {
  const prev = blocks[blocks.length - 1];
  if (prev?.type === type) prev.text += text;
  else blocks.push({ type, text } as MessageContentBlock);
}

// Extract readable text from Claude --output-format stream-json events.
// Returns null if the text doesn't look like stream-JSON (pass-through for plain text).
// Returns '' if it IS stream-JSON but no text has been emitted yet.
export function extractStreamText(raw: string): string | null {
  const events = scanJsonEvents(raw);
  if (events.length === 0) return null;
  // Collect text from ALL 'assistant' events (handles multi-turn + thinking-only first events).
  const assistantTexts = events
    .filter((e) => e.type === 'assistant' && e.message?.content)
    .flatMap((e) => e.message!.content!.filter((b) => b.type === 'text').map((b) => b.text ?? ''));
  if (assistantTexts.length > 0) return assistantTexts.join('\n\n');
  // Fall back to accumulating text_delta values (for mid-stream rendering).
  const parts = events
    .map(unwrap)
    .filter((e) => e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && e.delta.text)
    .map((e) => e.delta!.text!);
  return parts.join(''); // '' if no text yet (don't fall back to raw JSON)
}

// Extract structured blocks (text + tool_use) from Claude stream-JSON for live rendering.
export function extractStreamBlocks(raw: string): MessageContentBlock[] {
  const events = scanJsonEvents(raw);
  if (events.length === 0) return [];
  // Collect all content items from assistant events, skipping thinking.
  const content = events
    .map(unwrap)
    .filter((e) => e.type === 'assistant' && e.message?.content)
    .flatMap((e) => e.message!.content!);
  const blocks: MessageContentBlock[] = [];
  for (const item of content) {
    if (item.type === 'text' && item.text) {
      blocks.push({ type: 'text', text: item.text });
    } else if (item.type === 'thinking') {
      const thinkingText = typeof item.thinking === 'string' ? item.thinking : item.text;
      if (thinkingText) blocks.push({ type: 'thinking', text: thinkingText });
    } else if (item.type === 'tool_use') {
      blocks.push({ type: 'tool_use', id: item.id ?? 'tool', name: item.name ?? 'tool', input: item.input });
    }
  }
  const resultBlocks: MessageContentBlock[] = [];
  for (const rawEvent of events) {
    const e = unwrap(rawEvent);
    if (e.type === 'tool_result') {
      resultBlocks.push({
        type: 'tool_result',
        toolUseId: e.tool_use_id ?? 'tool',
        content: typeof e.content === 'string' ? e.content : JSON.stringify(e.content ?? ''),
        isError: e.is_error,
      });
    } else if (e.type === 'user' && Array.isArray(e.message?.content)) {
      // Claude Code CLI format: tool results are inside user message events
      for (const item of e.message!.content!) {
        if (item.type === 'tool_result') {
          resultBlocks.push({
            type: 'tool_result',
            toolUseId: item.tool_use_id ?? 'tool',
            content: typeof item.content === 'string' ? item.content : JSON.stringify(item.content ?? ''),
            isError: item.is_error,
          });
        }
      }
    }
  }
  // Also accumulate deltas from the current in-progress (not-yet-consolidated) turn,
  // so text/thinking stream incrementally even when prior turns are already consolidated.
  const lastConsolidatedIdx = events.reduce(
    (max, e, i) => (e.type === 'assistant' && e.message?.content ? i : max),
    -1
  );
  if (lastConsolidatedIdx >= 0) {
    for (const rawEvent of events.slice(lastConsolidatedIdx + 1)) {
      const e = unwrap(rawEvent);
      if (e.type !== 'content_block_delta') continue;
      if (e.delta?.type === 'text_delta' && e.delta.text) {
        appendBlock(blocks, 'text', e.delta.text);
      } else if (e.delta?.type === 'thinking_delta') {
        const t = e.delta.thinking ?? e.delta.text;
        if (t) appendBlock(blocks, 'thinking', t);
      }
    }
  }

  if (blocks.length > 0 || resultBlocks.length > 0) return [...blocks, ...resultBlocks];
  // Fall back to text_delta accumulation (used while the first LLM turn is still streaming).
  const out: MessageContentBlock[] = [];
  for (const rawEvent of events) {
    if (rawEvent.type !== 'content_block_delta' && rawEvent.type !== 'stream_event') continue;
    const e = unwrap(rawEvent);
    if (e.type !== 'content_block_delta') continue;
    if (e.delta?.type === 'thinking_delta') {
      const text = e.delta.thinking ?? e.delta.text;
      if (text) appendBlock(out, 'thinking', text);
    } else if (e.delta?.type === 'text_delta' && e.delta.text) {
      appendBlock(out, 'text', e.delta.text);
    }
  }
  return out;
}

// Extract structured blocks from Codex --json streaming output (live rendering).
export function extractCodexStreamBlocks(raw: string): MessageContentBlock[] {
  const extractTextFromUnknown = (value: unknown): string[] => {
    if (typeof value === 'string') return value.trim() ? [value] : [];
    if (Array.isArray(value)) return value.flatMap((item) => extractTextFromUnknown(item));
    if (!value || typeof value !== 'object') return [];

    const obj = value as Record<string, unknown>;
    const out: string[] = [];
    for (const key of ['text', 'content', 'message', 'output_text', 'output', 'delta']) {
      if (key in obj) out.push(...extractTextFromUnknown(obj[key]));
    }
    return out;
  };

  const buildMcpToolCallBlock = (item: Record<string, unknown>, type: string): MessageContentBlock => {
    const itemId = String(item.id ?? '');
    const toolName = `mcp__${item.server ?? ''}__${item.tool ?? ''}`;
    if (type === 'item.started') {
      return { type: 'tool_use', id: itemId, name: toolName, input: item.arguments ?? {} };
    }

    let output = '';
    if (typeof item.output === 'string') {
      output = item.output;
    } else if (item.result && typeof item.result === 'object') {
      const resultContent = (item.result as Record<string, unknown>).content;
      if (Array.isArray(resultContent)) {
        output = resultContent
          .filter(
            (c): c is { type: string; text: string } =>
              !!c && typeof c === 'object' && (c as Record<string, unknown>).type === 'text'
          )
          .map((c) => c.text)
          .join('\n');
      }
    }
    return { type: 'tool_result', toolUseId: itemId, content: output, isError: item.status === 'failed' };
  };

  const parseResponseItemPayload = (payload: Record<string, unknown>): MessageContentBlock[] => {
    const payloadType = String(payload.type ?? '').toLowerCase();
    if (payloadType === 'message' && String(payload.role ?? '').toLowerCase() === 'assistant') {
      const extracted = extractTextFromUnknown(payload.content);
      return extracted.length > 0 ? [{ type: 'text', text: extracted.join('\n') }] : [];
    }
    if (payloadType === 'function_call') {
      let toolInput: unknown = {};
      try {
        toolInput = typeof payload.arguments === 'string' ? JSON.parse(payload.arguments) : (payload.arguments ?? {});
      } catch {
        toolInput = { raw: payload.arguments };
      }
      return [
        {
          type: 'tool_use',
          id: String(payload.call_id ?? payload.id ?? ''),
          name: String(payload.name ?? ''),
          input: toolInput,
        },
      ];
    }
    if (payloadType === 'function_call_output') {
      const output = typeof payload.output === 'string' ? payload.output : JSON.stringify(payload.output ?? '');
      return [{ type: 'tool_result', toolUseId: String(payload.call_id ?? ''), content: output }];
    }
    if (payloadType === 'reasoning') {
      const summary = Array.isArray(payload.summary) ? payload.summary : [];
      const text = summary
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object') return String((item as Record<string, unknown>).text ?? '');
          return '';
        })
        .join('')
        .trim();
      return text ? [{ type: 'thinking', text }] : [];
    }
    return [];
  };

  const blocks: MessageContentBlock[] = [];
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = typeof event.type === 'string' ? event.type.toLowerCase() : '';

    if (type === 'item.started' || type === 'item.completed' || type === 'item.done') {
      const item = event.item;
      if (!item || typeof item !== 'object') continue;
      const it = item as Record<string, unknown>;
      const itemType = typeof it.type === 'string' ? it.type.toLowerCase() : '';
      if (itemType === 'command_execution') {
        const itemId = String(it.id ?? '');
        const command = typeof it.command === 'string' ? it.command : '';
        if (type === 'item.started') {
          blocks.push({ type: 'tool_use', id: itemId, name: 'shell', input: { command } });
        } else {
          const output = typeof it.aggregated_output === 'string' ? it.aggregated_output : '';
          const isError = it.status === 'failed' || (typeof it.exit_code === 'number' && it.exit_code !== 0);
          blocks.push({ type: 'tool_result', toolUseId: itemId, content: output, isError });
        }
      } else if (itemType === 'mcp_tool_call') {
        blocks.push(buildMcpToolCallBlock(it, type));
      } else if (itemType === 'agent_message' || itemType === 'message') {
        const extracted = extractTextFromUnknown(it);
        if (extracted.length > 0) blocks.push({ type: 'text', text: extracted.join('\n') });
      }
    } else if (type === 'response_item') {
      const payload = event.payload;
      if (!payload || typeof payload !== 'object') continue;
      blocks.push(...parseResponseItemPayload(payload as Record<string, unknown>));
    } else if (type === 'event_msg') {
      const payload = event.payload;
      if (payload && typeof payload === 'object') {
        const pType = String((payload as Record<string, unknown>).type ?? '').toLowerCase();
        if (pType === 'task_complete') {
          const msg = (payload as Record<string, unknown>).last_agent_message;
          if (typeof msg === 'string' && msg.trim()) blocks.push({ type: 'text', text: msg.trim() });
        }
      }
    } else if (type === 'error' || type === 'turn.failed') {
      const extracted = extractTextFromUnknown(event.error ?? event.message ?? event);
      if (extracted.length > 0) blocks.push({ type: 'text', text: extracted.join('\n') });
    } else if (
      type.includes('agent') ||
      type.includes('assistant') ||
      type.includes('message') ||
      type.includes('output')
    ) {
      const extracted = extractTextFromUnknown(event);
      if (extracted.length > 0) blocks.push({ type: 'text', text: extracted.join('\n') });
    }
  }
  return blocks;
}

// Extract structured blocks from Gemini --output-format stream-json output.
export function extractGeminiStreamBlocks(raw: string): MessageContentBlock[] {
  const blocks: MessageContentBlock[] = [];

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('{') || !line.endsWith('}')) continue;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = typeof event.type === 'string' ? event.type.toLowerCase() : '';
    if (type === 'tool_use') {
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

    if (type === 'tool_result') {
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

    if (type !== 'message') continue;

    const role = typeof event.role === 'string' ? event.role.toLowerCase() : '';
    if (role !== 'assistant') continue;

    const content = typeof event.content === 'string' ? event.content : '';
    if (content) appendBlock(blocks, 'text', content);
  }
  return blocks;
}

import type { MessageContentBlock } from '../../../shared/types';
import { safeStringify } from '../types';

export function extractTextFromUnknown(value: unknown, depth = 0): string[] {
  if (depth > 10) return [];
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTextFromUnknown(item, depth + 1));
  }
  if (!value || typeof value !== 'object') return [];

  const obj = value as Record<string, unknown>;
  const out: string[] = [];
  const directKeys = ['text', 'content', 'message', 'output_text', 'output', 'delta'];
  for (const key of directKeys) {
    if (key in obj) out.push(...extractTextFromUnknown(obj[key], depth + 1));
  }
  return out;
}

export function buildCommandExecutionBlock(it: Record<string, unknown>, type: string): MessageContentBlock {
  const itemId = String(it.id ?? '');
  if (type === 'item.started') {
    return {
      type: 'tool_use',
      id: itemId,
      name: 'shell',
      input: { command: typeof it.command === 'string' ? it.command : '' },
    };
  }
  const output = typeof it.aggregated_output === 'string' ? it.aggregated_output : '';
  const isError = it.status === 'failed' || (typeof it.exit_code === 'number' && it.exit_code !== 0);
  return { type: 'tool_result', toolUseId: itemId, content: output, isError };
}

export function buildMcpToolCallBlock(it: Record<string, unknown>, type: string): MessageContentBlock {
  const itemId = String(it.id ?? '');
  const server = String(it.server ?? '');
  const tool = String(it.tool ?? '');
  const toolName = server || tool ? `mcp__${server}__${tool}` : 'mcp__unknown__unknown';
  if (type === 'item.started') {
    return { type: 'tool_use', id: itemId, name: toolName, input: it.arguments ?? {} };
  }
  let output = '';
  if (typeof it.output === 'string') {
    output = it.output;
  } else if (it.result && typeof it.result === 'object') {
    const resultContent = (it.result as Record<string, unknown>).content;
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
  return { type: 'tool_result', toolUseId: itemId, content: output, isError: it.status === 'failed' };
}

// Returns { textBlock, otherBlocks } so callers can handle text separately (e.g. flush in split mode)
export function parseResponseItemPayload(p: Record<string, unknown>): {
  textBlock: MessageContentBlock | null;
  otherBlocks: MessageContentBlock[];
} {
  const pType = String(p.type ?? '').toLowerCase();
  if (pType === 'message' && String(p.role ?? '').toLowerCase() === 'assistant') {
    const extracted = extractTextFromUnknown(p.content);
    return { textBlock: extracted.length > 0 ? { type: 'text', text: extracted.join('\n') } : null, otherBlocks: [] };
  }
  if (pType === 'function_call') {
    let toolInput: unknown = {};
    try {
      toolInput = typeof p.arguments === 'string' ? JSON.parse(p.arguments) : (p.arguments ?? {});
    } catch {
      toolInput = { raw: p.arguments };
    }
    return {
      textBlock: null,
      otherBlocks: [
        { type: 'tool_use', id: String(p.call_id ?? p.id ?? ''), name: String(p.name ?? ''), input: toolInput },
      ],
    };
  }
  if (pType === 'function_call_output') {
    const output = p.output == null ? '' : typeof p.output === 'string' ? p.output : safeStringify(p.output);
    return {
      textBlock: null,
      otherBlocks: [{ type: 'tool_result', toolUseId: String(p.call_id ?? ''), content: output }],
    };
  }
  if (pType === 'reasoning') {
    const summary = Array.isArray(p.summary) ? p.summary : [];
    const text = summary
      .map((s: unknown) => {
        if (typeof s === 'string') return s;
        if (s && typeof s === 'object') return String((s as Record<string, unknown>).text ?? '');
        return '';
      })
      .join('')
      .trim();
    return { textBlock: null, otherBlocks: text ? [{ type: 'thinking', text }] : [] };
  }
  return { textBlock: null, otherBlocks: [] };
}

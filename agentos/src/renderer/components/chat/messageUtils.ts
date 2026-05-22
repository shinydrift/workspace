import React from 'react';
import type { Message, MessageContentBlock } from '../../../shared/types';

export function handleCodeCopy(e: React.MouseEvent<HTMLDivElement>) {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.copy-code-btn');
  if (!btn) return;
  navigator.clipboard.writeText(decodeURIComponent(btn.dataset.code ?? '')).catch((err) => {
    console.warn('Failed to copy to clipboard', err);
  });
  btn.setAttribute('data-copied', '');
  setTimeout(() => {
    btn.removeAttribute('data-copied');
  }, 2000);
}

export type ToolUseBlock = Extract<MessageContentBlock, { type: 'tool_use' }>;
export type ToolResultBlock = Extract<MessageContentBlock, { type: 'tool_result' }>;
export type TextBlock = Extract<MessageContentBlock, { type: 'text' }>;
export type ThinkingBlock = Extract<MessageContentBlock, { type: 'thinking' }>;

export type ToolPair = { use: ToolUseBlock; result?: ToolResultBlock };

export type Section =
  | { kind: 'text'; block: TextBlock }
  | { kind: 'thinking'; block: ThinkingBlock }
  | { kind: 'tool_group'; tools: ToolPair[]; title: string };

function toolGroupTitle(tools: ToolPair[]): string {
  function primaryArg(input: unknown): string {
    if (!input || typeof input !== 'object') return '';
    const a = input as Record<string, unknown>;
    if (typeof a.description === 'string') return a.description;
    if (typeof a.prompt === 'string') return a.prompt.length > 50 ? a.prompt.slice(0, 50) + '…' : a.prompt;
    if (typeof a.file_path === 'string') return a.file_path.split('/').pop() ?? a.file_path;
    if (typeof a.path === 'string') return a.path.split('/').pop() ?? a.path;
    if (typeof a.command === 'string') return a.command.length > 50 ? a.command.slice(0, 50) + '…' : a.command;
    if (typeof a.pattern === 'string') return a.pattern;
    if (typeof a.query === 'string') return a.query;
    if (typeof a.url === 'string') return a.url;
    return '';
  }
  function displayName(name: string): string {
    const l = name.toLowerCase();
    if (l === 'agent' || l === 'task') return 'Task';
    return name;
  }
  if (tools.length === 1) {
    const { use } = tools[0];
    const arg = primaryArg(use.input);
    const dn = displayName(use.name);
    return arg ? `${dn} · ${arg}` : dn;
  }
  const counts = new Map<string, number>();
  for (const t of tools) {
    const dn = displayName(t.use.name);
    counts.set(dn, (counts.get(dn) ?? 0) + 1);
  }
  return [...counts.entries()].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(', ');
}

/** Pair tool_use with its tool_result by id, then group consecutive pairs into sections. */
export function buildSections(blocks: MessageContentBlock[]): Section[] {
  // Build result lookup
  const resultMap = new Map<string, ToolResultBlock>();
  for (const b of blocks) {
    if (b.type === 'tool_result') resultMap.set(b.toolUseId, b);
  }

  // Pair blocks
  const paired: Array<
    { kind: 'text'; block: TextBlock } | { kind: 'thinking'; block: ThinkingBlock } | { kind: 'tool'; pair: ToolPair }
  > = [];
  for (const b of blocks) {
    if (b.type === 'text') {
      paired.push({ kind: 'text', block: b });
    } else if (b.type === 'thinking') {
      paired.push({ kind: 'thinking', block: b });
    } else if (b.type === 'tool_use') {
      const result = resultMap.get(b.id);
      if (result) resultMap.delete(b.id);
      paired.push({ kind: 'tool', pair: { use: b, result } });
    }
    // tool_result handled via resultMap above
  }

  // Group consecutive tools into tool_group sections
  const raw: Section[] = [];
  let accum: ToolPair[] = [];
  const flush = () => {
    if (accum.length > 0) {
      raw.push({ kind: 'tool_group', tools: accum, title: '' });
      accum = [];
    }
  };
  for (const item of paired) {
    if (item.kind === 'tool') {
      accum.push(item.pair);
    } else if (item.kind === 'text') {
      flush();
      raw.push({ kind: 'text', block: item.block });
    } else {
      flush();
      raw.push({ kind: 'thinking', block: item.block });
    }
  }
  flush();

  for (const s of raw) {
    if (s.kind === 'tool_group') s.title = toolGroupTitle(s.tools);
  }

  return raw;
}

// Interactive mode flushes each Claude Code JSONL entry as its own assistant message, so
// a single agent turn that issues N tools shows up as N adjacent messages with one
// tool_use (and the matching tool_result message) each. Coalesce those runs back into
// one virtual message so buildSections() collapses them into a tool_group — matching how
// headless renders, where the whole turn already lands in one message.
function isToolOnlyAssistantMessage(msg: Message): boolean {
  if (msg.role !== 'assistant') return false;
  if (msg.source === 'autopilot-decision' || msg.source === 'autopilot') return false;
  const blocks = msg.normalized?.blocks;
  if (!blocks || blocks.length === 0) return false;
  return blocks.every((b) => b.type === 'tool_use' || b.type === 'tool_result');
}

export function coalesceToolOnlyMessages(messages: Message[]): Message[] {
  const result: Message[] = [];
  let run: Message[] = [];
  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      result.push(run[0]);
    } else {
      const first = run[0];
      const mergedBlocks: MessageContentBlock[] = [];
      for (const m of run) {
        if (m.normalized?.blocks) mergedBlocks.push(...m.normalized.blocks);
      }
      const base = first.normalized;
      // Drop `raw` from the merged result — hydrateMissingToolResults() would only repair
      // tool_uses missing their tool_result, but the run we just merged already carries
      // every tool_result message into mergedBlocks, so hydration has nothing to do.
      result.push({
        ...first,
        normalized: base
          ? { schemaVersion: base.schemaVersion, provider: base.provider, role: base.role, blocks: mergedBlocks }
          : undefined,
      });
    }
    run = [];
  };
  for (const msg of messages) {
    if (isToolOnlyAssistantMessage(msg)) {
      run.push(msg);
    } else {
      flush();
      result.push(msg);
    }
  }
  flush();
  return result;
}

export function hydrateMissingToolResults(blocks: MessageContentBlock[], rawPayload: unknown): MessageContentBlock[] {
  const hasToolUse = blocks.some((b) => b.type === 'tool_use');
  const hasToolResult = blocks.some((b) => b.type === 'tool_result');
  if (!hasToolUse || hasToolResult) return blocks;
  if (!Array.isArray(rawPayload)) return blocks;

  const results: MessageContentBlock[] = [];
  for (const candidate of rawPayload) {
    if (!candidate || typeof candidate !== 'object') continue;
    const top = candidate as Record<string, unknown>;
    const event =
      top.type === 'stream_event' && top.event && typeof top.event === 'object'
        ? (top.event as Record<string, unknown>)
        : top;
    if (event.type === 'tool_result') {
      const toolUseId = typeof event.tool_use_id === 'string' ? event.tool_use_id : '';
      if (!toolUseId) continue;
      const content = typeof event.content === 'string' ? event.content : JSON.stringify(event.content ?? '');
      const isError = typeof event.is_error === 'boolean' ? event.is_error : undefined;
      results.push({ type: 'tool_result', toolUseId, content, isError });
    } else if (event.type === 'user') {
      // Claude Code CLI format: tool results are inside user message events
      const msgContent =
        event.message && typeof event.message === 'object' ? (event.message as Record<string, unknown>).content : null;
      if (!Array.isArray(msgContent)) continue;
      for (const item of msgContent) {
        if (!item || typeof item !== 'object') continue;
        const it = item as Record<string, unknown>;
        if (it.type !== 'tool_result') continue;
        const toolUseId = typeof it.tool_use_id === 'string' ? it.tool_use_id : '';
        if (!toolUseId) continue;
        const content = typeof it.content === 'string' ? it.content : JSON.stringify(it.content ?? '');
        const isError = typeof it.is_error === 'boolean' ? it.is_error : undefined;
        results.push({ type: 'tool_result', toolUseId, content, isError });
      }
    }
  }

  if (results.length === 0) return blocks;
  return [...blocks, ...results];
}

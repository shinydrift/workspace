import { afterEach, test, expect, vi } from 'vitest';
import {
  buildSections,
  coalesceToolOnlyMessages,
  handleCodeCopy,
  hydrateMissingToolResults,
} from '../../../../src/renderer/components/chat/messageUtils';
import type { Message, MessageContentBlock } from '../../../../src/shared/types';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ── handleCodeCopy ────────────────────────────────────────────────────────────

test('handleCodeCopy: ignores clicks outside copy-code buttons', () => {
  const writeText = vi.fn();
  vi.stubGlobal('navigator', { clipboard: { writeText } });

  const target = document.createElement('span');
  handleCodeCopy({ target } as unknown as React.MouseEvent<HTMLDivElement>);

  expect(writeText).not.toHaveBeenCalled();
});

test('handleCodeCopy: copies decoded code and clears copied marker', async () => {
  vi.useFakeTimers();
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });

  const button = document.createElement('button');
  button.className = 'copy-code-btn';
  button.dataset.code = encodeURIComponent('const value = 42;');

  handleCodeCopy({ target: button } as unknown as React.MouseEvent<HTMLDivElement>);
  await vi.runAllTimersAsync();

  expect(writeText).toHaveBeenCalledWith('const value = 42;');
  expect(button.hasAttribute('data-copied')).toBe(false);
});

// ── buildSections ─────────────────────────────────────────────────────────────

test('buildSections: text-only blocks produce text sections', () => {
  const blocks: MessageContentBlock[] = [{ type: 'text', text: 'hello' }];
  const sections = buildSections(blocks);
  expect(sections.length).toBe(1);
  expect(sections[0].kind).toBe('text');
});

test('buildSections: thinking block produces thinking section', () => {
  const blocks: MessageContentBlock[] = [{ type: 'thinking', thinking: 'hmm...' }];
  const sections = buildSections(blocks);
  expect(sections.length).toBe(1);
  expect(sections[0].kind).toBe('thinking');
});

test('buildSections: tool_use + tool_result become one tool_group', () => {
  const blocks: MessageContentBlock[] = [
    { type: 'tool_use', id: 'u1', name: 'Read', input: { file_path: '/foo' } },
    { type: 'tool_result', toolUseId: 'u1', content: 'file content' },
  ];
  const sections = buildSections(blocks);
  expect(sections.length).toBe(1);
  expect(sections[0].kind).toBe('tool_group');
  if (sections[0].kind === 'tool_group') {
    expect(sections[0].tools.length).toBe(1);
    expect(sections[0].tools[0].result).toBeTruthy();
  }
});

test('buildSections: consecutive tool uses are grouped together', () => {
  const blocks: MessageContentBlock[] = [
    { type: 'tool_use', id: 'u1', name: 'Read', input: {} },
    { type: 'tool_use', id: 'u2', name: 'Write', input: {} },
    { type: 'tool_result', toolUseId: 'u1', content: '' },
    { type: 'tool_result', toolUseId: 'u2', content: '' },
  ];
  const sections = buildSections(blocks);
  expect(sections.length).toBe(1);
  expect(sections[0].kind).toBe('tool_group');
  if (sections[0].kind === 'tool_group') {
    expect(sections[0].tools.length).toBe(2);
  }
});

test('buildSections: text between tools splits into multiple sections', () => {
  const blocks: MessageContentBlock[] = [
    { type: 'tool_use', id: 'u1', name: 'Read', input: {} },
    { type: 'tool_result', toolUseId: 'u1', content: '' },
    { type: 'text', text: 'done' },
    { type: 'tool_use', id: 'u2', name: 'Write', input: {} },
    { type: 'tool_result', toolUseId: 'u2', content: '' },
  ];
  const sections = buildSections(blocks);
  expect(sections.length).toBe(3); // tool_group, text, tool_group
  expect(sections[0].kind).toBe('tool_group');
  expect(sections[1].kind).toBe('text');
  expect(sections[2].kind).toBe('tool_group');
});

test('buildSections: tool_group title is set for single tool', () => {
  const blocks: MessageContentBlock[] = [
    { type: 'tool_use', id: 'u1', name: 'Read', input: { file_path: '/src/foo.ts' } },
    { type: 'tool_result', toolUseId: 'u1', content: '' },
  ];
  const sections = buildSections(blocks);
  if (sections[0].kind === 'tool_group') {
    expect(sections[0].title.includes('Read')).toBeTruthy();
  }
});

test('buildSections: single task tool title uses prompt summary and display name', () => {
  const longPrompt = 'x'.repeat(60);
  const blocks: MessageContentBlock[] = [{ type: 'tool_use', id: 'u1', name: 'agent', input: { prompt: longPrompt } }];
  const sections = buildSections(blocks);
  expect(sections[0].kind).toBe('tool_group');
  if (sections[0].kind === 'tool_group') {
    expect(sections[0].title).toBe(`Task · ${'x'.repeat(50)}…`);
  }
});

test('buildSections: multi-tool title groups duplicate display names', () => {
  const blocks: MessageContentBlock[] = [
    { type: 'tool_use', id: 'u1', name: 'Read', input: {} },
    { type: 'tool_use', id: 'u2', name: 'Read', input: {} },
    { type: 'tool_use', id: 'u3', name: 'Write', input: {} },
  ];
  const sections = buildSections(blocks);
  expect(sections[0].kind).toBe('tool_group');
  if (sections[0].kind === 'tool_group') {
    expect(sections[0].title).toBe('Read ×2, Write');
  }
});

test('buildSections: empty blocks → empty sections', () => {
  expect(buildSections([])).toEqual([]);
});

// ── hydrateMissingToolResults ─────────────────────────────────────────────────

test('hydrateMissingToolResults: returns blocks unchanged when no tool_use', () => {
  const blocks: MessageContentBlock[] = [{ type: 'text', text: 'hi' }];
  const result = hydrateMissingToolResults(blocks, []);
  expect(result).toBe(blocks); // same reference
});

test('hydrateMissingToolResults: returns blocks unchanged when tool_result already present', () => {
  const blocks: MessageContentBlock[] = [
    { type: 'tool_use', id: 'u1', name: 'Read', input: {} },
    { type: 'tool_result', toolUseId: 'u1', content: 'x' },
  ];
  const result = hydrateMissingToolResults(blocks, []);
  expect(result).toBe(blocks);
});

test('hydrateMissingToolResults: hydrates missing results from raw payload', () => {
  const blocks: MessageContentBlock[] = [{ type: 'tool_use', id: 'u1', name: 'Bash', input: {} }];
  const raw = [{ type: 'tool_result', tool_use_id: 'u1', content: 'output', is_error: false }];
  const result = hydrateMissingToolResults(blocks, raw);
  expect(result.length).toBe(2);
  const last = result[result.length - 1];
  expect(last.type).toBe('tool_result');
  if (last.type === 'tool_result') {
    expect(last.toolUseId).toBe('u1');
  }
});

test('hydrateMissingToolResults: returns blocks unchanged for non-array raw payload', () => {
  const blocks: MessageContentBlock[] = [{ type: 'tool_use', id: 'u1', name: 'Read', input: {} }];
  const result = hydrateMissingToolResults(blocks, null);
  expect(result).toBe(blocks);
});

test('hydrateMissingToolResults: unwraps stream_event tool_result payloads', () => {
  const blocks: MessageContentBlock[] = [{ type: 'tool_use', id: 'u1', name: 'Bash', input: {} }];
  const raw = [{ type: 'stream_event', event: { type: 'tool_result', tool_use_id: 'u1', content: { ok: true } } }];
  const result = hydrateMissingToolResults(blocks, raw);
  const last = result[result.length - 1];

  expect(last.type).toBe('tool_result');
  if (last.type === 'tool_result') {
    expect(last.content).toBe(JSON.stringify({ ok: true }));
  }
});

// ── coalesceToolOnlyMessages ──────────────────────────────────────────────────

function assistantMsg(id: string, blocks: MessageContentBlock[]): Message {
  return {
    id,
    threadId: 't1',
    role: 'assistant',
    content: '',
    timestamp: 0,
    normalized: { schemaVersion: 1, provider: 'claude', role: 'assistant', blocks },
  };
}

test('coalesceToolOnlyMessages: merges adjacent tool_use + tool_result messages into one', () => {
  const messages: Message[] = [
    assistantMsg('m1', [{ type: 'tool_use', id: 'u1', name: 'Read', input: { file_path: '/a' } }]),
    assistantMsg('m2', [{ type: 'tool_result', toolUseId: 'u1', content: 'a contents' }]),
    assistantMsg('m3', [{ type: 'tool_use', id: 'u2', name: 'Edit', input: { file_path: '/a' } }]),
    assistantMsg('m4', [{ type: 'tool_result', toolUseId: 'u2', content: 'edited' }]),
  ];
  const out = coalesceToolOnlyMessages(messages);
  expect(out.length).toBe(1);
  expect(out[0].id).toBe('m1');
  expect(out[0].normalized?.blocks.length).toBe(4);
  const sections = buildSections(out[0].normalized!.blocks);
  expect(sections.length).toBe(1);
  expect(sections[0].kind).toBe('tool_group');
  if (sections[0].kind === 'tool_group') {
    expect(sections[0].tools.length).toBe(2);
    expect(sections[0].tools[0].result).toBeTruthy();
    expect(sections[0].tools[1].result).toBeTruthy();
  }
});

test('coalesceToolOnlyMessages: text message breaks the run', () => {
  const text: Message = {
    id: 'm2',
    threadId: 't1',
    role: 'assistant',
    content: 'between',
    timestamp: 0,
    normalized: {
      schemaVersion: 1,
      provider: 'claude',
      role: 'assistant',
      blocks: [{ type: 'text', text: 'between' }],
    },
  };
  const messages: Message[] = [
    assistantMsg('m1', [{ type: 'tool_use', id: 'u1', name: 'Read', input: {} }]),
    text,
    assistantMsg('m3', [{ type: 'tool_use', id: 'u2', name: 'Edit', input: {} }]),
  ];
  const out = coalesceToolOnlyMessages(messages);
  expect(out.length).toBe(3);
  expect(out.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
});

test('coalesceToolOnlyMessages: leaves single tool-only message unchanged', () => {
  const messages: Message[] = [assistantMsg('m1', [{ type: 'tool_use', id: 'u1', name: 'Read', input: {} }])];
  const out = coalesceToolOnlyMessages(messages);
  expect(out.length).toBe(1);
  expect(out[0]).toBe(messages[0]);
});

test('coalesceToolOnlyMessages: never merges user messages', () => {
  const user: Message = {
    id: 'm1',
    threadId: 't1',
    role: 'user',
    content: 'hi',
    timestamp: 0,
  };
  const out = coalesceToolOnlyMessages([user, user]);
  expect(out.length).toBe(2);
});

test('coalesceToolOnlyMessages: preserves messages with mixed text + tool blocks', () => {
  const mixed = assistantMsg('m1', [
    { type: 'text', text: 'thinking...' },
    { type: 'tool_use', id: 'u1', name: 'Read', input: {} },
  ]);
  const out = coalesceToolOnlyMessages([
    mixed,
    assistantMsg('m2', [{ type: 'tool_result', toolUseId: 'u1', content: '' }]),
  ]);
  expect(out.length).toBe(2);
  expect(out[0].id).toBe('m1');
  expect(out[1].id).toBe('m2');
});

test('coalesceToolOnlyMessages: autopilot-decision message breaks the run', () => {
  // reorderWithDecisions interleaves autopilot-decision/autopilot messages into the
  // assistant stream. They render as their own bubbles and must not get swallowed.
  const decision: Message = {
    id: 'm2',
    threadId: 't1',
    role: 'assistant',
    source: 'autopilot-decision',
    content: '{"action":"stop","reason":"done"}',
    timestamp: 0,
  };
  const messages: Message[] = [
    assistantMsg('m1', [{ type: 'tool_use', id: 'u1', name: 'Read', input: {} }]),
    decision,
    assistantMsg('m3', [{ type: 'tool_use', id: 'u2', name: 'Edit', input: {} }]),
  ];
  const out = coalesceToolOnlyMessages(messages);
  expect(out.length).toBe(3);
  expect(out.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  expect(out[1].source).toBe('autopilot-decision');
});

test('coalesceToolOnlyMessages: preserves first message id, timestamp, and firstChunkAt', () => {
  const first = assistantMsg('m1', [{ type: 'tool_use', id: 'u1', name: 'Read', input: {} }]);
  first.timestamp = 1000;
  first.firstChunkAt = 950;
  const second = assistantMsg('m2', [{ type: 'tool_result', toolUseId: 'u1', content: '' }]);
  second.timestamp = 1100;
  const [merged] = coalesceToolOnlyMessages([first, second]);
  expect(merged.id).toBe('m1');
  expect(merged.timestamp).toBe(1000);
  expect(merged.firstChunkAt).toBe(950);
});

test('hydrateMissingToolResults: extracts nested user message tool results', () => {
  const blocks: MessageContentBlock[] = [{ type: 'tool_use', id: 'u1', name: 'Read', input: {} }];
  const raw = [
    {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'nested result', is_error: true }] },
    },
  ];
  const result = hydrateMissingToolResults(blocks, raw);
  const last = result[result.length - 1];

  expect(last.type).toBe('tool_result');
  if (last.type === 'tool_result') {
    expect(last.toolUseId).toBe('u1');
    expect(last.content).toBe('nested result');
    expect(last.isError).toBe(true);
  }
});

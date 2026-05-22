import { test, expect, vi } from 'vitest';

// DOMPurify needs DOM APIs; mock it so module import works in jsdom without full browser.
vi.mock('dompurify', () => ({ default: { sanitize: (s: string) => s } }));
vi.mock('highlight.js', () => ({ default: { highlightAuto: () => ({ value: '' }) } }));

import {
  extractStreamText,
  extractStreamBlocks,
  extractCodexStreamBlocks,
  extractGeminiStreamBlocks,
} from '../../../src/renderer/lib/streamParsers';

// ── helpers ───────────────────────────────────────────────────────────────────

const j = (obj: unknown) => JSON.stringify(obj);
const lines = (...objs: unknown[]) => objs.map(j).join('\n');

// ── extractStreamText ─────────────────────────────────────────────────────────

test('extractStreamText: plain text (no "type" key) returns null', () => {
  expect(extractStreamText('hello world')).toBeNull();
});

test('extractStreamText: empty string returns null', () => {
  expect(extractStreamText('')).toBeNull();
});

test('extractStreamText: stream JSON with no assistant event returns empty string', () => {
  expect(extractStreamText(j({ type: 'message_start', message: {} }))).toBe('');
});

test('extractStreamText: assistant event with text block', () => {
  const raw = j({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello!' }] } });
  expect(extractStreamText(raw)).toBe('Hello!');
});

test('extractStreamText: multiple assistant events joined with double newline', () => {
  const a = j({ type: 'assistant', message: { content: [{ type: 'text', text: 'first' }] } });
  const b = j({ type: 'assistant', message: { content: [{ type: 'text', text: 'second' }] } });
  expect(extractStreamText(a + b)).toBe('first\n\nsecond');
});

test('extractStreamText: ignores non-text blocks (tool_use) in assistant event', () => {
  const raw = j({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name: 'Read', input: {} }] } });
  expect(extractStreamText(raw)).toBe('');
});

test('extractStreamText: falls back to text_delta accumulation when no assistant events', () => {
  const events = [
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'foo ' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'bar' } },
  ];
  expect(extractStreamText(events.map(j).join(''))).toBe('foo bar');
});

test('extractStreamText: stream_event wrapper unwrapped for text_delta fallback', () => {
  const inner = { type: 'content_block_delta', delta: { type: 'text_delta', text: 'wrapped' } };
  expect(extractStreamText(j({ type: 'stream_event', event: inner }))).toBe('wrapped');
});

test('extractStreamText: thinking-only assistant event gives empty string', () => {
  const raw = j({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hmm' }] } });
  expect(extractStreamText(raw)).toBe('');
});

// ── extractStreamBlocks ───────────────────────────────────────────────────────

test('extractStreamBlocks: empty string returns []', () => {
  expect(extractStreamBlocks('')).toEqual([]);
});

test('extractStreamBlocks: plain text (no "type") returns []', () => {
  expect(extractStreamBlocks('hello')).toEqual([]);
});

test('extractStreamBlocks: assistant event with text block', () => {
  const raw = j({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } });
  const result = extractStreamBlocks(raw);
  expect(result.length).toBe(1);
  expect(result[0]).toEqual({ type: 'text', text: 'Hi' });
});

test('extractStreamBlocks: thinking block extracted from assistant event', () => {
  const raw = j({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hmm' }] } });
  const result = extractStreamBlocks(raw);
  expect(result.length).toBe(1);
  expect(result[0]).toEqual({ type: 'thinking', text: 'hmm' });
});

test('extractStreamBlocks: thinking block uses text field when thinking field absent', () => {
  const raw = j({ type: 'assistant', message: { content: [{ type: 'thinking', text: 'thought' }] } });
  const result = extractStreamBlocks(raw);
  expect(result[0].type).toBe('thinking');
});

test('extractStreamBlocks: tool_use block extracted from assistant event', () => {
  const raw = j({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { path: '/x' } }] },
  });
  const result = extractStreamBlocks(raw);
  expect(result.length).toBe(1);
  expect(result[0].type).toBe('tool_use');
  expect((result[0] as { id: string }).id).toBe('tu1');
});

test('extractStreamBlocks: tool_use missing id/name gets defaults', () => {
  const raw = j({ type: 'assistant', message: { content: [{ type: 'tool_use', input: {} }] } });
  const result = extractStreamBlocks(raw);
  expect((result[0] as { id: string; name: string }).id).toBe('tool');
  expect((result[0] as { name: string }).name).toBe('tool');
});

test('extractStreamBlocks: tool_result top-level event', () => {
  const raw = j({ type: 'tool_result', tool_use_id: 'tu1', content: 'output', is_error: false });
  const result = extractStreamBlocks(raw);
  expect(result.length).toBe(1);
  expect(result[0].type).toBe('tool_result');
  expect((result[0] as { toolUseId: string }).toolUseId).toBe('tu1');
});

test('extractStreamBlocks: tool_result with non-string content JSON-stringified', () => {
  const raw = j({ type: 'tool_result', tool_use_id: 'tu2', content: { key: 'val' } });
  const result = extractStreamBlocks(raw);
  expect((result[0] as { content: string }).content).toBe(JSON.stringify({ key: 'val' }));
});

test('extractStreamBlocks: user event with tool_result in message content', () => {
  const raw = j({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu3', content: 'done' }] } });
  const result = extractStreamBlocks(raw);
  expect(result.length).toBe(1);
  expect(result[0].type).toBe('tool_result');
  expect((result[0] as { toolUseId: string }).toolUseId).toBe('tu3');
});

test('extractStreamBlocks: stream_event wrapper unwrapped for tool_result', () => {
  const inner = { type: 'tool_result', tool_use_id: 'tu4', content: 'res' };
  const result = extractStreamBlocks(j({ type: 'stream_event', event: inner }));
  expect(result[0].type).toBe('tool_result');
  expect((result[0] as { toolUseId: string }).toolUseId).toBe('tu4');
});

test('extractStreamBlocks: text_delta fallback when no assistant events', () => {
  const events = [
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'b' } },
  ];
  const result = extractStreamBlocks(events.map(j).join(''));
  expect(result.length).toBe(1);
  expect(result[0].type).toBe('text');
  expect((result[0] as { text: string }).text).toBe('ab');
});

test('extractStreamBlocks: thinking_delta fallback accumulation', () => {
  const events = [
    { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'th1' } },
    { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'th2' } },
  ];
  const result = extractStreamBlocks(events.map(j).join(''));
  expect(result.length).toBe(1);
  expect(result[0].type).toBe('thinking');
});

test('extractStreamBlocks: deltas after last assistant event appended to existing text block', () => {
  const consolidated = { type: 'assistant', message: { content: [{ type: 'text', text: 'base' }] } };
  const delta = { type: 'content_block_delta', delta: { type: 'text_delta', text: ' more' } };
  const result = extractStreamBlocks(j(consolidated) + j(delta));
  expect(result.length).toBe(1);
  expect((result[0] as { text: string }).text).toBe('base more');
});

test('extractStreamBlocks: thinking_delta after consolidated turn creates new thinking block', () => {
  const consolidated = { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } };
  const delta = { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'rethink' } };
  const result = extractStreamBlocks(j(consolidated) + j(delta));
  expect(result.some((b) => b.type === 'thinking')).toBeTruthy();
});

test('extractStreamBlocks: mixed text + tool_use + tool_result', () => {
  const ev = {
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'thinking...' },
        { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } },
      ],
    },
  };
  const tr = j({ type: 'tool_result', tool_use_id: 'tu1', content: 'file.txt' });
  const blocks = extractStreamBlocks(j(ev) + tr);
  expect(blocks.length).toBe(3);
  expect(blocks[0].type).toBe('text');
  expect(blocks[1].type).toBe('tool_use');
  expect(blocks[2].type).toBe('tool_result');
});

// ── extractCodexStreamBlocks ─────────────────────────────────────────────────

test('extractCodexStreamBlocks: empty string returns []', () => {
  expect(extractCodexStreamBlocks('')).toEqual([]);
});

test('extractCodexStreamBlocks: non-JSON lines ignored', () => {
  expect(extractCodexStreamBlocks('not json\nstill not')).toEqual([]);
});

test('extractCodexStreamBlocks: item.started command_execution emits tool_use', () => {
  const raw = lines({ type: 'item.started', item: { type: 'command_execution', id: 'cmd1', command: 'ls' } });
  const result = extractCodexStreamBlocks(raw);
  expect(result.length).toBe(1);
  expect(result[0]).toEqual({ type: 'tool_use', id: 'cmd1', name: 'shell', input: { command: 'ls' } });
});

test('extractCodexStreamBlocks: item.completed command_execution success emits tool_result', () => {
  const raw = lines({
    type: 'item.completed',
    item: { type: 'command_execution', id: 'cmd1', aggregated_output: 'file.txt', exit_code: 0 },
  });
  const result = extractCodexStreamBlocks(raw);
  expect(result.length).toBe(1);
  expect(result[0].type).toBe('tool_result');
  expect((result[0] as { toolUseId: string; content: string; isError: boolean }).toolUseId).toBe('cmd1');
  expect((result[0] as { content: string }).content).toBe('file.txt');
  expect((result[0] as { isError: boolean }).isError).toBe(false);
});

test('extractCodexStreamBlocks: item.completed with exit_code != 0 isError=true', () => {
  const raw = lines({
    type: 'item.completed',
    item: { type: 'command_execution', id: 'cmd2', aggregated_output: 'err', exit_code: 1 },
  });
  expect((extractCodexStreamBlocks(raw)[0] as { isError: boolean }).isError).toBe(true);
});

test('extractCodexStreamBlocks: item.completed with status=failed isError=true', () => {
  const raw = lines({
    type: 'item.completed',
    item: { type: 'command_execution', id: 'cmd3', status: 'failed', exit_code: 0 },
  });
  expect((extractCodexStreamBlocks(raw)[0] as { isError: boolean }).isError).toBe(true);
});

test('extractCodexStreamBlocks: item.done same as item.completed', () => {
  const raw = lines({
    type: 'item.done',
    item: { type: 'command_execution', id: 'cmd4', aggregated_output: 'ok', exit_code: 0 },
  });
  expect(extractCodexStreamBlocks(raw)[0].type).toBe('tool_result');
});

test('extractCodexStreamBlocks: agent_message item with text field', () => {
  const raw = lines({ type: 'item.completed', item: { type: 'agent_message', text: 'Done!' } });
  const result = extractCodexStreamBlocks(raw);
  expect(result.length).toBe(1);
  expect(result[0]).toEqual({ type: 'text', text: 'Done!' });
});

test('extractCodexStreamBlocks: message item with content array', () => {
  const raw = lines({
    type: 'item.completed',
    item: { type: 'message', content: [{ text: 'Hello' }, { text: ' World' }] },
  });
  const result = extractCodexStreamBlocks(raw);
  expect(result[0].type).toBe('text');
  expect((result[0] as { text: string }).text).toBe('Hello\n World');
});

test('extractCodexStreamBlocks: agent_message with whitespace-only text ignored', () => {
  const raw = lines({ type: 'item.completed', item: { type: 'agent_message', text: '   ' } });
  expect(extractCodexStreamBlocks(raw)).toEqual([]);
});

test('extractCodexStreamBlocks: item without item field skipped', () => {
  expect(extractCodexStreamBlocks(lines({ type: 'item.started' }))).toEqual([]);
});

test('extractCodexStreamBlocks: response_item with assistant message', () => {
  const raw = lines({
    type: 'response_item',
    payload: { type: 'message', role: 'assistant', content: [{ text: 'reply' }] },
  });
  const result = extractCodexStreamBlocks(raw);
  expect(result.length).toBe(1);
  expect(result[0].type).toBe('text');
  expect((result[0] as { text: string }).text).toBe('reply');
});

test('extractCodexStreamBlocks: response_item with user message skipped', () => {
  const raw = lines({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: 'hi' }] } });
  expect(extractCodexStreamBlocks(raw)).toEqual([]);
});

test('extractCodexStreamBlocks: response_item function_call with JSON arguments', () => {
  const raw = lines({
    type: 'response_item',
    payload: { type: 'function_call', call_id: 'c1', name: 'search', arguments: '{"q":"hello"}' },
  });
  const result = extractCodexStreamBlocks(raw);
  expect(result.length).toBe(1);
  expect(result[0].type).toBe('tool_use');
  expect((result[0] as { id: string; name: string; input: unknown }).id).toBe('c1');
  expect((result[0] as { name: string }).name).toBe('search');
  expect((result[0] as { input: unknown }).input).toEqual({ q: 'hello' });
});

test('extractCodexStreamBlocks: response_item function_call with invalid JSON arguments', () => {
  const raw = lines({
    type: 'response_item',
    payload: { type: 'function_call', call_id: 'c2', name: 'tool', arguments: 'not-json' },
  });
  const result = extractCodexStreamBlocks(raw);
  expect(result[0].type).toBe('tool_use');
  expect((result[0] as { input: unknown }).input).toEqual({ raw: 'not-json' });
});

test('extractCodexStreamBlocks: response_item function_call_output', () => {
  const raw = lines({
    type: 'response_item',
    payload: { type: 'function_call_output', call_id: 'c1', output: 'result text' },
  });
  const result = extractCodexStreamBlocks(raw);
  expect(result.length).toBe(1);
  expect(result[0].type).toBe('tool_result');
  expect((result[0] as { toolUseId: string }).toolUseId).toBe('c1');
  expect((result[0] as { content: string }).content).toBe('result text');
});

test('extractCodexStreamBlocks: response_item payload missing skipped', () => {
  expect(extractCodexStreamBlocks(lines({ type: 'response_item' }))).toEqual([]);
});

test('extractCodexStreamBlocks: event_msg task_complete with message', () => {
  const raw = lines({ type: 'event_msg', payload: { type: 'task_complete', last_agent_message: 'All done.' } });
  const result = extractCodexStreamBlocks(raw);
  expect(result.length).toBe(1);
  expect(result[0]).toEqual({ type: 'text', text: 'All done.' });
});

test('extractCodexStreamBlocks: event_msg task_complete whitespace-only ignored', () => {
  const raw = lines({ type: 'event_msg', payload: { type: 'task_complete', last_agent_message: '  ' } });
  expect(extractCodexStreamBlocks(raw)).toEqual([]);
});

test('extractCodexStreamBlocks: multiple events processed in order', () => {
  const raw = lines(
    { type: 'item.started', item: { type: 'command_execution', id: 'c1', command: 'ls' } },
    { type: 'item.completed', item: { type: 'command_execution', id: 'c1', aggregated_output: 'out', exit_code: 0 } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'Done' } },
  );
  const result = extractCodexStreamBlocks(raw);
  expect(result.length).toBe(3);
  expect(result[0].type).toBe('tool_use');
  expect(result[1].type).toBe('tool_result');
  expect(result[2].type).toBe('text');
});

test('extractCodexStreamBlocks: mcp_tool_call emits tool_use and tool_result', () => {
  const raw = lines(
    {
      type: 'item.started',
      item: { type: 'mcp_tool_call', id: 'mcp1', server: 'filesystem', tool: 'read_file', arguments: { path: '/tmp/file.txt' } },
    },
    {
      type: 'item.completed',
      item: { type: 'mcp_tool_call', id: 'mcp1', server: 'filesystem', tool: 'read_file', output: 'file contents', status: 'completed' },
    },
  );
  const result = extractCodexStreamBlocks(raw);
  expect(result.length).toBe(2);
  expect(result[0]).toEqual({ type: 'tool_use', id: 'mcp1', name: 'mcp__filesystem__read_file', input: { path: '/tmp/file.txt' } });
  expect(result[1]).toEqual({ type: 'tool_result', toolUseId: 'mcp1', content: 'file contents', isError: false });
});

test('extractCodexStreamBlocks: response_item reasoning emits thinking block', () => {
  const raw = lines({
    type: 'response_item',
    payload: { type: 'reasoning', summary: ['first step', { text: ' second step' }] },
  });
  const result = extractCodexStreamBlocks(raw);
  expect(result.length).toBe(1);
  expect(result[0]).toEqual({ type: 'thinking', text: 'first step second step' });
});

test('extractCodexStreamBlocks: generic assistant message/output event extracts nested text', () => {
  const raw = lines({
    type: 'assistant_message_output',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Live codex text' }] },
  });
  const result = extractCodexStreamBlocks(raw);
  expect(result.length).toBe(1);
  expect(result[0]).toEqual({ type: 'text', text: 'Live codex text' });
});

// ── extractGeminiStreamBlocks ─────────────────────────────────────────────────

test('extractGeminiStreamBlocks: empty string returns []', () => {
  expect(extractGeminiStreamBlocks('')).toEqual([]);
});

test('extractGeminiStreamBlocks: non-JSON lines ignored', () => {
  expect(extractGeminiStreamBlocks('plain text\nnot json')).toEqual([]);
});

test('extractGeminiStreamBlocks: assistant message with content', () => {
  const raw = lines({ type: 'message', role: 'assistant', content: 'Hello!' });
  const result = extractGeminiStreamBlocks(raw);
  expect(result.length).toBe(1);
  expect(result[0]).toEqual({ type: 'text', text: 'Hello!' });
});

test('extractGeminiStreamBlocks: user message ignored', () => {
  expect(extractGeminiStreamBlocks(lines({ type: 'message', role: 'user', content: 'Hi' }))).toEqual([]);
});

test('extractGeminiStreamBlocks: non-message type ignored', () => {
  expect(extractGeminiStreamBlocks(lines({ type: 'ping', role: 'assistant', content: 'x' }))).toEqual([]);
});

test('extractGeminiStreamBlocks: consecutive assistant messages concatenated', () => {
  const raw = lines(
    { type: 'message', role: 'assistant', content: 'Hello' },
    { type: 'message', role: 'assistant', content: ' World' },
  );
  const result = extractGeminiStreamBlocks(raw);
  expect(result.length).toBe(1);
  expect((result[0] as { text: string }).text).toBe('Hello World');
});

test('extractGeminiStreamBlocks: tool_use event', () => {
  const raw = lines({ type: 'tool_use', tool_id: 'tid1', tool_name: 'search', parameters: { q: 'test' } });
  const result = extractGeminiStreamBlocks(raw);
  expect(result.length).toBe(1);
  expect(result[0]).toEqual({ type: 'tool_use', id: 'tid1', name: 'search', input: { q: 'test' } });
});

test('extractGeminiStreamBlocks: tool_use without tool_id skipped', () => {
  expect(extractGeminiStreamBlocks(lines({ type: 'tool_use', tool_name: 'search' }))).toEqual([]);
});

test('extractGeminiStreamBlocks: tool_use missing tool_name defaults to "tool"', () => {
  const result = extractGeminiStreamBlocks(lines({ type: 'tool_use', tool_id: 'tid2' }));
  expect((result[0] as { name: string }).name).toBe('tool');
});

test('extractGeminiStreamBlocks: tool_use missing parameters defaults to {}', () => {
  const result = extractGeminiStreamBlocks(lines({ type: 'tool_use', tool_id: 'tid3', tool_name: 'x' }));
  expect((result[0] as { input: unknown }).input).toEqual({});
});

test('extractGeminiStreamBlocks: tool_result event', () => {
  const raw = lines({ type: 'tool_result', tool_id: 'tid1', output: 'result text', status: 'ok' });
  const result = extractGeminiStreamBlocks(raw);
  expect(result.length).toBe(1);
  expect(result[0]).toEqual({ type: 'tool_result', toolUseId: 'tid1', content: 'result text', isError: false });
});

test('extractGeminiStreamBlocks: tool_result with error or failed status isError=true', () => {
  for (const status of ['error', 'failed']) {
    const raw = lines({ type: 'tool_result', tool_id: 'tid-err', output: 'err', status });
    expect((extractGeminiStreamBlocks(raw)[0] as { isError: boolean }).isError).toBe(true);
  }
});

test('extractGeminiStreamBlocks: tool_result without tool_id skipped', () => {
  expect(extractGeminiStreamBlocks(lines({ type: 'tool_result', output: 'x' }))).toEqual([]);
});

test('extractGeminiStreamBlocks: tool_result non-string output JSON-stringified', () => {
  const raw = lines({ type: 'tool_result', tool_id: 'tid4', output: { data: [1, 2] } });
  const result = extractGeminiStreamBlocks(raw);
  expect((result[0] as { content: string }).content).toBe(JSON.stringify({ data: [1, 2] }));
});

test('extractGeminiStreamBlocks: full sequence tool_use → tool_result → message', () => {
  const raw = lines(
    { type: 'tool_use', tool_id: 'tid1', tool_name: 'search', parameters: { q: 'ai' } },
    { type: 'tool_result', tool_id: 'tid1', output: 'found stuff', status: 'ok' },
    { type: 'message', role: 'assistant', content: 'Here is the answer.' },
  );
  const result = extractGeminiStreamBlocks(raw);
  expect(result.length).toBe(3);
  expect(result[0].type).toBe('tool_use');
  expect(result[1].type).toBe('tool_result');
  expect(result[2].type).toBe('text');
});

test('extractGeminiStreamBlocks: empty content string not appended', () => {
  expect(extractGeminiStreamBlocks(lines({ type: 'message', role: 'assistant', content: '' }))).toEqual([]);
});

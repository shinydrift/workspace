/**
 * Fixture tests for normalizer correctness fixes — imports production modules directly.
 *
 * Covers the 20 issues identified in the council review:
 * token aggregation, deduplication, array tool_result content, stream_event unwrap,
 * SSE prefix parsing, rate-limit clamping, and multi-turn attach symmetry.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeClaude, normalizeClaudeMessages } from '../../../src/main/normalizers/claude.ts';
import { normalizeGemini } from '../../../src/main/normalizers/gemini.ts';
import { normalizeCodexMessages, decodeCodexBuffer } from '../../../src/main/normalizers/codex.ts';
import { extractCodexTokenUsage } from '../../../src/main/normalizers/codex/metadata.ts';
import {
  buildFromCodexJsonEvents,
  buildSplitMessagesFromCodexJsonEvents,
  extractCodexTextFragments,
} from '../../../src/main/normalizers/codex/eventParsing.ts';
import { extractTextFromUnknown, parseResponseItemPayload } from '../../../src/main/normalizers/codex/blocks.ts';
import { parseJsonLines, parseRateLimitWindow, safeStringify } from '../../../src/main/normalizers/types.ts';
import { normalizeMessage } from '../../../src/main/normalizers/index.ts';

const BASE = { provider: 'codex' as const, role: 'assistant' as const, text: '' };

function j(...objs: unknown[]): string {
  return objs.map((o) => JSON.stringify(o)).join('\n');
}

// ── Fix 1: extractCodexTokenUsage aggregates multiple turn.completed ──────────

test('extractCodexTokenUsage aggregates two turn.completed events', () => {
  const events = [
    { type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 50 } },
    { type: 'turn.completed', usage: { input_tokens: 60, output_tokens: 30 } },
  ];
  const result = extractCodexTokenUsage(events);
  assert.ok(result);
  assert.equal(result.inputTokens, 160);
  assert.equal(result.outputTokens, 80);
});

test('extractCodexTokenUsage picks model from last event before any completion', () => {
  const events = [
    { type: 'thread.started', model: 'gpt-4o' },
    { type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 50 } },
    { type: 'thread.started', model: 'gpt-5.5' },
    { type: 'turn.completed', usage: { input_tokens: 50, output_tokens: 20 } },
  ];
  const result = extractCodexTokenUsage(events);
  assert.ok(result);
  assert.equal(result.model, 'gpt-5.5');
  assert.equal(result.inputTokens, 150);
  assert.equal(result.outputTokens, 70);
});

// ── Fix 2: extractGeminiTokenUsage uses last result event ─────────────────────

test('normalizeGemini uses last result event for token usage', () => {
  const text = j(
    { type: 'message', role: 'assistant', content: 'ok' },
    { type: 'result', stats: { input_tokens: 10, output_tokens: 5 } },
    { type: 'result', stats: { input_tokens: 200, output_tokens: 100 } }
  );
  const result = normalizeGemini({ provider: 'gemini', role: 'assistant', text });
  assert.ok(result.tokenUsage);
  assert.equal(result.tokenUsage.inputTokens, 200);
  assert.equal(result.tokenUsage.outputTokens, 100);
});

// ── Fix 3: Claude token usage: message_start (input) + message_delta (output) ─

test('normalizeClaude splits token attribution between message_start and message_delta', () => {
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 0 }, model: 'claude-opus-4-7' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } },
    { type: 'message_delta', usage: { output_tokens: 42 } },
  ];
  const text = events.map((e) => JSON.stringify(e)).join('');
  const result = normalizeClaude({ provider: 'claude', role: 'assistant', text });
  assert.ok(result.tokenUsage);
  assert.equal(result.tokenUsage.inputTokens, 100);
  assert.equal(result.tokenUsage.outputTokens, 42);
  assert.equal(result.tokenUsage.model, 'claude-opus-4-7');
});

// ── Fix 4: Claude tool_result with array content extracts text ────────────────

test('normalizeClaude: tool_result with array content extracts text blocks', () => {
  const event = {
    type: 'tool_result',
    tool_use_id: 'tu1',
    content: [
      { type: 'text', text: 'line one' },
      { type: 'text', text: 'line two' },
    ],
  };
  const result = normalizeClaude({ provider: 'claude', role: 'assistant', text: JSON.stringify(event) });
  const toolResult = result.normalized.blocks.find((b) => b.type === 'tool_result');
  assert.ok(toolResult);
  assert.ok((toolResult as { content: string }).content.includes('line one'));
  assert.ok((toolResult as { content: string }).content.includes('line two'));
  // Must NOT be raw JSON
  assert.ok(!(toolResult as { content: string }).content.startsWith('['));
});

test('normalizeClaude: tool_result with string content passes through unchanged', () => {
  const event = { type: 'tool_result', tool_use_id: 'tu1', content: 'plain text result' };
  const result = normalizeClaude({ provider: 'claude', role: 'assistant', text: JSON.stringify(event) });
  const toolResult = result.normalized.blocks.find((b) => b.type === 'tool_result');
  assert.ok(toolResult);
  assert.equal((toolResult as { content: string }).content, 'plain text result');
});

// ── Fix 5: Codex item deduplication ──────────────────────────────────────────

test('buildFromCodexJsonEvents deduplicates item.completed + item.done for same id', () => {
  const events = [
    { type: 'item.started', item: { type: 'command_execution', id: 'cmd-1', command: 'ls' } },
    {
      type: 'item.completed',
      item: { type: 'command_execution', id: 'cmd-1', aggregated_output: 'file.txt', exit_code: 0 },
    },
    {
      type: 'item.done',
      item: { type: 'command_execution', id: 'cmd-1', aggregated_output: 'file.txt', exit_code: 0 },
    },
    { type: 'item.completed', item: { type: 'agent_message', text: 'Done' } },
  ];
  const result = buildFromCodexJsonEvents(BASE, events);
  assert.ok(result !== null);
  const toolResults = result.normalized.blocks.filter((b) => b.type === 'tool_result');
  assert.equal(toolResults.length, 1, 'should have exactly one tool_result, not two');
});

test('buildSplitMessagesFromCodexJsonEvents deduplicates item.completed + item.done', () => {
  const events = [
    {
      type: 'item.started',
      item: { type: 'mcp_tool_call', id: 'mcp-1', server: 'mem', tool: 'search', arguments: {} },
    },
    {
      type: 'item.completed',
      item: { type: 'mcp_tool_call', id: 'mcp-1', server: 'mem', tool: 'search', output: 'result' },
    },
    {
      type: 'item.done',
      item: { type: 'mcp_tool_call', id: 'mcp-1', server: 'mem', tool: 'search', output: 'result' },
    },
    { type: 'item.completed', item: { type: 'agent_message', text: 'Found it' } },
  ];
  const results = buildSplitMessagesFromCodexJsonEvents(BASE, events);
  assert.equal(results.length, 1);
  const toolResults = results[0].normalized.blocks.filter((b) => b.type === 'tool_result');
  assert.equal(toolResults.length, 1, 'should have exactly one tool_result');
});

// ── Fix 6: normalizeClaudeMessages unwraps stream_event for turn grouping ─────

test('normalizeClaudeMessages groups turns correctly when assistant events are stream_event-wrapped', () => {
  const makeAssistant = (id: string, text: string) => ({
    type: 'stream_event',
    event: { type: 'assistant', message: { id, content: [{ type: 'text', text }] } },
  });
  const events = [makeAssistant('msg-1', 'Turn one'), makeAssistant('msg-2', 'Turn two')];
  const text = events.map((e) => JSON.stringify(e)).join('');
  const results = normalizeClaudeMessages({ provider: 'claude', role: 'assistant', text });
  assert.equal(results.length, 2);
  assert.ok(results[0].content.includes('Turn one'));
  assert.ok(results[1].content.includes('Turn two'));
});

// ── Fix 7: multi-turn token/rate-limit on last result ─────────────────────────

test('normalizeCodexMessages attaches tokenUsage to last result', () => {
  const events = [
    { type: 'item.completed', item: { type: 'agent_message', text: 'First' } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'Second' } },
    { type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 50 } },
  ];
  const text = events.map((e) => JSON.stringify(e)).join('\n');
  const results = normalizeCodexMessages({ provider: 'codex', role: 'assistant', text });
  assert.equal(results.length, 2);
  assert.equal(results[0].tokenUsage, undefined, 'first result should have no tokenUsage');
  assert.ok(results[1].tokenUsage, 'last result should have tokenUsage');
  assert.equal(results[1].tokenUsage!.inputTokens, 100);
});

test('normalizeClaudeMessages attaches tokenUsage to last result', () => {
  const makeAssistant = (id: string, text: string) => ({
    type: 'assistant',
    message: { id, content: [{ type: 'text', text }] },
  });
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 50, output_tokens: 0 } } },
    makeAssistant('msg-1', 'First'),
    makeAssistant('msg-2', 'Second'),
    { type: 'message_delta', usage: { output_tokens: 30 } },
  ];
  const text = events.map((e) => JSON.stringify(e)).join('');
  const results = normalizeClaudeMessages({ provider: 'claude', role: 'assistant', text });
  assert.equal(results.length, 2);
  assert.equal(results[0].tokenUsage, undefined, 'first result should have no tokenUsage');
  assert.ok(results[1].tokenUsage, 'last result should have tokenUsage');
});

// ── Fix 8: parseResponseItemPayload undefined output → '' ────────────────────

test('parseResponseItemPayload function_call_output with undefined output emits empty string', () => {
  const { otherBlocks } = parseResponseItemPayload({ type: 'function_call_output', call_id: 'c1' });
  assert.equal(otherBlocks.length, 1);
  assert.equal((otherBlocks[0] as { content: string }).content, '');
});

test('parseResponseItemPayload function_call_output with null output emits empty string', () => {
  const { otherBlocks } = parseResponseItemPayload({ type: 'function_call_output', call_id: 'c1', output: null });
  assert.equal(otherBlocks.length, 1);
  assert.equal((otherBlocks[0] as { content: string }).content, '');
});

// ── Fix 9: extractTextFromUnknown depth limit ────────────────────────────────

test('extractTextFromUnknown stops at depth 10', () => {
  // Build an object nested 15 levels deep — leaf is unreachable past depth 10.
  let obj: unknown = 'leaf';
  for (let i = 0; i < 15; i++) obj = { text: obj };
  const result = extractTextFromUnknown(obj);
  assert.deepEqual(result, [], 'depth-capped traversal should return empty, not reach the leaf');
});

// ── Fix 10: safeStringify does not throw on BigInt or circular ───────────────

test('safeStringify handles regular values', () => {
  assert.equal(safeStringify('hello'), 'hello');
  assert.equal(safeStringify(42), '42');
  assert.equal(safeStringify(null), 'null');
});

test('safeStringify returns [unserializable] for circular references', () => {
  const obj: Record<string, unknown> = {};
  obj.self = obj;
  assert.equal(safeStringify(obj), '[unserializable]');
});

// ── Fix 11: parseJsonLines strips SSE data: prefix ───────────────────────────

test('parseJsonLines strips SSE data: prefix', () => {
  const text = 'data: {"type":"message","content":"hello"}\ndata: {"type":"done"}';
  const events = parseJsonLines(text);
  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'message');
  assert.equal(events[1].type, 'done');
});

test('parseJsonLines handles data: with extra whitespace', () => {
  const text = 'data:   {"type":"test"}';
  const events = parseJsonLines(text);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'test');
});

// ── Fix 12: parseRateLimitWindow clamps usedPercentage ──────────────────────

test('parseRateLimitWindow clamps negative usedPercentage to 0', () => {
  const result = parseRateLimitWindow('test', { used_percentage: -10, resets_at: 1776290000 });
  assert.ok(result);
  assert.equal(result.usedPercentage, 0);
});

test('parseRateLimitWindow clamps usedPercentage over 100 to 100', () => {
  const result = parseRateLimitWindow('test', { used_percentage: 150, resets_at: 1776290000 });
  assert.ok(result);
  assert.equal(result.usedPercentage, 100);
});

test('parseRateLimitWindow treats utilization > 1 as percentage directly', () => {
  // A provider sending utilization=75 (already percentage, not fraction)
  const result = parseRateLimitWindow('test', { utilization: 75, resets_at: 1776290000 });
  assert.ok(result);
  assert.equal(result.usedPercentage, 75);
});

test('parseRateLimitWindow treats utilization <= 1 as fraction', () => {
  const result = parseRateLimitWindow('test', { utilization: 0.5, resets_at: 1776290000 });
  assert.ok(result);
  assert.equal(result.usedPercentage, 50);
});

// ── Fix 15: decodeCodexBuffer uses extractCodexTextFragments ────────────────

test('decodeCodexBuffer extracts agent_message text', () => {
  const text = j({ type: 'item.completed', item: { type: 'agent_message', text: 'Hello world' } });
  assert.equal(decodeCodexBuffer(text), 'Hello world');
});

test('decodeCodexBuffer extracts event_msg task_complete', () => {
  const text = j({ type: 'event_msg', payload: { type: 'task_complete', last_agent_message: 'Done!' } });
  assert.equal(decodeCodexBuffer(text), 'Done!');
});

test('extractCodexTextFragments returns multiple text fragments', () => {
  const events = [
    { type: 'item.completed', item: { type: 'agent_message', text: 'Part 1' } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'Part 2' } },
  ];
  const result = extractCodexTextFragments(events as Array<Record<string, unknown>>);
  assert.deepEqual(result, ['Part 1', 'Part 2']);
});

// ── Fix 17: providerNormalizers as Partial map ───────────────────────────────

test('normalizeMessage falls back to plain text for unknown provider', () => {
  const result = normalizeMessage({ provider: 'unknown_future_provider' as never, role: 'user', text: 'hi' });
  assert.equal(result.content, 'hi');
});

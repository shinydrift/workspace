/**
 * Tests for normalizers/codex helpers — imports production modules directly.
 *
 * Covers the granular transformation helpers extracted into codex/terminal.ts,
 * codex/blocks.ts, codex/metadata.ts, and codex/eventParsing.ts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  expandCursorRightEscapes,
  normalizeTerminalText,
  cleanupLines,
  isCodexAuthScreen,
  filterPromptNoise,
} from '../../../src/main/normalizers/codex/terminal.ts';
import { extractTextFromUnknown } from '../../../src/main/normalizers/codex/blocks.ts';
import { extractCodexTokenUsage } from '../../../src/main/normalizers/codex/metadata.ts';
import {
  buildFromCodexJsonEvents,
  buildSplitMessagesFromCodexJsonEvents,
} from '../../../src/main/normalizers/codex/eventParsing.ts';
import { extractRateLimitWindows, parseJsonLines } from '../../../src/main/normalizers/types.ts';

const ESC = String.fromCharCode(27);
const BELL = String.fromCharCode(7);
const BASE = { provider: 'codex' as const, role: 'assistant' as const, text: '' };

// ── expandCursorRightEscapes ──────────────────────────────────────────────────

test('expandCursorRightEscapes expands cursor-right to spaces', () => {
  assert.equal(expandCursorRightEscapes(`${ESC}[5Chello`), '     hello');
});

test('expandCursorRightEscapes handles zero-repeat', () => {
  assert.equal(expandCursorRightEscapes(`${ESC}[0Chello`), 'hello');
});

test('expandCursorRightEscapes passes through non-escape chars', () => {
  assert.equal(expandCursorRightEscapes('hello'), 'hello');
});

// ── normalizeTerminalText ─────────────────────────────────────────────────────

test('normalizeTerminalText converts CRLF to LF', () => {
  assert.equal(normalizeTerminalText('line1\r\nline2'), 'line1\nline2');
});

test('normalizeTerminalText converts lone CR to LF', () => {
  assert.equal(normalizeTerminalText('line1\rline2'), 'line1\nline2');
});

test('normalizeTerminalText strips BELL characters', () => {
  assert.equal(normalizeTerminalText(`hello${BELL}world`), 'helloworld');
});

// ── cleanupLines ──────────────────────────────────────────────────────────────

test('cleanupLines removes blank lines', () => {
  assert.deepEqual(cleanupLines('hello\n\nworld\n\n'), ['hello', 'world']);
});

test('cleanupLines strips trailing whitespace from lines', () => {
  assert.deepEqual(cleanupLines('hello   \nworld  '), ['hello', 'world']);
});

test('cleanupLines returns empty array for all-whitespace input', () => {
  assert.deepEqual(cleanupLines('   \n   \n   '), []);
});

// ── isCodexAuthScreen ─────────────────────────────────────────────────────────

test('isCodexAuthScreen returns true for auth screen text', () => {
  assert.equal(isCodexAuthScreen(['Welcome to Codex', 'Sign in with your account', 'Press Enter to continue']), true);
});

test('isCodexAuthScreen returns false for normal output', () => {
  assert.equal(isCodexAuthScreen(['Here is the result', 'It worked fine']), false);
});

test('isCodexAuthScreen is case-insensitive', () => {
  assert.equal(isCodexAuthScreen(['WELCOME TO CODEX', 'SIGN IN WITH something', 'PRESS ENTER TO CONTINUE']), true);
});

// ── filterPromptNoise ─────────────────────────────────────────────────────────

test('filterPromptNoise removes trailing > prompt', () => {
  assert.deepEqual(filterPromptNoise(['line1', 'line2', '>']), ['line1', 'line2']);
});

test('filterPromptNoise removes trailing codex> prompt', () => {
  assert.deepEqual(filterPromptNoise(['line1', 'codex>']), ['line1']);
});

test('filterPromptNoise removes multiple trailing prompts', () => {
  assert.deepEqual(filterPromptNoise(['content', '>', 'codex>', '>']), ['content']);
});

test('filterPromptNoise does not remove non-prompt lines', () => {
  assert.deepEqual(filterPromptNoise(['result > 5', 'output here']), ['result > 5', 'output here']);
});

test('filterPromptNoise handles empty array', () => {
  assert.deepEqual(filterPromptNoise([]), []);
});

// ── parseJsonLines ────────────────────────────────────────────────────────────

test('parseJsonLines extracts JSON objects from text', () => {
  const events = parseJsonLines('{"type":"turn.started"}\n{"type":"turn.completed","usage":{"input_tokens":10}}');
  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'turn.started');
});

test('parseJsonLines skips non-JSON lines', () => {
  assert.equal(parseJsonLines('not json\n{"type":"event"}\n also not json').length, 1);
});

test('parseJsonLines skips arrays', () => {
  assert.equal(parseJsonLines('[1,2,3]\n{"type":"ok"}').length, 1);
});

test('parseJsonLines handles empty input', () => {
  assert.deepEqual(parseJsonLines(''), []);
});

// ── extractTextFromUnknown ────────────────────────────────────────────────────

test('extractTextFromUnknown returns string value', () => {
  assert.deepEqual(extractTextFromUnknown('hello'), ['hello']);
});

test('extractTextFromUnknown returns empty for blank string', () => {
  assert.deepEqual(extractTextFromUnknown('  '), []);
});

test('extractTextFromUnknown extracts from text field', () => {
  assert.deepEqual(extractTextFromUnknown({ type: 'text', text: 'hello' }), ['hello']);
});

test('extractTextFromUnknown extracts from content field', () => {
  assert.deepEqual(extractTextFromUnknown({ content: 'hello' }), ['hello']);
});

test('extractTextFromUnknown flattens arrays', () => {
  assert.deepEqual(extractTextFromUnknown(['hello', 'world']), ['hello', 'world']);
});

test('extractTextFromUnknown returns empty for null', () => {
  assert.deepEqual(extractTextFromUnknown(null), []);
});

test('extractTextFromUnknown returns empty for number', () => {
  assert.deepEqual(extractTextFromUnknown(42), []);
});

// ── extractCodexTokenUsage ────────────────────────────────────────────────────

test('extractCodexTokenUsage returns undefined when no usage event', () => {
  assert.equal(extractCodexTokenUsage([{ type: 'turn.started' }]), undefined);
});

test('extractCodexTokenUsage extracts from turn.completed', () => {
  const result = extractCodexTokenUsage([{ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 50 } }]);
  assert.deepEqual(result, { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, model: undefined });
});

test('extractCodexTokenUsage extracts from thread.completed', () => {
  const result = extractCodexTokenUsage([{ type: 'thread.completed', usage: { input_tokens: 200, output_tokens: 80 } }]);
  assert.deepEqual(result, { inputTokens: 200, outputTokens: 80, cacheReadTokens: 0, model: undefined });
});

test('extractCodexTokenUsage keeps the last seen model before completion', () => {
  const result = extractCodexTokenUsage([
    { type: 'thread.started', model: 'gpt-5-codex' },
    { type: 'turn.completed', usage: { input_tokens: 200, output_tokens: 80 } },
  ]);
  assert.deepEqual(result, { inputTokens: 200, outputTokens: 80, cacheReadTokens: 0, model: 'gpt-5-codex' });
});

test('extractCodexTokenUsage extracts cached input tokens', () => {
  const result = extractCodexTokenUsage([
    {
      type: 'turn.completed',
      model: 'gpt-5-codex',
      usage: { input_tokens: 200, output_tokens: 80, input_tokens_details: { cached_tokens: 120 } },
    },
  ]);
  assert.deepEqual(result, { inputTokens: 200, outputTokens: 80, cacheReadTokens: 120, model: 'gpt-5-codex' });
});

test('extractCodexTokenUsage returns undefined when tokens are zero', () => {
  assert.equal(extractCodexTokenUsage([{ type: 'turn.completed', usage: { input_tokens: 0, output_tokens: 0 } }]), undefined);
});

test('extractCodexTokenUsage returns undefined for empty events', () => {
  assert.equal(extractCodexTokenUsage([]), undefined);
});

// ── extractRateLimitWindows ─────────────────────────────────────────────────

test('extractRateLimitWindows extracts Claude 5-hour and 7-day windows', () => {
  const result = extractRateLimitWindows([
    {
      type: 'result',
      rate_limits: {
        five_hour: { used_percentage: 20, resets_at: 1776290000 },
        seven_day: { used_percentage: 40, resets_at: 1776600000 },
      },
    },
  ]);
  assert.deepEqual(result, [
    { label: '5-hour', usedPercentage: 20, resetsAt: 1776290000 },
    { label: '7-day', usedPercentage: 40, resetsAt: 1776600000 },
  ]);
});

test('extractRateLimitWindows extracts Codex-style account limits', () => {
  const result = extractRateLimitWindows([
    {
      type: 'account.ratelimits.updated',
      account: { rateLimits: { primary: { usedPercent: 65, resetAt: 1776290000000 } } },
    },
  ]);
  assert.deepEqual(result, [{ label: 'primary', usedPercentage: 65, resetsAt: 1776290000 }]);
});

test('extractRateLimitWindows returns undefined for unusable windows', () => {
  assert.equal(
    extractRateLimitWindows([{ type: 'result', rate_limits: { five_hour: { used_percentage: 20 } } }]),
    undefined
  );
});

// ── buildFromCodexJsonEvents ──────────────────────────────────────────────────

test('buildFromCodexJsonEvents returns null for empty/irrelevant events', () => {
  assert.equal(buildFromCodexJsonEvents(BASE, [{ type: 'turn.started' }, { type: 'turn.completed' }]), null);
});

test('buildFromCodexJsonEvents extracts text from agent_message item', () => {
  const result = buildFromCodexJsonEvents(BASE, [
    { type: 'item.completed', item: { type: 'agent_message', text: 'Hello from the agent' } },
  ]);
  assert.ok(result !== null);
  assert.ok(result.content.includes('Hello from the agent'));
});

test('buildFromCodexJsonEvents extracts error content', () => {
  const result = buildFromCodexJsonEvents(BASE, [{ type: 'error', message: 'Something went wrong' }]);
  assert.ok(result !== null);
  assert.ok(result.content.includes('Something went wrong'));
});

test('buildFromCodexJsonEvents ignores thread.started event', () => {
  assert.equal(buildFromCodexJsonEvents(BASE, [{ type: 'thread.started', text: 'should be ignored' }]), null);
});

test('buildFromCodexJsonEvents produces tool_use and tool_result blocks', () => {
  const result = buildFromCodexJsonEvents(BASE, [
    { type: 'item.started', item: { type: 'command_execution', id: 'cmd-1', command: 'ls' } },
    { type: 'item.completed', item: { type: 'command_execution', id: 'cmd-1', aggregated_output: 'file.txt', exit_code: 0 } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'Done' } },
  ]);
  assert.ok(result !== null);
  const types = result.normalized.blocks.map((b) => b.type);
  assert.ok(types.includes('tool_use'));
  assert.ok(types.includes('tool_result'));
  assert.ok(types.includes('text'));
});

// ── buildSplitMessagesFromCodexJsonEvents ─────────────────────────────────────

test('buildSplitMessagesFromCodexJsonEvents returns empty array for empty events', () => {
  assert.deepEqual(buildSplitMessagesFromCodexJsonEvents(BASE, []), []);
});

test('buildSplitMessagesFromCodexJsonEvents returns empty array for lifecycle-only events', () => {
  assert.deepEqual(
    buildSplitMessagesFromCodexJsonEvents(BASE, [
      { type: 'thread.started' },
      { type: 'turn.started' },
      { type: 'turn.completed' },
    ]),
    []
  );
});

test('buildSplitMessagesFromCodexJsonEvents returns one result for single agent_message', () => {
  const results = buildSplitMessagesFromCodexJsonEvents(BASE, [
    { type: 'item.completed', item: { type: 'agent_message', text: 'Hello' } },
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0].content, 'Hello');
});

test('buildSplitMessagesFromCodexJsonEvents splits two agent_messages into separate results', () => {
  const results = buildSplitMessagesFromCodexJsonEvents(BASE, [
    { type: 'item.completed', item: { type: 'agent_message', text: 'First' } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'Second' } },
  ]);
  assert.equal(results.length, 2);
  assert.equal(results[0].content, 'First');
  assert.equal(results[1].content, 'Second');
});

test('buildSplitMessagesFromCodexJsonEvents accumulates tool blocks with following text', () => {
  const results = buildSplitMessagesFromCodexJsonEvents(BASE, [
    { type: 'item.started', item: { type: 'command_execution', id: 'cmd-1', command: 'ls' } },
    { type: 'item.completed', item: { type: 'command_execution', id: 'cmd-1', aggregated_output: 'file.txt', exit_code: 0 } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'Done' } },
  ]);
  assert.equal(results.length, 1);
  const blockTypes = results[0].normalized.blocks.map((b) => b.type);
  assert.deepEqual(blockTypes, ['tool_use', 'tool_result', 'text']);
  assert.equal(results[0].content, 'Done');
});

test('buildSplitMessagesFromCodexJsonEvents flushes error event as a result', () => {
  const results = buildSplitMessagesFromCodexJsonEvents(BASE, [{ type: 'error', message: 'Something failed' }]);
  assert.equal(results.length, 1);
  assert.ok(results[0].content.includes('Something failed'));
});

test('buildSplitMessagesFromCodexJsonEvents ignores whitespace-only agent_message', () => {
  const results = buildSplitMessagesFromCodexJsonEvents(BASE, [
    { type: 'item.completed', item: { type: 'agent_message', text: '   ' } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'Hello' } },
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0].content, 'Hello');
});

test('buildSplitMessagesFromCodexJsonEvents handles response_item assistant message', () => {
  const results = buildSplitMessagesFromCodexJsonEvents(BASE, [
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: 'Hi there' } },
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0].content, 'Hi there');
});

test('buildSplitMessagesFromCodexJsonEvents accumulates function_call blocks before text flush', () => {
  const results = buildSplitMessagesFromCodexJsonEvents(BASE, [
    { type: 'response_item', payload: { type: 'function_call', name: 'my_tool', call_id: 'call-1', arguments: '{}' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-1', output: 'result' } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: 'Done' } },
  ]);
  assert.equal(results.length, 1);
  const blockTypes = results[0].normalized.blocks.map((b) => b.type);
  assert.ok(blockTypes.includes('tool_use'));
  assert.ok(blockTypes.includes('tool_result'));
  assert.ok(blockTypes.includes('text'));
});

test('buildSplitMessagesFromCodexJsonEvents handles event_msg task_complete', () => {
  const results = buildSplitMessagesFromCodexJsonEvents(BASE, [
    { type: 'event_msg', payload: { type: 'task_complete', last_agent_message: 'Task done' } },
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0].content, 'Task done');
});

test('buildSplitMessagesFromCodexJsonEvents ignores unknown event types', () => {
  const results = buildSplitMessagesFromCodexJsonEvents(BASE, [
    { type: 'some.unknown.event', data: 'ignored' },
    { type: 'item.completed', item: { type: 'agent_message', text: 'Hello' } },
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0].content, 'Hello');
});

test('buildSplitMessagesFromCodexJsonEvents result has correct provider and role', () => {
  const results = buildSplitMessagesFromCodexJsonEvents(BASE, [
    { type: 'item.completed', item: { type: 'agent_message', text: 'Hello' } },
  ]);
  assert.equal(results[0].normalized.provider, 'codex');
  assert.equal(results[0].normalized.role, 'assistant');
});

test('buildSplitMessagesFromCodexJsonEvents tool blocks only flushed when followed by text', () => {
  const results = buildSplitMessagesFromCodexJsonEvents(BASE, [
    { type: 'item.started', item: { type: 'command_execution', id: 'cmd-1', command: 'pwd' } },
    { type: 'item.completed', item: { type: 'command_execution', id: 'cmd-1', aggregated_output: '/home' } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'You are here' } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'All done' } },
  ]);
  assert.equal(results.length, 2);
  assert.equal(results[0].content, 'You are here');
  assert.equal(results[0].normalized.blocks.length, 3);
  assert.equal(results[1].content, 'All done');
  assert.equal(results[1].normalized.blocks.length, 1);
});

test('buildSplitMessagesFromCodexJsonEvents handles mcp_tool_call item blocks', () => {
  const results = buildSplitMessagesFromCodexJsonEvents(BASE, [
    {
      type: 'item.started',
      item: { type: 'mcp_tool_call', id: 'mcp-1', server: 'memory', tool: 'search', arguments: { q: 'test' } },
    },
    {
      type: 'item.completed',
      item: { type: 'mcp_tool_call', id: 'mcp-1', server: 'memory', tool: 'search', output: 'result text' },
    },
    { type: 'item.completed', item: { type: 'agent_message', text: 'Found it' } },
  ]);
  assert.equal(results.length, 1);
  assert.deepEqual(
    results[0].normalized.blocks.map((b) => b.type),
    ['tool_use', 'tool_result', 'text']
  );
  assert.equal((results[0].normalized.blocks[0] as { name: string }).name, 'mcp__memory__search');
  assert.equal(results[0].content, 'Found it');
});

test('buildSplitMessagesFromCodexJsonEvents ignores thread.completed', () => {
  const results = buildSplitMessagesFromCodexJsonEvents(BASE, [
    { type: 'thread.completed', usage: { input_tokens: 100, output_tokens: 50 } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'Done' } },
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0].content, 'Done');
});

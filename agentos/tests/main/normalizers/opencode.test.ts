/**
 * Tests for the opencode normalizer — imports the production module directly.
 *
 * Covers the JSONL event stream from `opencode run --format json`: growing text snapshots
 * (deduped per part.id), tool_use → tool_use/tool_result blocks, error surfacing, token usage
 * from step_finish, and the plain-text fallback for non-JSON output.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeOpencode } from '../../../src/main/normalizers/opencode.ts';

const BASE = { provider: 'opencode' as const, role: 'assistant' as const };

function jsonl(...events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n');
}

test('opencode: collapses growing text snapshots for a part.id into one block', () => {
  const raw = jsonl(
    { type: 'step_start', sessionID: 'ses_abc', part: { id: 's1', type: 'step-start' } },
    { type: 'text', sessionID: 'ses_abc', part: { id: 'p1', type: 'text', text: 'Hel' } },
    { type: 'text', sessionID: 'ses_abc', part: { id: 'p1', type: 'text', text: 'Hello wor' } },
    { type: 'text', sessionID: 'ses_abc', part: { id: 'p1', type: 'text', text: 'Hello world' } },
    { type: 'step_finish', sessionID: 'ses_abc', part: { id: 's1', type: 'step-finish', reason: 'stop' } }
  );
  const result = normalizeOpencode({ ...BASE, text: raw, raw });
  assert.equal(result.content, 'Hello world');
  const textBlocks = result.normalized.blocks.filter((b) => b.type === 'text');
  assert.equal(textBlocks.length, 1);
});

test('opencode: emits tool_use + tool_result blocks from a completed tool event', () => {
  const raw = jsonl(
    { type: 'text', sessionID: 'ses_1', part: { id: 'p1', type: 'text', text: 'Reading file' } },
    {
      type: 'tool_use',
      sessionID: 'ses_1',
      part: {
        id: 'prt_1',
        callID: 'call_9',
        tool: 'read',
        state: { status: 'completed', input: { path: 'a.ts' }, output: 'file contents' },
      },
    }
  );
  const result = normalizeOpencode({ ...BASE, text: raw, raw });
  const toolUse = result.normalized.blocks.find((b) => b.type === 'tool_use');
  const toolResult = result.normalized.blocks.find((b) => b.type === 'tool_result');
  assert.ok(toolUse && toolUse.type === 'tool_use');
  assert.equal(toolUse.id, 'call_9');
  assert.equal(toolUse.name, 'read');
  assert.ok(toolResult && toolResult.type === 'tool_result');
  assert.equal(toolResult.toolUseId, 'call_9');
  assert.equal(toolResult.content, 'file contents');
  assert.equal(toolResult.isError, false);
});

test('opencode: sums token usage from step_finish events', () => {
  const raw = jsonl(
    { type: 'text', sessionID: 'ses_1', part: { id: 'p1', type: 'text', text: 'hi' } },
    {
      type: 'step_finish',
      sessionID: 'ses_1',
      part: { id: 's1', type: 'step-finish', reason: 'stop', tokens: { input: 100, output: 20, cache: { read: 5 } } },
    }
  );
  const result = normalizeOpencode({ ...BASE, text: raw, raw });
  assert.ok(result.tokenUsage);
  assert.equal(result.tokenUsage.inputTokens, 100);
  assert.equal(result.tokenUsage.outputTokens, 20);
  assert.equal(result.tokenUsage.cacheReadTokens, 5);
});

test('opencode: surfaces an error event as text when there is no other content', () => {
  const raw = jsonl({ type: 'error', sessionID: 'ses_1', error: { name: 'ProviderError', data: { message: 'boom' } } });
  const result = normalizeOpencode({ ...BASE, text: raw, raw });
  assert.equal(result.content, 'boom');
});

test('opencode: falls back to plain text for non-JSON output', () => {
  const raw = 'just some plain text, not json';
  const result = normalizeOpencode({ ...BASE, text: raw, raw });
  assert.equal(result.content, 'just some plain text, not json');
  assert.equal(result.normalized.raw.source, 'plain_text');
});

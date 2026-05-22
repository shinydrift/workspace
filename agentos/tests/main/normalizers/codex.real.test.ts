/**
 * Tests for normalizers/codex.ts — importing the REAL production module.
 *
 * This file exists to prevent the drift problem in codex.test.mjs, which
 * reimplements the helpers instead of importing them.  If the production
 * module's exports change behaviour, these tests will fail.
 *
 * Run as part of test:ts (node --import tsx --test).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Importing the real TypeScript module via tsx.
import {
  normalizeCodex,
  normalizeCodexMessages,
  decodeCodexBuffer,
} from '../../../src/main/normalizers/codex.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '../../fixtures/normalizers/codex');

const BASE = { provider: 'codex' as const, role: 'assistant' as const, text: '' };

// ── normalizeCodex: plain text ────────────────────────────────────────────────

test('normalizeCodex: plain terminal text returned as text block', () => {
  const result = normalizeCodex({ ...BASE, text: 'Hello world' });
  assert.equal(result.content, 'Hello world');
  assert.ok(result.normalized.blocks.some((b) => b.type === 'text'));
});

test('normalizeCodex: trailing codex> prompt noise is stripped', () => {
  const result = normalizeCodex({ ...BASE, text: 'Some output\ncodex>' });
  assert.ok(!result.content.includes('codex>'));
  assert.ok(result.content.includes('Some output'));
});

test('normalizeCodex: auth screen yields empty content', () => {
  const authText = 'Welcome to Codex\nSign in with your account\nPress Enter to continue';
  const result = normalizeCodex({ ...BASE, text: authText });
  assert.equal(result.content, '');
});

test('normalizeCodex: non-assistant role returns input text unchanged', () => {
  const result = normalizeCodex({ ...BASE, role: 'user', text: 'User message' });
  assert.equal(result.content, 'User message');
});

// ── normalizeCodex: JSON events ───────────────────────────────────────────────

test('normalizeCodex: agent_message JSON event extracts text', () => {
  const raw = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Done' } });
  const result = normalizeCodex({ ...BASE, raw });
  assert.ok(result.content.includes('Done'));
});

test('normalizeCodex: turn.completed with usage populates tokenUsage', () => {
  const raw = [
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Result' } }),
    JSON.stringify({ type: 'turn.completed', model: 'gpt-5', usage: { input_tokens: 100, output_tokens: 50 } }),
  ].join('\n');
  const result = normalizeCodex({ ...BASE, raw });
  assert.ok(result.tokenUsage !== undefined);
  assert.equal(result.tokenUsage?.inputTokens, 100);
  assert.equal(result.tokenUsage?.outputTokens, 50);
});

test('normalizeCodex: cached tokens in input_tokens_details are captured', () => {
  const raw = [
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'ok' } }),
    JSON.stringify({
      type: 'turn.completed',
      model: 'gpt-5',
      usage: { input_tokens: 200, output_tokens: 80, input_tokens_details: { cached_tokens: 120 } },
    }),
  ].join('\n');
  const result = normalizeCodex({ ...BASE, raw });
  assert.equal(result.tokenUsage?.cacheReadTokens, 120);
});

test('normalizeCodex: turn.failed event surfaces error text', () => {
  const raw = JSON.stringify({ type: 'turn.failed', error: { message: 'Something went wrong' } });
  const result = normalizeCodex({ ...BASE, raw });
  assert.ok(result.content.includes('Something went wrong'));
});

test('normalizeCodex: malformed NDJSON mixed with valid lines is handled gracefully', () => {
  const raw = 'not json at all\n' + JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'ok' } }) + '\n{bad';
  const result = normalizeCodex({ ...BASE, raw });
  assert.ok(result.content.includes('ok'));
});

// ── normalizeCodexMessages: message splitting ─────────────────────────────────

test('normalizeCodexMessages: two agent_message events → two results', () => {
  const raw = [
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'First' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Second' } }),
  ].join('\n');
  const results = normalizeCodexMessages({ ...BASE, raw });
  assert.equal(results.length, 2);
  assert.equal(results[0].content, 'First');
  assert.equal(results[1].content, 'Second');
});

test('normalizeCodexMessages: plain text → single-item array', () => {
  const results = normalizeCodexMessages({ ...BASE, text: 'Hello' });
  assert.equal(results.length, 1);
  assert.equal(results[0].content, 'Hello');
});

test('normalizeCodexMessages: token usage attached to first result only', () => {
  const raw = [
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'A' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'B' } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 50, output_tokens: 10 } }),
  ].join('\n');
  const results = normalizeCodexMessages({ ...BASE, raw });
  assert.ok(results.length >= 2);
  assert.ok(results[0].tokenUsage !== undefined);
  assert.equal(results[1].tokenUsage, undefined);
});

// ── decodeCodexBuffer ─────────────────────────────────────────────────────────

test('decodeCodexBuffer: extracts text from agent_message events', () => {
  const buffer = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Hello from agent' } });
  const result = decodeCodexBuffer(buffer);
  assert.equal(result, 'Hello from agent');
});

test('decodeCodexBuffer: empty buffer → empty string', () => {
  assert.equal(decodeCodexBuffer(''), '');
});

test('decodeCodexBuffer: handles malformed NDJSON gracefully', () => {
  const buffer =
    'not json\n' +
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'ok' } }) +
    '\nmore garbage';
  const result = decodeCodexBuffer(buffer);
  assert.equal(result, 'ok');
});

// ── fixture-based tests ───────────────────────────────────────────────────────

test('fixture simple-response.ndjson: extracts text from agent_message', () => {
  const raw = fs.readFileSync(path.join(FIXTURES, 'simple-response.ndjson'), 'utf8');
  const result = normalizeCodexMessages({ ...BASE, raw });
  assert.ok(result.length >= 1);
  assert.ok(result.some((r) => r.content.includes('42')));
});

test('fixture tool-use.ndjson: produces tool_use + tool_result blocks', () => {
  const raw = fs.readFileSync(path.join(FIXTURES, 'tool-use.ndjson'), 'utf8');
  const results = normalizeCodexMessages({ ...BASE, raw });
  const allBlocks = results.flatMap((r) => r.normalized.blocks);
  assert.ok(allBlocks.some((b) => b.type === 'tool_use'));
  assert.ok(allBlocks.some((b) => b.type === 'tool_result'));
});

test('fixture error-response.ndjson: surfaces error message', () => {
  const raw = fs.readFileSync(path.join(FIXTURES, 'error-response.ndjson'), 'utf8');
  const result = normalizeCodex({ ...BASE, raw });
  assert.ok(result.content.length > 0);
});

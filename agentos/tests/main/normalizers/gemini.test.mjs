/**
 * Tests for normalizers/gemini.ts — normalizeGemini.
 * Pure logic inlined — no TS loader needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined helpers ───────────────────────────────────────────────────────────

function buildPlainTextResult(input) {
  const content = input.text.trim();
  const blocks = content ? [{ type: 'text', text: content }] : [];
  return {
    content,
    normalized: {
      schemaVersion: 1,
      provider: input.provider,
      role: input.role,
      blocks,
      raw: { source: 'plain_text', payload: input.raw ?? input.text },
    },
  };
}

function extractGeminiTokenUsage(events) {
  let model;
  for (const e of events) {
    const type = typeof e.type === 'string' ? e.type.toLowerCase() : '';
    if (type === 'init') {
      if (typeof e.model === 'string') model = e.model;
      continue;
    }
    if (type === 'result') {
      const stats = e.stats != null && typeof e.stats === 'object' ? e.stats : null;
      if (!stats) continue;
      const inputTokens = typeof stats.input_tokens === 'number' ? stats.input_tokens : 0;
      const outputTokens = typeof stats.output_tokens === 'number' ? stats.output_tokens : 0;
      if (inputTokens === 0 && outputTokens === 0) continue;
      const cacheReadTokens = typeof stats.cached === 'number' && stats.cached > 0 ? stats.cached : undefined;
      return { inputTokens, outputTokens, cacheReadTokens, model };
    }
  }
  return undefined;
}

function parseJsonLines(text) {
  const events = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) events.push(parsed);
    } catch { /* ignore */ }
  }
  return events;
}

function buildFromGeminiJsonEvents(input, events) {
  const blocks = [];
  const errorParts = [];
  const appendText = (text) => {
    if (!text) return;
    const prev = blocks[blocks.length - 1];
    if (prev?.type === 'text') { prev.text += text; } else { blocks.push({ type: 'text', text }); }
  };

  for (const event of events) {
    const type = typeof event.type === 'string' ? event.type.toLowerCase() : '';
    if (!type) continue;

    if (type === 'message') {
      const role = typeof event.role === 'string' ? event.role.toLowerCase() : '';
      const content = typeof event.content === 'string' ? event.content : '';
      if (role === 'assistant' && content && input.role === 'assistant') appendText(content);
      else if (role === 'user' && input.role === 'user' && content) appendText(content);
      continue;
    }

    if (input.role === 'assistant' && type === 'tool_use') {
      const toolId = typeof event.tool_id === 'string' ? event.tool_id : '';
      const toolName = typeof event.tool_name === 'string' ? event.tool_name : 'tool';
      if (!toolId) continue;
      blocks.push({ type: 'tool_use', id: toolId, name: toolName, input: event.parameters ?? {} });
      continue;
    }

    if (input.role === 'assistant' && type === 'tool_result') {
      const toolUseId = typeof event.tool_id === 'string' ? event.tool_id : '';
      if (!toolUseId) continue;
      const content = typeof event.output === 'string' ? event.output : JSON.stringify(event.output ?? '');
      const status = typeof event.status === 'string' ? event.status.toLowerCase() : '';
      blocks.push({ type: 'tool_result', toolUseId, content, isError: status === 'error' || status === 'failed' });
      continue;
    }

    if ((type === 'error' || type === 'result') && typeof event.error === 'string' && event.error.trim()) {
      errorParts.push(event.error.trim());
    }
  }

  if (input.role === 'assistant' && blocks.length === 0 && errorParts.length > 0) {
    blocks.push({ type: 'text', text: errorParts.join('\n') });
  }

  if (blocks.length === 0) return null;

  return {
    content: blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(),
    normalized: { schemaVersion: 1, provider: 'gemini', role: input.role, blocks, raw: { source: 'stream_json', payload: events } },
  };
}

function normalizeGemini(input) {
  const events = parseJsonLines(input.raw ?? input.text);
  if (events.length > 0) {
    const result = buildFromGeminiJsonEvents(input, events);
    if (result) {
      result.tokenUsage = extractGeminiTokenUsage(events);
      return result;
    }
  }
  return buildPlainTextResult(input);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function lines(...objs) {
  return objs.map((o) => JSON.stringify(o)).join('\n');
}

// ── parseJsonLines ────────────────────────────────────────────────────────────

test('parseJsonLines: empty string returns empty array', () => {
  assert.deepEqual(parseJsonLines(''), []);
});

test('parseJsonLines: non-JSON line ignored', () => {
  assert.deepEqual(parseJsonLines('not json'), []);
});

test('parseJsonLines: valid JSON line parsed', () => {
  const result = parseJsonLines('{"type":"message","role":"assistant","content":"hello"}');
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'message');
});

test('parseJsonLines: multiple lines', () => {
  const text = lines({ type: 'a' }, { type: 'b' }, { type: 'c' });
  assert.equal(parseJsonLines(text).length, 3);
});

test('parseJsonLines: skips arrays', () => {
  assert.deepEqual(parseJsonLines('[1,2,3]'), []);
});

// ── normalizeGemini ───────────────────────────────────────────────────────────

test('normalizeGemini: plain text fallback for empty', () => {
  const result = normalizeGemini({ provider: 'gemini', role: 'assistant', text: 'plain output' });
  assert.equal(result.content, 'plain output');
  assert.equal(result.normalized.raw.source, 'plain_text');
});

test('normalizeGemini: message event builds text block', () => {
  const text = lines({ type: 'message', role: 'assistant', content: 'Hello from gemini' });
  const result = normalizeGemini({ provider: 'gemini', role: 'assistant', text });
  assert.equal(result.content, 'Hello from gemini');
  assert.equal(result.normalized.blocks[0].type, 'text');
});

test('normalizeGemini: multiple message events concatenated', () => {
  const text = lines(
    { type: 'message', role: 'assistant', content: 'Hello ' },
    { type: 'message', role: 'assistant', content: 'world' },
  );
  const result = normalizeGemini({ provider: 'gemini', role: 'assistant', text });
  assert.ok(result.content.includes('Hello'));
  assert.ok(result.content.includes('world'));
});

test('normalizeGemini: user role gets user message', () => {
  const text = lines({ type: 'message', role: 'user', content: 'my question' });
  const result = normalizeGemini({ provider: 'gemini', role: 'user', text });
  assert.equal(result.content, 'my question');
});

test('normalizeGemini: tool_use block built for assistant', () => {
  const text = lines(
    { type: 'tool_use', tool_id: 'tu1', tool_name: 'Read', parameters: { path: '/foo' } },
  );
  const result = normalizeGemini({ provider: 'gemini', role: 'assistant', text });
  assert.equal(result.normalized.blocks[0].type, 'tool_use');
  assert.equal(result.normalized.blocks[0].name, 'Read');
  assert.equal(result.normalized.blocks[0].id, 'tu1');
});

test('normalizeGemini: tool_use without tool_id is skipped', () => {
  const text = lines({ type: 'tool_use', tool_name: 'Read' }); // no tool_id
  const result = normalizeGemini({ provider: 'gemini', role: 'assistant', text });
  assert.equal(result.normalized.raw.source, 'plain_text');
});

test('normalizeGemini: tool_result block built', () => {
  const text = lines(
    { type: 'message', role: 'assistant', content: 'ok' },
    { type: 'tool_result', tool_id: 'tu1', output: 'file content', status: 'ok' },
  );
  const result = normalizeGemini({ provider: 'gemini', role: 'assistant', text });
  const toolResult = result.normalized.blocks.find((b) => b.type === 'tool_result');
  assert.ok(toolResult);
  assert.equal(toolResult.toolUseId, 'tu1');
  assert.equal(toolResult.content, 'file content');
  assert.equal(toolResult.isError, false);
});

test('normalizeGemini: tool_result with error status sets isError', () => {
  const text = lines(
    { type: 'message', role: 'assistant', content: 'err' },
    { type: 'tool_result', tool_id: 'tu1', output: 'failed', status: 'error' },
  );
  const result = normalizeGemini({ provider: 'gemini', role: 'assistant', text });
  const toolResult = result.normalized.blocks.find((b) => b.type === 'tool_result');
  assert.ok(toolResult.isError);
});

test('normalizeGemini: error event surfaced as text when no blocks', () => {
  const text = lines({ type: 'error', error: 'something went wrong' });
  const result = normalizeGemini({ provider: 'gemini', role: 'assistant', text });
  assert.ok(result.content.includes('something went wrong'));
});

test('normalizeGemini: token usage from result.stats', () => {
  const text = lines(
    { type: 'message', role: 'assistant', content: 'ok' },
    { type: 'result', status: 'success', stats: { input_tokens: 100, output_tokens: 50, cached: 0 } },
  );
  const result = normalizeGemini({ provider: 'gemini', role: 'assistant', text });
  assert.ok(result.tokenUsage);
  assert.equal(result.tokenUsage.inputTokens, 100);
  assert.equal(result.tokenUsage.outputTokens, 50);
});

test('normalizeGemini: cache tokens extracted from result.stats.cached', () => {
  const text = lines(
    { type: 'message', role: 'assistant', content: 'ok' },
    { type: 'result', status: 'success', stats: { input_tokens: 200, output_tokens: 80, cached: 40 } },
  );
  const result = normalizeGemini({ provider: 'gemini', role: 'assistant', text });
  assert.ok(result.tokenUsage);
  assert.equal(result.tokenUsage.cacheReadTokens, 40);
});

test('normalizeGemini: model extracted from init event', () => {
  const text = lines(
    { type: 'init', model: 'gemini-2.5-pro', session_id: 'abc' },
    { type: 'message', role: 'assistant', content: 'ok' },
    { type: 'result', status: 'success', stats: { input_tokens: 100, output_tokens: 50, cached: 0 } },
  );
  const result = normalizeGemini({ provider: 'gemini', role: 'assistant', text });
  assert.ok(result.tokenUsage);
  assert.equal(result.tokenUsage.model, 'gemini-2.5-pro');
});

test('normalizeGemini: zero cached gives undefined cacheReadTokens', () => {
  const text = lines(
    { type: 'message', role: 'assistant', content: 'ok' },
    { type: 'result', status: 'success', stats: { input_tokens: 100, output_tokens: 50, cached: 0 } },
  );
  const result = normalizeGemini({ provider: 'gemini', role: 'assistant', text });
  assert.equal(result.tokenUsage?.cacheReadTokens, undefined);
});

test('normalizeGemini: no result event gives undefined tokenUsage', () => {
  const text = lines({ type: 'message', role: 'assistant', content: 'ok' });
  const result = normalizeGemini({ provider: 'gemini', role: 'assistant', text });
  assert.equal(result.tokenUsage, undefined);
});

test('normalizeGemini: provider is gemini in normalized payload', () => {
  const text = lines({ type: 'message', role: 'assistant', content: 'ok' });
  const result = normalizeGemini({ provider: 'gemini', role: 'assistant', text });
  assert.equal(result.normalized.provider, 'gemini');
  assert.equal(result.normalized.schemaVersion, 1);
});

test('normalizeGemini: raw field used over text when provided', () => {
  const rawText = lines({ type: 'message', role: 'assistant', content: 'from raw' });
  const result = normalizeGemini({ provider: 'gemini', role: 'assistant', text: 'ignored', raw: rawText });
  assert.equal(result.content, 'from raw');
});

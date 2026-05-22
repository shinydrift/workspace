/**
 * Tests for normalizers/claude.ts — normalizeClaude and normalizeClaude_multi.
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

function toToolResultContent(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value ?? '');
}

function collectToolResultBlocks(events) {
  const out = [];
  for (const raw of events) {
    const event = raw.type === 'stream_event' && raw.event ? raw.event : raw;
    if (event.type === 'tool_result') {
      const contentValue = event.content ?? event.tool_result ?? event.content_result;
      out.push({
        type: 'tool_result',
        toolUseId: event.tool_use_id ?? `tool-${out.length}`,
        content: toToolResultContent(contentValue),
        isError: event.is_error,
      });
    } else if (event.type === 'user' && Array.isArray(event.message?.content)) {
      for (const item of event.message.content) {
        if (item.type === 'tool_result') {
          out.push({
            type: 'tool_result',
            toolUseId: item.tool_use_id ?? `tool-${out.length}`,
            content: toToolResultContent(item.content),
            isError: item.is_error,
          });
        }
      }
    }
  }
  return out;
}

function parseStreamJsonEvents(text) {
  const events = [];
  let pos = 0;
  while (pos < text.length) {
    const start = text.indexOf('{', pos);
    if (start === -1) break;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    if (end === -1) break;
    try {
      const parsed = JSON.parse(text.slice(start, end));
      if (typeof parsed === 'object' && parsed !== null) events.push(parsed);
    } catch {
      /* ignore */
    }
    pos = end;
  }
  return events;
}

function buildBlocksFromContent(content) {
  const blocks = [];
  for (const item of content) {
    if (item.type === 'text' && item.text) {
      blocks.push({ type: 'text', text: item.text });
    } else if (item.type === 'thinking') {
      const thinkingText = typeof item.thinking === 'string' ? item.thinking : item.text;
      if (thinkingText) blocks.push({ type: 'thinking', text: thinkingText });
    } else if (item.type === 'tool_use') {
      blocks.push({
        type: 'tool_use',
        id: item.id ?? `tool-${blocks.length}`,
        name: item.name ?? 'tool',
        input: item.input,
      });
    }
  }
  return blocks;
}

function buildBlocksFromEvents(events) {
  const assistantEvents = events.filter((e) => e.type === 'assistant' && e.message?.content);
  const toolResultBlocks = collectToolResultBlocks(events);
  if (assistantEvents.length > 0) {
    const blocks = [];
    for (const e of assistantEvents) {
      if (e.message?.content) blocks.push(...buildBlocksFromContent(e.message.content));
    }
    if (blocks.length > 0 || toolResultBlocks.length > 0) return [...blocks, ...toolResultBlocks];
  }

  const blocks = [];
  const appendText = (value) => {
    if (!value) return;
    const prev = blocks[blocks.length - 1];
    if (prev?.type === 'text') {
      prev.text += value;
      return;
    }
    blocks.push({ type: 'text', text: value });
  };
  const appendThinking = (value) => {
    if (!value) return;
    const prev = blocks[blocks.length - 1];
    if (prev?.type === 'thinking') {
      prev.text += value;
      return;
    }
    blocks.push({ type: 'thinking', text: value });
  };

  for (const raw of events) {
    const event = raw.type === 'stream_event' && raw.event ? raw.event : raw;
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      appendText(event.delta.text);
      continue;
    }
    if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
      appendThinking(event.delta.thinking ?? event.delta.text);
      continue;
    }
    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      blocks.push({
        type: 'tool_use',
        id: event.content_block.id ?? `tool-${blocks.length}`,
        name: event.content_block.name ?? 'tool',
        input: event.content_block.input,
      });
      continue;
    }
    if (event.type === 'tool_result') {
      blocks.push({
        type: 'tool_result',
        toolUseId: event.tool_use_id ?? `tool-${blocks.length}`,
        content: typeof event.content === 'string' ? event.content : JSON.stringify(event.content ?? ''),
        isError: event.is_error,
      });
      continue;
    }
    if (event.type === 'user' && Array.isArray(event.message?.content)) {
      for (const item of event.message.content) {
        if (item.type === 'tool_result') {
          blocks.push({
            type: 'tool_result',
            toolUseId: item.tool_use_id ?? `tool-${blocks.length}`,
            content: toToolResultContent(item.content),
            isError: item.is_error,
          });
        }
      }
      continue;
    }
    if (Array.isArray(event.content)) {
      for (const item of event.content) {
        if (item.type === 'text') {
          appendText(item.text);
          continue;
        }
        if (item.type === 'thinking') {
          appendThinking(typeof item.thinking === 'string' ? item.thinking : item.text);
          continue;
        }
        if (item.type === 'tool_use') {
          blocks.push({
            type: 'tool_use',
            id: item.id ?? `tool-${blocks.length}`,
            name: item.name ?? 'tool',
            input: item.input,
          });
        }
      }
    }
    if (event.content_block?.type === 'text') appendText(event.content_block.text);
    else if (event.content_block?.type === 'thinking')
      appendThinking(event.content_block.thinking ?? event.content_block.text);
  }
  return blocks;
}

function extractTokenUsage(events) {
  // Stream-json (headless) is authoritative when present — its final `assistant`
  // event would otherwise double-count. Interactive JSONL has no message_start,
  // so we fall through to the assistant-event path.
  const hasStreamJsonEnvelope = events.some((raw) => {
    const event = raw.type === 'stream_event' && raw.event ? raw.event : raw;
    return event.type === 'message_start' || event.type === 'message_delta';
  });

  let inputTokens = 0,
    outputTokens = 0,
    cacheReadTokens = 0,
    cacheCreationTokens = 0;
  let model;

  if (hasStreamJsonEnvelope) {
    for (const raw of events) {
      const event = raw.type === 'stream_event' && raw.event ? raw.event : raw;
      if (event.type === 'message_start' && event.message) {
        if (event.message.usage?.input_tokens) inputTokens += event.message.usage.input_tokens;
        if (event.message.usage?.output_tokens) outputTokens += event.message.usage.output_tokens;
        if (event.message.usage?.cache_read_input_tokens)
          cacheReadTokens += event.message.usage.cache_read_input_tokens;
        if (event.message.usage?.cache_creation_input_tokens)
          cacheCreationTokens += event.message.usage.cache_creation_input_tokens;
        if (event.message.model) model = event.message.model;
      } else if (event.type === 'message_delta' && event.usage) {
        if (event.usage.output_tokens) outputTokens += event.usage.output_tokens;
        if (event.usage.input_tokens) inputTokens += event.usage.input_tokens;
      }
    }
  } else {
    // Interactive JSONL: dedupe last-wins per message.id (chunks may carry partial usage),
    // then sum across distinct ids for multi-turn flushes.
    const lastByMsgId = new Map();
    for (const raw of events) {
      const event = raw.type === 'stream_event' && raw.event ? raw.event : raw;
      if (event.type !== 'assistant' || !event.message?.usage || !event.message.id) continue;
      const u = event.message.usage;
      if ((u.input_tokens ?? 0) === 0 && (u.output_tokens ?? 0) === 0) continue;
      lastByMsgId.set(event.message.id, { u, model: event.message.model });
    }
    for (const { u, model: m } of lastByMsgId.values()) {
      inputTokens += u.input_tokens ?? 0;
      outputTokens += u.output_tokens ?? 0;
      cacheReadTokens += u.cache_read_input_tokens ?? 0;
      cacheCreationTokens += u.cache_creation_input_tokens ?? 0;
      if (m) model = m;
    }
  }

  if (inputTokens === 0 && outputTokens === 0) return undefined;
  return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, model };
}

function normalizeClaude(input) {
  const fallback = buildPlainTextResult(input);
  if (input.role !== 'assistant') return fallback;
  const events = parseStreamJsonEvents(input.text);
  if (events.length === 0) return fallback;
  const blocks = buildBlocksFromEvents(events);
  if (blocks.length === 0) return fallback;
  const firstText = blocks.find((b) => b.type === 'text');
  const content = firstText?.text.trim() ?? '';
  return {
    content,
    normalized: {
      schemaVersion: 1,
      provider: input.provider,
      role: input.role,
      blocks,
      raw: { source: 'stream_json', payload: events },
    },
    tokenUsage: extractTokenUsage(events),
  };
}

// ── parseStreamJsonEvents ────────────────────────────────────────────────────

test('parseStreamJsonEvents: empty string returns empty array', () => {
  assert.deepEqual(parseStreamJsonEvents(''), []);
});

test('parseStreamJsonEvents: single JSON object', () => {
  const result = parseStreamJsonEvents('{"type":"text","text":"hello"}');
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'text');
});

test('parseStreamJsonEvents: multiple concatenated JSON objects', () => {
  const result = parseStreamJsonEvents('{"type":"a"}{"type":"b"}{"type":"c"}');
  assert.equal(result.length, 3);
});

test('parseStreamJsonEvents: skips non-JSON content between objects', () => {
  const result = parseStreamJsonEvents('junk{"type":"a"}more junk{"type":"b"}');
  assert.equal(result.length, 2);
});

test('parseStreamJsonEvents: handles nested objects', () => {
  const result = parseStreamJsonEvents('{"type":"outer","inner":{"key":"value"}}');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].inner, { key: 'value' });
});

test('parseStreamJsonEvents: handles escaped quotes in strings', () => {
  const result = parseStreamJsonEvents('{"text":"say \\"hello\\""}');
  assert.equal(result.length, 1);
  assert.equal(result[0].text, 'say "hello"');
});

// ── normalizeClaude ───────────────────────────────────────────────────────────

test('normalizeClaude: user role returns plain text', () => {
  const result = normalizeClaude({ provider: 'claude', role: 'user', text: 'hello' });
  assert.equal(result.content, 'hello');
  assert.equal(result.normalized.raw.source, 'plain_text');
});

test('normalizeClaude: empty text returns plain text fallback', () => {
  const result = normalizeClaude({ provider: 'claude', role: 'assistant', text: '' });
  assert.equal(result.content, '');
  assert.equal(result.normalized.raw.source, 'plain_text');
});

test('normalizeClaude: assistant event with content builds text block', () => {
  const event = { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello there' }] } };
  const result = normalizeClaude({ provider: 'claude', role: 'assistant', text: JSON.stringify(event) });
  assert.equal(result.content, 'Hello there');
  assert.equal(result.normalized.blocks[0].type, 'text');
});

test('normalizeClaude: assistant event with tool_use builds tool block', () => {
  const event = {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/foo' } }] },
  };
  const result = normalizeClaude({ provider: 'claude', role: 'assistant', text: JSON.stringify(event) });
  assert.equal(result.normalized.blocks[0].type, 'tool_use');
  assert.equal(result.normalized.blocks[0].name, 'Read');
});

test('normalizeClaude: stream deltas concatenated', () => {
  const events = [
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } },
  ];
  const text = events.map((e) => JSON.stringify(e)).join('');
  const result = normalizeClaude({ provider: 'claude', role: 'assistant', text });
  assert.equal(result.content, 'Hello world');
});

test('normalizeClaude: thinking delta builds thinking block', () => {
  const events = [
    { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm...' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'answer' } },
  ];
  const text = events.map((e) => JSON.stringify(e)).join('');
  const result = normalizeClaude({ provider: 'claude', role: 'assistant', text });
  assert.ok(result.normalized.blocks.some((b) => b.type === 'thinking'));
});

test('normalizeClaude: extractTokenUsage from message_start', () => {
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 50 }, model: 'claude-sonnet-4-6' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } },
  ];
  const text = events.map((e) => JSON.stringify(e)).join('');
  const result = normalizeClaude({ provider: 'claude', role: 'assistant', text });
  assert.ok(result.tokenUsage);
  assert.equal(result.tokenUsage.inputTokens, 100);
  assert.equal(result.tokenUsage.outputTokens, 50);
  assert.equal(result.tokenUsage.model, 'claude-sonnet-4-6');
});

test('normalizeClaude: extractTokenUsage from interactive assistant JSONL', () => {
  // Interactive mode: no message_start envelope, usage carried on the final assistant chunk.
  const events = [
    { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'text', text: 'hi' }] } },
    {
      type: 'assistant',
      message: {
        id: 'msg_1',
        usage: { input_tokens: 200, output_tokens: 80, cache_read_input_tokens: 50 },
        model: 'claude-opus-4-7',
      },
    },
  ];
  const text = events.map((e) => JSON.stringify(e)).join('');
  const result = normalizeClaude({ provider: 'claude', role: 'assistant', text });
  assert.ok(result.tokenUsage);
  assert.equal(result.tokenUsage.inputTokens, 200);
  assert.equal(result.tokenUsage.outputTokens, 80);
  assert.equal(result.tokenUsage.cacheReadTokens, 50);
  assert.equal(result.tokenUsage.model, 'claude-opus-4-7');
});

test('normalizeClaude: interactive multi-turn assistant events sum across message.ids', () => {
  const events = [
    {
      type: 'assistant',
      message: { id: 'msg_1', content: [{ type: 'text', text: 'a' }], usage: { input_tokens: 100, output_tokens: 40 } },
    },
    {
      type: 'assistant',
      message: { id: 'msg_2', content: [{ type: 'text', text: 'b' }], usage: { input_tokens: 150, output_tokens: 60 } },
    },
  ];
  const text = events.map((e) => JSON.stringify(e)).join('');
  const result = normalizeClaude({ provider: 'claude', role: 'assistant', text });
  assert.equal(result.tokenUsage.inputTokens, 250);
  assert.equal(result.tokenUsage.outputTokens, 100);
});

test('normalizeClaude: interactive same message.id chunks dedupe to last usage', () => {
  // Watcher may emit partial usage on earlier chunks; we keep only the last per id.
  const events = [
    {
      type: 'assistant',
      message: {
        id: 'msg_1',
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 100, output_tokens: 10 },
      },
    },
    { type: 'assistant', message: { id: 'msg_1', usage: { input_tokens: 100, output_tokens: 50 } } },
  ];
  const text = events.map((e) => JSON.stringify(e)).join('');
  const result = normalizeClaude({ provider: 'claude', role: 'assistant', text });
  assert.equal(result.tokenUsage.inputTokens, 100);
  assert.equal(result.tokenUsage.outputTokens, 50);
});

test('normalizeClaude: headless message_start + assistant with usage does not double-count', () => {
  // Stream-json emits both message_start AND a final assistant event carrying usage.
  // The assistant-event path must be suppressed when message_start is present.
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 0 } } },
    {
      type: 'assistant',
      message: {
        id: 'msg_1',
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    },
    { type: 'message_delta', usage: { output_tokens: 50 } },
  ];
  const text = events.map((e) => JSON.stringify(e)).join('');
  const result = normalizeClaude({ provider: 'claude', role: 'assistant', text });
  assert.equal(result.tokenUsage.inputTokens, 100, 'input should not double-count');
  assert.equal(result.tokenUsage.outputTokens, 50, 'output should not double-count');
});

test('normalizeClaude: no usage events returns undefined tokenUsage', () => {
  const event = { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } };
  const result = normalizeClaude({ provider: 'claude', role: 'assistant', text: JSON.stringify(event) });
  assert.equal(result.tokenUsage, undefined);
});

test('normalizeClaude: stream_event wrapper is unwrapped', () => {
  const inner = { type: 'content_block_delta', delta: { type: 'text_delta', text: 'wrapped' } };
  const outer = { type: 'stream_event', event: inner };
  const result = normalizeClaude({ provider: 'claude', role: 'assistant', text: JSON.stringify(outer) });
  assert.equal(result.content, 'wrapped');
});

test('normalizeClaude: provider is claude in normalized payload', () => {
  const event = { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } };
  const result = normalizeClaude({ provider: 'claude', role: 'assistant', text: JSON.stringify(event) });
  assert.equal(result.normalized.provider, 'claude');
  assert.equal(result.normalized.schemaVersion, 1);
});

test('normalizeClaude: preserves claude-interactive in normalized payload', () => {
  const event = { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } };
  const result = normalizeClaude({ provider: 'claude-interactive', role: 'assistant', text: JSON.stringify(event) });
  assert.equal(result.normalized.provider, 'claude-interactive');
});

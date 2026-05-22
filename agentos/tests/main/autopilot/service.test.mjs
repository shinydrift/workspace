/**
 * Tests for autopilot/service.ts — extractFirstJsonObject, parseAutopilotAction,
 * buildTranscript, extractTextContent, AutopilotService state machine.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from autopilot/service.ts ────────────────────────────────────────

function extractTextContent(message) {
  if (message.normalized?.blocks) {
    const text = message.normalized.blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (text) return text;
  }
  return message.content.trim();
}

function buildTranscript(messages) {
  return messages
    .map((message) => {
      const label = message.source === 'autopilot' ? 'autopilot-user' : message.role;
      return `[${label}] ${extractTextContent(message)}`;
    })
    .join('\n\n');
}

function extractFirstJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
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
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function parseAutopilotAction(text) {
  const parsed = extractFirstJsonObject(text);
  if (!parsed) {
    return { action: 'stop', reason: 'Planner did not return valid JSON.' };
  }

  const action = parsed.action;
  const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : 'No reason provided.';
  if (action === 'send_message') {
    const message = typeof parsed.message === 'string' ? parsed.message.trim() : '';
    if (!message) return { action: 'stop', reason: 'Planner requested send_message without content.' };
    return { action, message, reason };
  }
  if (action === 'noop' || action === 'stop') {
    return { action, reason };
  }
  return { action: 'stop', reason: 'Planner returned an unknown action.' };
}

// ── AutopilotService state machine (inlined pure logic) ───────────────────────

class AutopilotService {
  activeThreads = new Set();

  constructor(callbacks) {
    this.callbacks = callbacks;
  }

  maybeRunAfterTurn(threadId, source) {
    if (!['user', 'automation', 'autopilot'].includes(source)) return 'skipped:source';
    if (this.activeThreads.has(threadId)) return 'skipped:active';
    const thread = this.callbacks.getThread(threadId);
    if (!thread?.autopilotEnabled) return 'skipped:disabled';
    if (this.callbacks.hasPendingCouncilSubmission?.(threadId)) return 'skipped:council';
    if (this.callbacks.hasActiveStageWorker?.(threadId)) return 'skipped:stage-worker';
    if (this.callbacks.isThreadTaskTerminal?.(threadId)) return 'skipped:task-terminal';
    return 'eligible';
  }
}

// ── extractTextContent ────────────────────────────────────────────────────────

test('extractTextContent uses content when no normalized blocks', () => {
  const msg = { content: '  hello world  ' };
  assert.equal(extractTextContent(msg), 'hello world');
});

test('extractTextContent uses normalized text blocks', () => {
  const msg = {
    content: 'raw',
    normalized: { blocks: [{ type: 'text', text: 'from blocks' }] },
  };
  assert.equal(extractTextContent(msg), 'from blocks');
});

test('extractTextContent falls back to content when blocks are empty', () => {
  const msg = { content: 'fallback', normalized: { blocks: [] } };
  assert.equal(extractTextContent(msg), 'fallback');
});

test('extractTextContent joins multiple text blocks', () => {
  const msg = {
    content: 'raw',
    normalized: {
      blocks: [
        { type: 'text', text: 'line one' },
        { type: 'tool_use', name: 'bash' },
        { type: 'text', text: 'line two' },
      ],
    },
  };
  assert.equal(extractTextContent(msg), 'line one\nline two');
});

// ── buildTranscript ───────────────────────────────────────────────────────────

test('buildTranscript formats user message', () => {
  const messages = [{ role: 'user', content: 'hello' }];
  assert.equal(buildTranscript(messages), '[user] hello');
});

test('buildTranscript formats assistant message', () => {
  const messages = [{ role: 'assistant', content: 'hi there' }];
  assert.equal(buildTranscript(messages), '[assistant] hi there');
});

test('buildTranscript labels autopilot source as autopilot-user', () => {
  const messages = [{ role: 'user', source: 'autopilot', content: 'next step' }];
  assert.equal(buildTranscript(messages), '[autopilot-user] next step');
});

test('buildTranscript joins multiple messages with double newline', () => {
  const messages = [
    { role: 'user', content: 'Q' },
    { role: 'assistant', content: 'A' },
  ];
  assert.equal(buildTranscript(messages), '[user] Q\n\n[assistant] A');
});

test('buildTranscript returns empty string for no messages', () => {
  assert.equal(buildTranscript([]), '');
});

// ── extractFirstJsonObject ────────────────────────────────────────────────────

test('extractFirstJsonObject returns null when no { found', () => {
  assert.equal(extractFirstJsonObject('no json here'), null);
});

test('extractFirstJsonObject extracts plain object', () => {
  const result = extractFirstJsonObject('{"action":"stop","reason":"done"}');
  assert.deepEqual(result, { action: 'stop', reason: 'done' });
});

test('extractFirstJsonObject ignores preamble text', () => {
  const result = extractFirstJsonObject('Here is my answer: {"action":"noop","reason":"wait"}');
  assert.deepEqual(result, { action: 'noop', reason: 'wait' });
});

test('extractFirstJsonObject handles nested objects', () => {
  const result = extractFirstJsonObject('{"a":{"b":1}}');
  assert.deepEqual(result, { a: { b: 1 } });
});

test('extractFirstJsonObject handles strings with braces inside', () => {
  const result = extractFirstJsonObject('{"action":"send_message","message":"use {brackets}","reason":"ok"}');
  assert.equal(result?.message, 'use {brackets}');
});

test('extractFirstJsonObject returns null for malformed JSON', () => {
  assert.equal(extractFirstJsonObject('{bad json}'), null);
});

test('extractFirstJsonObject stops at first complete object', () => {
  const result = extractFirstJsonObject('{"a":1} {"b":2}');
  assert.deepEqual(result, { a: 1 });
});

// ── parseAutopilotAction ──────────────────────────────────────────────────────

test('parseAutopilotAction returns stop on non-JSON text', () => {
  const result = parseAutopilotAction('not json');
  assert.equal(result.action, 'stop');
  assert.equal(result.reason, 'Planner did not return valid JSON.');
});

test('parseAutopilotAction returns stop action', () => {
  const result = parseAutopilotAction('{"action":"stop","reason":"task done"}');
  assert.equal(result.action, 'stop');
  assert.equal(result.reason, 'task done');
});

test('parseAutopilotAction returns noop action', () => {
  const result = parseAutopilotAction('{"action":"noop","reason":"in progress"}');
  assert.equal(result.action, 'noop');
  assert.equal(result.reason, 'in progress');
});

test('parseAutopilotAction returns send_message with message', () => {
  const result = parseAutopilotAction('{"action":"send_message","message":"continue please","reason":"needs more"}');
  assert.equal(result.action, 'send_message');
  assert.equal(result.message, 'continue please');
  assert.equal(result.reason, 'needs more');
});

test('parseAutopilotAction returns stop when send_message has empty message', () => {
  const result = parseAutopilotAction('{"action":"send_message","message":"","reason":"x"}');
  assert.equal(result.action, 'stop');
  assert.equal(result.reason, 'Planner requested send_message without content.');
});

test('parseAutopilotAction returns stop for unknown action', () => {
  const result = parseAutopilotAction('{"action":"dance","reason":"why not"}');
  assert.equal(result.action, 'stop');
  assert.equal(result.reason, 'Planner returned an unknown action.');
});

test('parseAutopilotAction trims message whitespace', () => {
  const result = parseAutopilotAction('{"action":"send_message","message":"  hello  ","reason":"ok"}');
  assert.equal(result.message, 'hello');
});

test('parseAutopilotAction defaults reason when not a string', () => {
  const result = parseAutopilotAction('{"action":"stop","reason":null}');
  assert.equal(result.reason, 'No reason provided.');
});

// ── AutopilotService.maybeRunAfterTurn ────────────────────────────────────────

test('maybeRunAfterTurn skips non-eligible sources', () => {
  const svc = new AutopilotService({ getThread: () => ({ autopilotEnabled: true }) });
  assert.equal(svc.maybeRunAfterTurn('t1', 'system'), 'skipped:source');
  assert.equal(svc.maybeRunAfterTurn('t1', 'slack'), 'skipped:source');
});

test('maybeRunAfterTurn skips when thread is already active', () => {
  const svc = new AutopilotService({ getThread: () => ({ autopilotEnabled: true }) });
  svc.activeThreads.add('t1');
  assert.equal(svc.maybeRunAfterTurn('t1', 'user'), 'skipped:active');
});

test('maybeRunAfterTurn skips when autopilot disabled on thread', () => {
  const svc = new AutopilotService({ getThread: () => ({ autopilotEnabled: false }) });
  assert.equal(svc.maybeRunAfterTurn('t1', 'user'), 'skipped:disabled');
});

test('maybeRunAfterTurn skips when council submission is pending', () => {
  const svc = new AutopilotService({
    getThread: () => ({ autopilotEnabled: true }),
    hasPendingCouncilSubmission: () => true,
  });
  assert.equal(svc.maybeRunAfterTurn('t1', 'user'), 'skipped:council');
});

test('maybeRunAfterTurn skips when a kanban stage worker is active', () => {
  const svc = new AutopilotService({
    getThread: () => ({ autopilotEnabled: true }),
    hasPendingCouncilSubmission: () => false,
    hasActiveStageWorker: () => true,
  });
  assert.equal(svc.maybeRunAfterTurn('t1', 'user'), 'skipped:stage-worker');
});

test('maybeRunAfterTurn skips when thread task is in terminal status', () => {
  const svc = new AutopilotService({
    getThread: () => ({ autopilotEnabled: true }),
    hasPendingCouncilSubmission: () => false,
    hasActiveStageWorker: () => false,
    isThreadTaskTerminal: () => true,
  });
  assert.equal(svc.maybeRunAfterTurn('t1', 'user'), 'skipped:task-terminal');
});

test('maybeRunAfterTurn returns eligible for valid source + enabled thread', () => {
  const svc = new AutopilotService({
    getThread: () => ({ autopilotEnabled: true }),
    hasPendingCouncilSubmission: () => false,
  });
  assert.equal(svc.maybeRunAfterTurn('t1', 'user'), 'eligible');
  assert.equal(svc.maybeRunAfterTurn('t2', 'automation'), 'eligible');
  assert.equal(svc.maybeRunAfterTurn('t3', 'autopilot'), 'eligible');
});

test('maybeRunAfterTurn skips when thread not found', () => {
  const svc = new AutopilotService({ getThread: () => undefined });
  assert.equal(svc.maybeRunAfterTurn('t1', 'user'), 'skipped:disabled');
});

/**
 * Tests for autopilot/service.ts — buildTranscript, extractTextContent,
 * AutopilotService state machine. The planner's tool-call submission path is
 * covered by autopilotSubmission.test.ts against the real registry module.
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

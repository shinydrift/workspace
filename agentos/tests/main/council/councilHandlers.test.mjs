/**
 * Runtime tests for council handler behaviors (dispatch, synthesis trigger, idempotency).
 * Logic inlined per repo convention — no live IPC or electron-store.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFakeThreadManager() {
  const calls = [];
  /** Mirrors the Set-based idempotency guard in ThreadManager. */
  const triggered = new Set();
  return {
    triggerAutopilotForCouncilDone(threadId, runId) {
      if (triggered.has(runId)) return;
      triggered.add(runId);
      calls.push({ threadId, runId });
    },
    calls,
  };
}

function makeHandler(councilEvents, threadManager) {
  councilEvents.on('run:updated', (run) => {
    if (run.status === 'done') {
      threadManager.triggerAutopilotForCouncilDone(run.parentThreadId, run.id);
    }
  });
}

// ── run:updated done → synthesis trigger ─────────────────────────────────────

test('run:updated with status=done calls triggerAutopilotForCouncilDone', () => {
  const events = new EventEmitter();
  const tm = makeFakeThreadManager();
  makeHandler(events, tm);

  events.emit('run:updated', { id: 'crun_1', status: 'done', parentThreadId: 'thread_p' });

  assert.equal(tm.calls.length, 1);
  assert.equal(tm.calls[0].runId, 'crun_1');
  assert.equal(tm.calls[0].threadId, 'thread_p');
});

test('run:updated with status=running does not call triggerAutopilotForCouncilDone', () => {
  const events = new EventEmitter();
  const tm = makeFakeThreadManager();
  makeHandler(events, tm);

  events.emit('run:updated', { id: 'crun_1', status: 'running', parentThreadId: 'thread_p' });

  assert.equal(tm.calls.length, 0);
});

// ── Idempotency guard ─────────────────────────────────────────────────────────

test('triggerAutopilotForCouncilDone fires only once per runId even if run:updated fires twice', () => {
  const events = new EventEmitter();
  const tm = makeFakeThreadManager();
  makeHandler(events, tm);

  const run = { id: 'crun_dup', status: 'done', parentThreadId: 'thread_q' };
  events.emit('run:updated', run);
  events.emit('run:updated', run);

  assert.equal(tm.calls.length, 1, 'synthesis triggered more than once for same runId');
});

test('triggerAutopilotForCouncilDone fires independently for different runIds', () => {
  const events = new EventEmitter();
  const tm = makeFakeThreadManager();
  makeHandler(events, tm);

  events.emit('run:updated', { id: 'crun_a', status: 'done', parentThreadId: 'thread_r' });
  events.emit('run:updated', { id: 'crun_b', status: 'done', parentThreadId: 'thread_r' });

  assert.equal(tm.calls.length, 2);
  assert.equal(tm.calls[0].runId, 'crun_a');
  assert.equal(tm.calls[1].runId, 'crun_b');
});

// ── memberSchema: effort and reasoning ───────────────────────────────────────

const VALID_EFFORT_VALUES = ['low', 'medium', 'high', 'extra-high', 'max'];
const VALID_REASONING_VALUES = ['low', 'medium', 'high', 'extra-high'];

function validateMember(member) {
  if (!['claude', 'codex', 'gemini'].includes(member.provider)) return false;
  if (typeof member.model !== 'string' || member.model.length === 0) return false;
  if (member.effort !== undefined && !VALID_EFFORT_VALUES.includes(member.effort)) return false;
  if (member.reasoning !== undefined && !VALID_REASONING_VALUES.includes(member.reasoning)) return false;
  return true;
}

test('memberSchema accepts member with only provider and model', () => {
  assert.ok(validateMember({ provider: 'claude', model: 'sonnet' }));
});

test('memberSchema accepts member with effort', () => {
  assert.ok(validateMember({ provider: 'claude', model: 'opus', effort: 'high' }));
});

test('memberSchema accepts member with reasoning', () => {
  assert.ok(validateMember({ provider: 'codex', model: 'gpt-5', reasoning: 'medium' }));
});

test('memberSchema rejects invalid effort value', () => {
  assert.equal(validateMember({ provider: 'claude', model: 'opus', effort: 'turbo' }), false);
});

test('memberSchema rejects invalid reasoning value', () => {
  assert.equal(validateMember({ provider: 'codex', model: 'gpt-5', reasoning: 'max' }), false);
});

test('memberSchema rejects unknown provider', () => {
  assert.equal(validateMember({ provider: 'openai', model: 'gpt-4' }), false);
});

// ── recordOutcome idempotency guard ──────────────────────────────────────────

test('maybeCompleteRun returns early if run already done', () => {
  let completions = 0;
  function maybeCompleteRun(run) {
    if (run.status === 'done') return; // guard
    completions++;
  }
  const run = { id: 'r1', status: 'done' };
  maybeCompleteRun(run);
  maybeCompleteRun(run);
  assert.equal(completions, 0, 'should have returned early for done run');
});

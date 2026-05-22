/**
 * Integration test for the council dispatch → completion → synthesis trigger flow.
 *
 * Uses fake implementations of the thread runner, event emitter, and DB to exercise
 * the full chain without requiring Electron, Docker, or SQLite.
 *
 * Flow under test:
 *   runCouncil() → all members submit via onOutcome → run transitions to done
 *                → run:updated(done) fires → triggerAutopilotForCouncilDone called once
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// ── Fake DB ───────────────────────────────────────────────────────────────────

function makeFakeDb() {
  const runs = {};
  const outcomes = {};
  const runMembers = {};

  return {
    saveRun(run) {
      runs[run.id] = { ...run };
    },
    getRun(runId) {
      return runs[runId] ?? null;
    },
    updateRun(runId, updates) {
      if (!runs[runId]) return;
      Object.assign(runs[runId], updates);
    },
    insertRunMember(runId, memberIdx, member) {
      if (!runMembers[runId]) runMembers[runId] = [];
      runMembers[runId][memberIdx] = { memberIdx, childThreadId: null, provider: member.provider, model: member.model ?? '', status: 'pending' };
    },
    updateRunMember(runId, memberIdx, updates) {
      if (!runMembers[runId]?.[memberIdx]) return;
      Object.assign(runMembers[runId][memberIdx], updates);
    },
    updateRunMemberByChildId(runId, childThreadId, status) {
      const members = runMembers[runId] ?? [];
      const m = members.find((m) => m.childThreadId === childThreadId);
      if (m) m.status = status;
    },
    getRunMembers(runId) {
      return runMembers[runId] ?? [];
    },
    allRunMembersTerminal(runId) {
      const members = runMembers[runId] ?? [];
      if (members.length === 0) return false;
      const terminal = ['submitted', 'invalid', 'error', 'timeout'];
      return members.every((m) => terminal.includes(m.status));
    },
    saveOutcome(outcome) {
      if (!outcomes[outcome.runId]) outcomes[outcome.runId] = {};
      if (outcomes[outcome.runId][outcome.childThreadId]) return false; // dedup
      outcomes[outcome.runId][outcome.childThreadId] = outcome;
      return true;
    },
    getOutcomes(runId) {
      return Object.values(outcomes[runId] ?? {});
    },
    hasActiveRunForThread(parentThreadId) {
      return Object.values(runs).some(
        (r) => r.parentThreadId === parentThreadId && (r.status === 'running' || r.status === 'pending')
      );
    },
  };
}

// ── Fake service (mirrors CouncilService logic) ───────────────────────────────

function makeService(db, councilEvents) {
  function maybeCompleteRun(runId) {
    const run = db.getRun(runId);
    if (!run || run.status === 'done') return;
    if (!db.allRunMembersTerminal(runId)) return;
    db.updateRun(runId, { status: 'done', completedAt: Date.now() });
    const updated = db.getRun(runId);
    if (updated) councilEvents.emit('run:updated', updated);
  }

  function recordOutcome(runId, outcome) {
    const inserted = db.saveOutcome(outcome);
    if (!inserted) return; // dedup
    const run = db.getRun(runId);
    if (!run) return;
    db.updateRunMemberByChildId(runId, outcome.childThreadId, outcome.status);
    councilEvents.emit('outcome:submitted', { runId, outcome });
    maybeCompleteRun(runId);
  }

  async function runCouncil({ configId, parentThreadId, prompt, members, threadRunner }) {
    const runId = `crun_test_${Date.now()}`;
    const run = { id: runId, configId, parentThreadId, prompt, childThreadIds: [], status: 'running', createdAt: Date.now() };
    db.saveRun(run);
    members.forEach((member, idx) => db.insertRunMember(runId, idx, member));
    councilEvents.emit('run:updated', run);

    members.forEach((member, idx) => {
      threadRunner
        .spawnChildThread({ parentThreadId, runId, member, memberLabel: `${member.provider}/${member.model}`, prompt, onOutcome: (o) => recordOutcome(runId, o) })
        .then(({ childThreadId }) => {
          db.updateRunMember(runId, idx, { childThreadId, status: 'running' });
          const current = db.getRun(runId);
          if (current && !current.childThreadIds.includes(childThreadId)) {
            db.updateRun(runId, { childThreadIds: [...current.childThreadIds, childThreadId] });
          }
        })
        .catch(() => {
          db.updateRunMember(runId, idx, { status: 'error' });
          maybeCompleteRun(runId);
        });
    });

    return db.getRun(runId);
  }

  return { runCouncil, recordOutcome };
}

// ── Fake handler (mirrors councilHandlers.ts run:updated logic) ───────────────

function makeHandler(councilEvents, threadManager) {
  const triggered = new Set();
  councilEvents.on('run:updated', (run) => {
    if (run.status === 'done') {
      if (triggered.has(run.id)) return;
      triggered.add(run.id);
      threadManager.triggerAutopilotForCouncilDone(run.parentThreadId, run.id);
    }
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('full flow: all members submit → run done → synthesis triggered once', async () => {
  const db = makeFakeDb();
  const events = new EventEmitter();
  const svc = makeService(db, events);

  const synthesisCalls = [];
  const tm = { triggerAutopilotForCouncilDone: (threadId, runId) => synthesisCalls.push({ threadId, runId }) };
  makeHandler(events, tm);

  const members = [
    { provider: 'claude', model: 'opus' },
    { provider: 'codex', model: 'gpt-5' },
  ];

  // Thread runner that immediately invokes onOutcome after spawn
  const threadRunner = {
    async spawnChildThread({ runId, member, memberLabel, onOutcome }) {
      const childThreadId = `child_${member.provider}`;
      // Simulate async outcome submission
      setImmediate(() => onOutcome({ runId, childThreadId, member, status: 'submitted', outcome: { summary: 's', answer: 'a' }, submittedAt: Date.now() }));
      return { childThreadId };
    },
  };

  const run = await svc.runCouncil({ configId: 'cfg1', parentThreadId: 'thread_p', prompt: 'test', members, threadRunner });

  // Wait for all setImmediate callbacks to fire
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(db.getRun(run.id).status, 'done', 'run should be done after all members submit');
  assert.equal(synthesisCalls.length, 1, 'synthesis should be triggered exactly once');
  assert.equal(synthesisCalls[0].runId, run.id);
  assert.equal(synthesisCalls[0].threadId, 'thread_p');
});

test('synthesis is triggered exactly once even if run:updated fires multiple times', async () => {
  const events = new EventEmitter();
  const synthesisCalls = [];
  const triggered = new Set();

  events.on('run:updated', (run) => {
    if (run.status === 'done') {
      if (triggered.has(run.id)) return;
      triggered.add(run.id);
      synthesisCalls.push(run.id);
    }
  });

  const doneRun = { id: 'crun_dup', status: 'done', parentThreadId: 'tp' };
  events.emit('run:updated', doneRun);
  events.emit('run:updated', doneRun);
  events.emit('run:updated', doneRun);

  assert.equal(synthesisCalls.length, 1);
});

test('hasPendingRunForThread returns false after run completes', async () => {
  const db = makeFakeDb();
  const events = new EventEmitter();
  const svc = makeService(db, events);

  const members = [{ provider: 'claude', model: 'opus' }];
  const threadRunner = {
    async spawnChildThread({ runId, member, onOutcome }) {
      const childThreadId = 'child_single';
      setImmediate(() => onOutcome({ runId, childThreadId, member, status: 'submitted', outcome: { summary: 's', answer: 'a' }, submittedAt: Date.now() }));
      return { childThreadId };
    },
  };

  const run = await svc.runCouncil({ configId: 'cfg1', parentThreadId: 'thread_q', prompt: 'q', members, threadRunner });

  assert.ok(db.hasActiveRunForThread('thread_q'), 'should be active immediately after dispatch');

  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(db.getRun(run.id).status, 'done');
  assert.equal(db.hasActiveRunForThread('thread_q'), false, 'should not be active after completion');
});

test('run stays running until all members submit', async () => {
  const db = makeFakeDb();
  const events = new EventEmitter();
  const svc = makeService(db, events);

  const members = [
    { provider: 'claude', model: 'opus' },
    { provider: 'codex', model: 'gpt-5' },
  ];

  let resolveSecond;
  const secondDone = new Promise((res) => (resolveSecond = res));

  const threadRunner = {
    async spawnChildThread({ runId, member, onOutcome }) {
      const childThreadId = `child_${member.provider}`;
      if (member.provider === 'claude') {
        setImmediate(() => onOutcome({ runId, childThreadId, member, status: 'submitted', outcome: { summary: 's', answer: 'a' }, submittedAt: Date.now() }));
      } else {
        // Second member delays
        secondDone.then(() => onOutcome({ runId, childThreadId, member, status: 'submitted', outcome: { summary: 's2', answer: 'a2' }, submittedAt: Date.now() }));
      }
      return { childThreadId };
    },
  };

  const run = await svc.runCouncil({ configId: 'cfg1', parentThreadId: 'thread_r', prompt: 'r', members, threadRunner });
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(db.getRun(run.id).status, 'running', 'should still be running after only one member submits');

  resolveSecond();
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(db.getRun(run.id).status, 'done', 'should be done after both members submit');
});

/**
 * Tests for council/threadRunner.ts — Slice C: spawnChildThread delegation.
 * Logic inlined per repo convention.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

function createCouncilThreadRunner(deps) {
  return {
    spawnChildThread: (opts) => deps.spawnChildThread(opts),
  };
}

test('spawnChildThread forwards options to deps verbatim and returns childThreadId', async () => {
  const calls = [];
  const runner = createCouncilThreadRunner({
    spawnChildThread: async (opts) => {
      calls.push(opts);
      return { childThreadId: 'child_xyz' };
    },
  });

  const onOutcome = () => {};
  const result = await runner.spawnChildThread({
    parentThreadId: 'thread_parent',
    runId: 'crun_test',
    member: { provider: 'claude', model: 'sonnet' },
    memberLabel: 'Claude/sonnet',
    prompt: 'do the thing',
    onOutcome,
  });

  assert.equal(result.childThreadId, 'child_xyz');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].parentThreadId, 'thread_parent');
  assert.equal(calls[0].runId, 'crun_test');
  assert.deepEqual(calls[0].member, { provider: 'claude', model: 'sonnet' });
  assert.equal(calls[0].memberLabel, 'Claude/sonnet');
  assert.equal(calls[0].prompt, 'do the thing');
  assert.equal(calls[0].onOutcome, onOutcome);
});

test('runner exposes only spawnChildThread', () => {
  const runner = createCouncilThreadRunner({ spawnChildThread: async () => ({ childThreadId: 'x' }) });
  assert.equal(typeof runner.spawnChildThread, 'function');
  assert.equal(Object.keys(runner).length, 1);
});

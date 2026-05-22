/**
 * Tests for child-thread boot instruction builders.
 * Functions inlined from ThreadManager.ts and council/bootInstructions.ts to
 * avoid Electron dependencies.  Covers stage and council child boot instruction
 * generation — the seams extracted by plans 33–34.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from ThreadManager.ts ────────────────────────────────────────────

function buildStageBootInstructions(opts: { childThreadId: string; taskId: string; stage: string }): string {
  return [
    `You are a kanban stage worker.`,
    `Your sub-thread ID is: ${opts.childThreadId}`,
    `Task ID: ${opts.taskId}`,
    `Stage: ${opts.stage}`,
    ``,
    `When you call \`report_stage_result\`, pass thread_id="${opts.childThreadId}" (your sub-thread ID above).`,
    `Do NOT use AGENTOS_THREAD_ID — that points at the main thread, not you.`,
  ].join('\n');
}

// ── Inlined from council/bootInstructions.ts ──────────────────────────────────

function buildCouncilBootInstructions(opts: {
  runId: string;
  memberLabel: string;
  childThreadId: string;
}): string {
  return [
    `You are participating in a council run (id=${opts.runId}) as member "${opts.memberLabel}".`,
    `Your child thread ID is: ${opts.childThreadId}`,
    '',
    'Rules:',
    '- You share a working directory with other council members. DO NOT modify any files.',
    '- You may read files, but treat the workspace as read-only for this run.',
    '- Reason about the user prompt that follows in your own reasoning style.',
    '- Do NOT write your final answer as plain text. Your only submission mechanism is the council_submit_outcome tool on the agentos-council MCP server.',
    '- When you are finished reasoning, call the council_submit_outcome tool on the agentos-council MCP server EXACTLY ONCE with:',
    `    run_id          — ${opts.runId}`,
    `    child_thread_id — ${opts.childThreadId}`,
    '    summary         — one-sentence summary of your answer',
    '    answer          — your full answer',
    '    confidence      — optional float 0..1',
    '    caveats         — optional list of strings',
    '- Do not emit any text after calling council_submit_outcome.',
  ].join('\n');
}

// ── Inlined abnormal-exit injection logic from spawnStageChildThread ──────────
//
// On abnormal exit, if the task is still assigned to the child thread, the
// parent thread receives an injection message.  This logic is extracted
// in plan 34.

function buildStageWorkerExitInjection(opts: { taskId: string; stage: string; exitCode: number | null }): string {
  return `[STAGE WORKER EXITED] task=${opts.taskId} stage=${opts.stage} exit_code=${opts.exitCode ?? 'unknown'} — worker exited without reporting a stage result.`;
}

function shouldInjectOnExit(opts: {
  assignedThreadId: string | null | undefined;
  childThreadId: string;
  projectId: string | null | undefined;
}): boolean {
  return !!(opts.projectId && opts.assignedThreadId === opts.childThreadId);
}

// ── buildStageBootInstructions ────────────────────────────────────────────────

test('stage boot: contains child thread id', () => {
  const result = buildStageBootInstructions({ childThreadId: 'child-123', taskId: 'task-456', stage: 'implementing' });
  assert.ok(result.includes('child-123'));
});

test('stage boot: contains task id', () => {
  const result = buildStageBootInstructions({ childThreadId: 'child-123', taskId: 'task-456', stage: 'implementing' });
  assert.ok(result.includes('task-456'));
});

test('stage boot: contains stage name', () => {
  const result = buildStageBootInstructions({ childThreadId: 'child-123', taskId: 'task-456', stage: 'implementing' });
  assert.ok(result.includes('implementing'));
});

test('stage boot: warns against using AGENTOS_THREAD_ID', () => {
  const result = buildStageBootInstructions({ childThreadId: 'c-1', taskId: 't-1', stage: 'refining' });
  assert.ok(result.includes('AGENTOS_THREAD_ID'));
  assert.ok(result.includes('Do NOT use'));
});

test('stage boot: instructs worker to pass sub-thread id to report_stage_result', () => {
  const result = buildStageBootInstructions({ childThreadId: 'sub-789', taskId: 't-1', stage: 'review' });
  assert.ok(result.includes('report_stage_result'));
  assert.ok(result.includes('sub-789'));
});

// ── buildCouncilBootInstructions ──────────────────────────────────────────────

test('council boot: contains run id', () => {
  const result = buildCouncilBootInstructions({ runId: 'run-abc', memberLabel: 'Claude', childThreadId: 'c-1' });
  assert.ok(result.includes('run-abc'));
});

test('council boot: contains member label', () => {
  const result = buildCouncilBootInstructions({ runId: 'run-abc', memberLabel: 'Gemini-Pro', childThreadId: 'c-1' });
  assert.ok(result.includes('Gemini-Pro'));
});

test('council boot: contains child thread id', () => {
  const result = buildCouncilBootInstructions({ runId: 'run-abc', memberLabel: 'Claude', childThreadId: 'child-XYZ' });
  assert.ok(result.includes('child-XYZ'));
});

test('council boot: prohibits file modification', () => {
  const result = buildCouncilBootInstructions({ runId: 'run-abc', memberLabel: 'Claude', childThreadId: 'c-1' });
  assert.ok(result.toLowerCase().includes('do not modify'));
});

test('council boot: requires council_submit_outcome tool call', () => {
  const result = buildCouncilBootInstructions({ runId: 'run-abc', memberLabel: 'Claude', childThreadId: 'c-1' });
  assert.ok(result.includes('council_submit_outcome'));
});

// ── abnormal exit: injection logic ────────────────────────────────────────────

test('stage exit injection: message contains task id and stage', () => {
  const msg = buildStageWorkerExitInjection({ taskId: 'task-99', stage: 'implementing', exitCode: 1 });
  assert.ok(msg.includes('task-99'));
  assert.ok(msg.includes('implementing'));
});

test('stage exit injection: includes exit code', () => {
  const msg = buildStageWorkerExitInjection({ taskId: 'task-99', stage: 'review', exitCode: 2 });
  assert.ok(msg.includes('exit_code=2'));
});

test('stage exit injection: null exit code shown as unknown', () => {
  const msg = buildStageWorkerExitInjection({ taskId: 'task-99', stage: 'review', exitCode: null });
  assert.ok(msg.includes('exit_code=unknown'));
});

test('stage exit: injects when task still assigned to child', () => {
  assert.equal(
    shouldInjectOnExit({ assignedThreadId: 'child-1', childThreadId: 'child-1', projectId: 'proj-1' }),
    true,
  );
});

test('stage exit: does NOT inject when task is no longer assigned to child', () => {
  assert.equal(
    shouldInjectOnExit({ assignedThreadId: null, childThreadId: 'child-1', projectId: 'proj-1' }),
    false,
  );
});

test('stage exit: does NOT inject when there is no project id', () => {
  assert.equal(
    shouldInjectOnExit({ assignedThreadId: 'child-1', childThreadId: 'child-1', projectId: null }),
    false,
  );
});

test('stage exit: does NOT inject when assigned to a different child', () => {
  assert.equal(
    shouldInjectOnExit({ assignedThreadId: 'other-child', childThreadId: 'child-1', projectId: 'proj-1' }),
    false,
  );
});

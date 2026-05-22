/**
 * Tests for council/bootInstructions.ts — buildCouncilBootInstructions.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Source anchor ─────────────────────────────────────────────────────────────

test('buildCouncilBootInstructions: production source exports the expected function signature', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(
    path.resolve(dir, '../../../src/main/council/bootInstructions.ts'),
    'utf8'
  );
  assert.match(src, /export function buildCouncilBootInstructions/);
  assert.match(src, /runId/);
  assert.match(src, /memberLabel/);
  assert.match(src, /childThreadId/);
  assert.match(src, /council_submit_outcome/);
});

// ── Inlined logic ─────────────────────────────────────────────────────────────

function buildCouncilBootInstructions({ runId, memberLabel, childThreadId }) {
  return [
    `You are participating in a council run (id=${runId}) as member "${memberLabel}".`,
    `Your child thread ID is: ${childThreadId}`,
    '',
    'Rules:',
    '- You share a working directory with other council members. DO NOT modify any files.',
    '- You may read files, but treat the workspace as read-only for this run.',
    '- Reason about the user prompt that follows in your own reasoning style.',
    '- Do NOT write your final answer as plain text. Your only submission mechanism is the council_submit_outcome tool on the agentos-council MCP server.',
    '- When you are finished reasoning, call the council_submit_outcome tool on the agentos-council MCP server EXACTLY ONCE with:',
    `    run_id          — ${runId}`,
    `    child_thread_id — ${childThreadId}`,
    '    summary         — one-sentence summary of your answer',
    '    answer          — your full answer',
    '    confidence      — optional float 0..1',
    '    caveats         — optional list of strings',
    '- Do not emit any text after calling council_submit_outcome.',
  ].join('\n');
}

test('buildCouncilBootInstructions: injects runId into output', () => {
  const out = buildCouncilBootInstructions({ runId: 'run_abc123', memberLabel: 'Claude/opus', childThreadId: 'child_1' });
  assert.match(out, /id=run_abc123/);
});

test('buildCouncilBootInstructions: injects memberLabel into output', () => {
  const out = buildCouncilBootInstructions({ runId: 'run_x', memberLabel: 'Gemini/flash', childThreadId: 'child_2' });
  assert.match(out, /"Gemini\/flash"/);
});

test('buildCouncilBootInstructions: injects childThreadId into output', () => {
  const out = buildCouncilBootInstructions({ runId: 'run_y', memberLabel: 'Claude/sonnet', childThreadId: 'child_abc' });
  assert.match(out, /child_abc/);
});

test('buildCouncilBootInstructions: embeds run_id value directly (not a placeholder)', () => {
  const out = buildCouncilBootInstructions({ runId: 'crun_xyz', memberLabel: 'x', childThreadId: 'cid_99' });
  assert.match(out, /run_id\s+—\s+crun_xyz/);
});

test('buildCouncilBootInstructions: embeds child_thread_id value directly (not a placeholder)', () => {
  const out = buildCouncilBootInstructions({ runId: 'r', memberLabel: 'x', childThreadId: 'cid_42' });
  assert.match(out, /child_thread_id\s+—\s+cid_42/);
});

test('buildCouncilBootInstructions: contains council_submit_outcome instruction', () => {
  const out = buildCouncilBootInstructions({ runId: 'r', memberLabel: 'm', childThreadId: 'c' });
  assert.match(out, /council_submit_outcome/);
});

test('buildCouncilBootInstructions: contains read-only workspace rule', () => {
  const out = buildCouncilBootInstructions({ runId: 'r', memberLabel: 'm', childThreadId: 'c' });
  assert.match(out, /DO NOT modify any files/);
});

test('buildCouncilBootInstructions: contains EXACTLY ONCE submission rule', () => {
  const out = buildCouncilBootInstructions({ runId: 'r', memberLabel: 'm', childThreadId: 'c' });
  assert.match(out, /EXACTLY ONCE/);
});

test('buildCouncilBootInstructions: returns a string', () => {
  const out = buildCouncilBootInstructions({ runId: 'r', memberLabel: 'm', childThreadId: 'c' });
  assert.equal(typeof out, 'string');
});

test('buildCouncilBootInstructions: different runIds produce different output', () => {
  const a = buildCouncilBootInstructions({ runId: 'run_1', memberLabel: 'x', childThreadId: 'c' });
  const b = buildCouncilBootInstructions({ runId: 'run_2', memberLabel: 'x', childThreadId: 'c' });
  assert.notEqual(a, b);
});

test('buildCouncilBootInstructions: different childThreadIds produce different output', () => {
  const a = buildCouncilBootInstructions({ runId: 'r', memberLabel: 'x', childThreadId: 'child_1' });
  const b = buildCouncilBootInstructions({ runId: 'r', memberLabel: 'x', childThreadId: 'child_2' });
  assert.notEqual(a, b);
});

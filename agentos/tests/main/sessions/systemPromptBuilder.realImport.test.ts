/**
 * Real-import tests for sessions/systemPromptBuilder.ts — buildHeadlessSystemPrompt.
 *
 * Replaces the older inlined `.mjs` mirrors (which drifted from the real module). The module's
 * only dependency is the pure `mcpUrl` helper, so it imports cleanly with no mocks and these
 * assertions run against the real prompt-routing logic.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHeadlessSystemPrompt, type HeadlessPromptInput } from '../../../src/main/sessions/systemPromptBuilder';

function baseInput(overrides: Partial<HeadlessPromptInput> = {}): HeadlessPromptInput {
  return {
    initialPayload: null,
    slackCtx: null,
    useHeadless: true,
    runOnHost: false,
    projectId: 'proj-abc',
    threadId: 'thread-xyz',
    memoryMcpPort: 51001,
    threadMcpPort: 51002,
    councilMcpPort: 51003,
    kanbanMcpPort: 51004,
    recordingsMcpPort: 51005,
    ...overrides,
  };
}

// ── MCP URL plumbing ────────────────────────────────────────────────────────────

test('MCP URLs use the ports passed in input via the docker host alias', () => {
  const result = buildHeadlessSystemPrompt(baseInput());
  assert.equal(result.memoryMcpUrl, 'http://host.docker.internal:51001/mcp');
  assert.equal(result.threadMcpUrl, 'http://host.docker.internal:51002/mcp');
  assert.equal(result.councilMcpUrl, 'http://host.docker.internal:51003/mcp');
  assert.equal(result.kanbanMcpUrl, 'http://host.docker.internal:51004/mcp');
  assert.equal(result.recordingsMcpUrl, 'http://host.docker.internal:51005/mcp');
});

test('runOnHost targets loopback instead of the docker host alias', () => {
  const result = buildHeadlessSystemPrompt(baseInput({ runOnHost: true }));
  assert.equal(result.threadMcpUrl, 'http://127.0.0.1:51002/mcp');
});

test('result no longer carries a slackMcpUrl — the agentos-slack MCP was removed', () => {
  const result = buildHeadlessSystemPrompt(baseInput());
  assert.ok(!('slackMcpUrl' in result));
});

test('extraEnv always includes AGENTOS_PROJECT_ID and AGENTOS_THREAD_ID', () => {
  const result = buildHeadlessSystemPrompt(baseInput());
  assert.equal(result.extraEnv?.AGENTOS_PROJECT_ID, 'proj-abc');
  assert.equal(result.extraEnv?.AGENTOS_THREAD_ID, 'thread-xyz');
});

// ── Plan mode ───────────────────────────────────────────────────────────────────

test('non-headless, no messaging ctx — prompt includes the plan mode section', () => {
  const result = buildHeadlessSystemPrompt(baseInput({ initialPayload: 'base', useHeadless: false }));
  assert.ok(result.effectiveSystemPrompt?.includes('Plan Before Coding'));
});

test('headless threads skip plan mode (approval flows through ask_clarification in the Thread view)', () => {
  const result = buildHeadlessSystemPrompt(baseInput({ initialPayload: 'base' }));
  assert.ok(!result.effectiveSystemPrompt?.includes('Plan Before Coding'));
});

test('pure in-app headless thread (no slackCtx, no role) — posts via agentos-thread, neutral wording', () => {
  const result = buildHeadlessSystemPrompt(baseInput());
  const prompt = result.effectiveSystemPrompt ?? '';
  assert.ok(prompt.includes("'agentos-thread' MCP server"));
  assert.ok(prompt.includes('post_update'));
  assert.ok(prompt.includes('ask_clarification(thread_id'));
  assert.ok(!prompt.includes('Slack')); // neutral wording — not a Slack-bound thread
});

test('slack ctx present — plan mode section is omitted (no way to approve from Slack)', () => {
  const result = buildHeadlessSystemPrompt(
    baseInput({ initialPayload: 'base', slackCtx: { channelId: 'C1', threadTs: '123.456' } })
  );
  assert.ok(!result.effectiveSystemPrompt?.includes('Plan Before Coding'));
});

test('effectiveSystemPrompt is non-null even with no payload (gets memory/thread prompts)', () => {
  assert.notEqual(buildHeadlessSystemPrompt(baseInput()).effectiveSystemPrompt, null);
});

// ── Inbound (threadTs present, not a task-main worker) ───────────────────────────

test('inbound: posts via agentos-thread with ask_clarification, sets SLACK env', () => {
  const result = buildHeadlessSystemPrompt(baseInput({ slackCtx: { channelId: 'C1', threadTs: '111.222' } }));
  const prompt = result.effectiveSystemPrompt ?? '';
  assert.ok(prompt.includes("'agentos-thread' MCP server"));
  assert.ok(prompt.includes('ask_clarification(thread_id'));
  assert.ok(!prompt.includes('agentos-slack'));
  assert.equal(result.extraEnv?.SLACK_CHANNEL_ID, 'C1');
  assert.equal(result.extraEnv?.SLACK_THREAD_TS, '111.222');
});

// ── Kanban task-main (threadTs present, agentRole task-main) ─────────────────────

test('kanban task-main: posts via agentos-thread, autonomous (no ask_clarification)', () => {
  const result = buildHeadlessSystemPrompt(
    baseInput({ slackCtx: { channelId: 'C1', threadTs: '111.222' }, agentRole: 'task-main' })
  );
  const prompt = result.effectiveSystemPrompt ?? '';
  assert.ok(prompt.includes('kanban task'));
  assert.ok(prompt.includes("'agentos-thread' MCP server"));
  assert.ok(!prompt.includes('ask_clarification(thread_id'));
});

// ── Automation (channel-scoped: threadTs null) ───────────────────────────────────

test('automation: routes through agentos-thread, not agentos-slack', () => {
  const result = buildHeadlessSystemPrompt(baseInput({ slackCtx: { channelId: 'C-AUTO', threadTs: null } }));
  const prompt = result.effectiveSystemPrompt ?? '';
  assert.ok(prompt.includes('automated task'));
  assert.ok(prompt.includes("'agentos-thread' MCP server"));
  assert.ok(prompt.includes('post_update'));
  assert.ok(!prompt.includes('agentos-slack'));
  assert.ok(!prompt.includes('ask_clarification(thread_id'));
});

test('automation: channel-scoped binding sets no SLACK_THREAD_TS', () => {
  const result = buildHeadlessSystemPrompt(baseInput({ slackCtx: { channelId: 'C-AUTO', threadTs: null } }));
  assert.equal(result.extraEnv?.SLACK_THREAD_TS, undefined);
});

// ── useHeadless gate ─────────────────────────────────────────────────────────────

test('useHeadless=false — no messaging prompt block is appended', () => {
  const result = buildHeadlessSystemPrompt(
    baseInput({ useHeadless: false, slackCtx: { channelId: 'C1', threadTs: '111.222' } })
  );
  assert.ok(!result.effectiveSystemPrompt?.includes("'agentos-thread' MCP server\nPost all replies"));
  assert.equal(result.extraEnv?.SLACK_THREAD_TS, undefined);
});

// ── taskCtx ──────────────────────────────────────────────────────────────────────

test('taskCtx — prompt includes id, title, status (no Type field)', () => {
  const result = buildHeadlessSystemPrompt(
    baseInput({ taskCtx: { id: 'task-1', title: 'Fix the bug', status: 'in_progress', description: '' } })
  );
  const prompt = result.effectiveSystemPrompt ?? '';
  assert.ok(prompt.includes('Your Assigned Task'));
  assert.ok(prompt.includes('task-1'));
  assert.ok(prompt.includes('Fix the bug'));
  assert.ok(prompt.includes('in_progress'));
  assert.ok(!prompt.includes('**Type:**'));
});

test('taskCtx — description line omitted when empty', () => {
  const result = buildHeadlessSystemPrompt(
    baseInput({ taskCtx: { id: 't1', title: 'T', status: 'todo', description: '' } })
  );
  assert.ok(!result.effectiveSystemPrompt?.includes('**Description:**'));
});

test('taskCtx null — no task section', () => {
  assert.ok(!buildHeadlessSystemPrompt(baseInput()).effectiveSystemPrompt?.includes('Your Assigned Task'));
});

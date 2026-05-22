/**
 * Tests for sessions/systemPromptBuilder.ts — buildHeadlessSystemPrompt.
 * All logic is inlined; only port constants are fixed values (3459, 3460).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from systemPromptBuilder.ts ──────────────────────────────────────

function buildHeadlessSystemPrompt(input) {
  const { initialPayload, slackCtx, useHeadless, projectId, threadId, slackMcpPort, memoryMcpPort, threadMcpPort, taskCtx } =
    input;

  let effectiveSystemPrompt = initialPayload;
  let extraEnv;

  const memoryMcpUrl = `http://host.docker.internal:${memoryMcpPort}/mcp`;
  const threadMcpUrl = `http://host.docker.internal:${threadMcpPort}/mcp`;
  extraEnv = { ...(extraEnv ?? {}), AGENTOS_PROJECT_ID: projectId, AGENTOS_THREAD_ID: threadId };

  const planModePrompt =
    `\n## Plan Before Coding\n` +
    `For any coding or implementation task:\n` +
    `1. Use the EnterPlanMode tool to switch into plan mode.\n` +
    `2. Present your plan — explain what you intend to change and why.\n` +
    `3. Wait for the user to explicitly confirm the approach before writing any code.\n` +
    `\nDo not skip plan mode for tasks that involve writing or modifying code.\n`;
  const threadPrompt =
    `\n## Chat Settings (agentos-thread MCP)\n` +
    `You can modify settings for the current thread using the 'agentos-thread' MCP server.\n\n` +
    `Available tools:\n` +
    `- set_autopilot(thread_id, enabled) — enable or disable autopilot for this thread. Use AGENTOS_THREAD_ID=${threadId} as thread_id.\n`;
  const memoryPrompt =
    `\n## Memory Tools (agentos-memory MCP)\n` +
    `You have persistent memory for this project. Use it proactively.\n\n` +
    `**Always do this at the start of any non-trivial task:** call memory_search with a short query describing what you're about to work on. This surfaces prior decisions, notes, and context from earlier sessions.\n\n` +
    `Use AGENTOS_PROJECT_ID=${projectId} as project_id and AGENTOS_THREAD_ID=${threadId} as thread_id in every memory tool call.\n\n` +
    `Available tools:\n` +
    `- memory_search(query, project_id, thread_id, source?, max_results?, min_score?) — search saved knowledge\n` +
    `- memory_get(entry_id?, path?, project_id, thread_id, from?, lines?) — read a specific file or chunk\n` +
    `- memory_save(path, content, mode?, project_id, thread_id) — persist knowledge (use memory/TOPIC.md paths)\n` +
    `- memory_save_chunk(summary, text, project_id, thread_id) — save a distilled session chunk directly to the search index with embeddings. Use for decisions, bugs fixed, code produced, user preferences. Returns chunk_id.\n` +
    `- memory_link(entities?, edges?, chunk_id?, project_id, thread_id) — assert entities (files, symbols, issues, decisions) and relationships (fixes, modifies, depends_on, related_to) into the knowledge graph. Call after memory_save_chunk with the returned chunk_id.\n` +
    `- memory_status(project_id, thread_id, force_reindex?) — check what's indexed\n` +
    `- memory_delete(entry_id, project_id, thread_id) — delete a chunk and remove it from the search index and embeddings.\n` +
    `- /save-session-chunk — invoke at the end of any turn where you did significant work. Guides you through what to distill, save, and link.\n\n` +
    `**Save proactively:** when you learn something durable — an architecture decision, a tricky bug fix, a deploy step, a convention — write it with memory_save. Don't leave it only in the chat transcript.\n` +
    `Good save targets: decisions made, environment quirks found, commands that worked, debugging outcomes.\n` +
    `**After completing significant work in a turn**, invoke /save-session-chunk to distill and persist what happened.\n\n` +
    `**Memory hygiene:** keep memory relevant — delete or update when things change.\n` +
    `- At session start, if surfaced memories look stale or wrong — delete/update before using them.\n` +
    `- After a PR merges, clean up related project memories.\n` +
    `- Superseded decisions: overwrite in place (memory_save with mode: overwrite), don't accumulate duplicates.\n` +
    `- Completed work: delete project memories ~2 weeks after shipping.\n` +
    `- Keep long-term: arch decisions, env quirks, user preferences/feedback.\n` +
    `- Use memory_delete(entry_id) to remove stale or wrong chunks — run memory_search first to find the id.\n`;

  // Skip plan mode prompt when a messaging integration context is present.
  const hasMessagingCtx = Boolean(slackCtx);
  const parts = [];
  if (effectiveSystemPrompt) parts.push(effectiveSystemPrompt);
  if (!hasMessagingCtx) parts.push(planModePrompt);
  parts.push(memoryPrompt, threadPrompt);
  effectiveSystemPrompt = parts.join('\n');

  if (taskCtx) {
    const taskPrompt =
      `\n## Your Assigned Task\n` +
      `- **ID:** ${taskCtx.id}\n` +
      `- **Title:** ${taskCtx.title}\n` +
      `- **Type:** ${taskCtx.taskType}\n` +
      `- **Status:** ${taskCtx.status}\n` +
      (taskCtx.description ? `- **Description:** ${taskCtx.description}\n` : '');
    effectiveSystemPrompt = effectiveSystemPrompt ? `${effectiveSystemPrompt}\n${taskPrompt}` : taskPrompt;
  }

  const slackFormattingGuide =
    `\nSlack formatting (mrkdwn — NOT standard Markdown):\n` +
    `- Bold: *text* (single asterisks, not double)\n` +
    `- Italic: _text_\n` +
    `- Code: \`code\` or \`\`\`block\`\`\`\n` +
    `- Bullet: start line with • or -\n` +
    `- Do NOT use ## headers, **double asterisks**, or --- separators — they appear as raw text.`;

  let slackMcpUrl = null;
  if (slackCtx && useHeadless) {
    slackMcpUrl = `http://host.docker.internal:${slackMcpPort}/mcp`;
    let slackPrompt;
    if (slackCtx.threadTs) {
      slackPrompt =
        `\nThis task was submitted via Slack (SLACK_CHANNEL_ID=${slackCtx.channelId}, SLACK_THREAD_TS=${slackCtx.threadTs}).\n` +
        `Autopilot is already active for this thread — do not call set_autopilot.\n` +
        `You have access to the 'agentos-slack' MCP server with two tools:\n` +
        `- post_update(channel_id, thread_ts, message): post a plan/todos at the start, progress updates during work, and your final result when done.\n` +
        `- ask_clarification(channel_id, thread_ts, questions): post questions to the Slack thread and wait for the user's reply.\n` +
        `Always pass the value of SLACK_CHANNEL_ID as channel_id and SLACK_THREAD_TS as thread_ts.\n` +
        `\nWorkflow:\n` +
        `1. If the request is ambiguous or missing information needed to form a plan, call ask_clarification first and stop — the user will reply in Slack.\n` +
        `2. For coding or implementation tasks where you can form a plan: call post_update with your plan first, then call ask_clarification to get explicit approval before writing or modifying any code. Only proceed after the user confirms.\n` +
        `3. For non-coding tasks (research, analysis, answering questions): call post_update with a brief plan, proceed, then call post_update with your final result.\n` +
        `4. For conversational messages (greetings, questions, short answers): call post_update once with your response.\n` +
        `5. NEVER respond with plain text output — ALL responses must go through post_update or ask_clarification.\n` +
        `6. For skill-based or multi-step tasks: delegate the work to a subagent via the Agent tool, then call post_update with the returned findings.\n` +
        slackFormattingGuide +
        `\nOnly MCP tool calls appear in the Slack thread — your stdout is not forwarded.`;
      extraEnv = { SLACK_CHANNEL_ID: slackCtx.channelId, SLACK_THREAD_TS: slackCtx.threadTs };
    } else {
      slackPrompt =
        `\nThis is an automated task. When you have finished, post a concise summary to Slack using the 'agentos-slack' MCP server.\n` +
        `SLACK_CHANNEL_ID=${slackCtx.channelId}\n` +
        `Use this single tool at the end:\n` +
        `- post_update(channel_id, message): post your summary as a new message to the channel.\n` +
        `Pass SLACK_CHANNEL_ID as channel_id. Do not pass thread_ts — this should be a new top-level post.\n` +
        `Post only once when fully done. Do not post intermediate updates.\n` +
        slackFormattingGuide;
      extraEnv = { SLACK_CHANNEL_ID: slackCtx.channelId };
    }
    effectiveSystemPrompt = effectiveSystemPrompt ? `${effectiveSystemPrompt}\n${slackPrompt}` : slackPrompt;
  }

  return {
    effectiveSystemPrompt: effectiveSystemPrompt ?? null,
    extraEnv,
    memoryMcpUrl,
    threadMcpUrl,
    slackMcpUrl,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function baseInput(overrides = {}) {
  return {
    initialPayload: null,
    slackCtx: null,
    useHeadless: true,
    projectId: 'proj-abc',
    threadId: 'thread-xyz',
    slackMcpPort: 3461,
    memoryMcpPort: 51001,
    threadMcpPort: 51002,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('MCP URLs use the ports passed in input', () => {
  const base = baseInput();
  const result = buildHeadlessSystemPrompt(base);
  assert.equal(result.memoryMcpUrl, `http://host.docker.internal:${base.memoryMcpPort}/mcp`);
  assert.equal(result.threadMcpUrl, `http://host.docker.internal:${base.threadMcpPort}/mcp`);
});

test('extraEnv always includes AGENTOS_PROJECT_ID and AGENTOS_THREAD_ID', () => {
  const result = buildHeadlessSystemPrompt(baseInput());
  assert.equal(result.extraEnv?.AGENTOS_PROJECT_ID, 'proj-abc');
  assert.equal(result.extraEnv?.AGENTOS_THREAD_ID, 'thread-xyz');
});

test('no messaging ctx — prompt includes plan mode section', () => {
  const result = buildHeadlessSystemPrompt(baseInput({ initialPayload: 'base' }));
  assert.ok(result.effectiveSystemPrompt?.includes('Plan Before Coding'));
});

test('slack ctx present — plan mode section is omitted', () => {
  const result = buildHeadlessSystemPrompt(baseInput({
    initialPayload: 'base',
    slackCtx: { channelId: 'C1', threadTs: '12345.000001' },
  }));
  assert.ok(!result.effectiveSystemPrompt?.includes('Plan Before Coding'));
});

test('no initialPayload, no ctx — prompt is plan+memory+thread', () => {
  const result = buildHeadlessSystemPrompt(baseInput());
  assert.ok(result.effectiveSystemPrompt?.includes('Plan Before Coding'));
  assert.ok(result.effectiveSystemPrompt?.includes('agentos-memory MCP'));
  assert.ok(result.effectiveSystemPrompt?.includes('agentos-thread MCP'));
});

test('slackMcpUrl is null when useHeadless=false', () => {
  const result = buildHeadlessSystemPrompt(baseInput({
    useHeadless: false,
    slackCtx: { channelId: 'C1', threadTs: '12345.000001' },
  }));
  assert.equal(result.slackMcpUrl, null);
});

test('slackMcpUrl set when useHeadless=true and slackCtx provided', () => {
  const result = buildHeadlessSystemPrompt(baseInput({
    slackCtx: { channelId: 'C1', threadTs: '12345.000001' },
    slackMcpPort: 3461,
  }));
  assert.equal(result.slackMcpUrl, 'http://host.docker.internal:3461/mcp');
});

test('slack inbound thread — extraEnv includes SLACK_THREAD_TS', () => {
  const result = buildHeadlessSystemPrompt(baseInput({
    slackCtx: { channelId: 'C1', threadTs: '12345.000001' },
  }));
  assert.equal(result.extraEnv?.SLACK_CHANNEL_ID, 'C1');
  assert.equal(result.extraEnv?.SLACK_THREAD_TS, '12345.000001');
});

test('slack automation (no threadTs) — extraEnv has no SLACK_THREAD_TS', () => {
  const result = buildHeadlessSystemPrompt(baseInput({
    slackCtx: { channelId: 'C1', threadTs: null },
  }));
  assert.equal(result.extraEnv?.SLACK_CHANNEL_ID, 'C1');
  assert.equal(result.extraEnv?.SLACK_THREAD_TS, undefined);
});

test('projectId and threadId are interpolated into memory prompt', () => {
  const result = buildHeadlessSystemPrompt(baseInput({ projectId: 'p-1', threadId: 't-2' }));
  assert.ok(result.effectiveSystemPrompt?.includes('AGENTOS_PROJECT_ID=p-1'));
  assert.ok(result.effectiveSystemPrompt?.includes('AGENTOS_THREAD_ID=t-2'));
});

test('effectiveSystemPrompt is always non-null (at minimum gets plan+memory+thread prompts)', () => {
  // With no initialPayload and no ctx, still gets plan+memory+thread prompts.
  const result = buildHeadlessSystemPrompt(baseInput());
  assert.notEqual(result.effectiveSystemPrompt, null);
});

// ── taskCtx ───────────────────────────────────────────────────────────────────

test('taskCtx — prompt includes task id, title, type, status', () => {
  const result = buildHeadlessSystemPrompt(baseInput({
    taskCtx: { id: 'task-1', title: 'Fix the bug', taskType: 'bug', status: 'in_progress', description: '' },
  }));
  assert.ok(result.effectiveSystemPrompt?.includes('task-1'));
  assert.ok(result.effectiveSystemPrompt?.includes('Fix the bug'));
  assert.ok(result.effectiveSystemPrompt?.includes('bug'));
  assert.ok(result.effectiveSystemPrompt?.includes('in_progress'));
});

test('taskCtx — description included when non-empty', () => {
  const result = buildHeadlessSystemPrompt(baseInput({
    taskCtx: { id: 't1', title: 'T', taskType: 'feature', status: 'todo', description: 'Do something useful' },
  }));
  assert.ok(result.effectiveSystemPrompt?.includes('Do something useful'));
});

test('taskCtx — description line omitted when empty', () => {
  const result = buildHeadlessSystemPrompt(baseInput({
    taskCtx: { id: 't1', title: 'T', taskType: 'feature', status: 'todo', description: '' },
  }));
  assert.ok(!result.effectiveSystemPrompt?.includes('**Description:**'));
});

test('taskCtx null — no task section in prompt', () => {
  const result = buildHeadlessSystemPrompt(baseInput({ taskCtx: null }));
  assert.ok(!result.effectiveSystemPrompt?.includes('Your Assigned Task'));
});

test('taskCtx present with slack ctx — both sections appear in prompt', () => {
  const result = buildHeadlessSystemPrompt(baseInput({
    slackCtx: { channelId: 'C1', threadTs: '123.456' },
    taskCtx: { id: 'task-99', title: 'Ship it', taskType: 'feature', status: 'todo', description: '' },
  }));
  assert.ok(result.effectiveSystemPrompt?.includes('task-99'));
  assert.ok(result.effectiveSystemPrompt?.includes('SLACK_CHANNEL_ID=C1'));
});

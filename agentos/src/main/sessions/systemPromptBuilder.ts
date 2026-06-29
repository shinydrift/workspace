import { mcpUrl } from '../mcp/mcpHost';

export type HeadlessPromptInput = {
  initialPayload: string | null;
  slackCtx: { channelId: string; threadTs: string | null } | null;
  useHeadless: boolean;
  /** When true, MCP URLs target loopback (127.0.0.1) instead of the Docker host alias. */
  runOnHost: boolean;
  projectId: string;
  threadId: string;
  slackMcpPort: number;
  memoryMcpPort: number;
  threadMcpPort: number;
  councilMcpPort: number;
  kanbanMcpPort: number;
  recordingsMcpPort: number;
  taskCtx?: { id: string; title: string; description: string; status: string } | null;
  agentRole?: string | null;
};

export type HeadlessPromptResult = {
  effectiveSystemPrompt: string | null;
  extraEnv: Record<string, string> | undefined;
  memoryMcpUrl: string | null;
  threadMcpUrl: string | null;
  councilMcpUrl: string | null;
  slackMcpUrl: string | null;
  kanbanMcpUrl: string | null;
  recordingsMcpUrl: string | null;
};

export function buildHeadlessSystemPrompt(input: HeadlessPromptInput): HeadlessPromptResult {
  const {
    initialPayload,
    slackCtx,
    useHeadless,
    runOnHost,
    projectId,
    threadId,
    slackMcpPort,
    memoryMcpPort,
    threadMcpPort,
    councilMcpPort,
    kanbanMcpPort,
    recordingsMcpPort,
    taskCtx,
    agentRole,
  } = input;

  let effectiveSystemPrompt = initialPayload;
  let extraEnv: Record<string, string> | undefined;

  const memoryMcpUrl = mcpUrl(memoryMcpPort, runOnHost);
  const threadMcpUrl = mcpUrl(threadMcpPort, runOnHost);
  const councilMcpUrl = mcpUrl(councilMcpPort, runOnHost);
  const kanbanMcpUrl = mcpUrl(kanbanMcpPort, runOnHost);
  const recordingsMcpUrl = mcpUrl(recordingsMcpPort, runOnHost);
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
    `**Always do this at the start of any non-trivial task:** invoke the /memory-search skill with your query. Do NOT call memory_search or code_search directly from the main agent — always route through /memory-search. This keeps main context clean and ensures searches run in parallel in an isolated subagent.\n` +
    `Good queries name the entity or component plus the action: "AuthService token validation" not "auth". Call /memory-search again mid-task if you hit something unexpected.\n\n` +
    `Use AGENTOS_PROJECT_ID=${projectId} as project_id and AGENTOS_THREAD_ID=${threadId} as thread_id in every memory tool call.\n\n` +
    `Available tools:\n` +
    `- memory_get(entry_id?, path?, project_id, thread_id, from?, lines?) — read a specific file or chunk\n` +
    `- memory_save(path, content, mode?, project_id, thread_id) — persist knowledge (use memory/TOPIC.md paths)\n` +
    `- memory_save_chunk(summary, text, project_id, thread_id) — save a distilled session chunk directly to the search index with embeddings. Use for decisions, bugs fixed, code produced, user preferences. Returns chunk_id.\n` +
    `- memory_link(entities?, edges?, chunk_id?, project_id, thread_id) — assert entities (files, symbols, issues, decisions) and relationships (fixes, modifies, depends_on, related_to) into the knowledge graph. Call after memory_save_chunk with the returned chunk_id.\n` +
    `- memory_add_observation(entity_name, entity_type, observation, source_chunk_id?, project_id, thread_id) — attach a single factual sentence to an entity without saving a full chunk. Use mid-task when you learn a concrete fact about a specific file or symbol.\n` +
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
  // Skip plan mode prompt when a messaging integration context is present —
  // those integrations handle plan sharing via their own MCP tools (post_update, etc.)
  // and EnterPlanMode would leave the thread waiting with no way to approve from Slack.
  // Skip plan mode for messaging integrations (no way to approve via Slack) and for stage workers
  // (fully autonomous — EnterPlanMode would leave the worker waiting with no one to respond).
  const skipPlanMode = Boolean(slackCtx) || agentRole?.startsWith('stage-');
  const parts: string[] = [];
  if (effectiveSystemPrompt) parts.push(effectiveSystemPrompt);
  if (!skipPlanMode) parts.push(planModePrompt);
  const councilPrompt =
    `\n## Council (agentos-council MCP)\n` +
    `You can run a council of multiple LLM provider/model combinations against a prompt and synthesize their answers.\n` +
    `When the user asks to "run this by the council", "ask the council", or wants a second opinion from other models, use the \`council-review\` skill.\n\n` +
    `Available tools:\n` +
    `- council_list_configs() — list stored council configurations\n` +
    `- council_dispatch(config_id, parent_thread_id, prompt) — spawn one child sub-thread per member; returns runId immediately. Use AGENTOS_THREAD_ID=${threadId} as parent_thread_id.\n` +
    `- council_read_outcomes(run_id) — fetch member outcomes; call this once when prompted to synthesize, not before.\n\n` +
    `Flow: dispatch → stop immediately. When all members finish, the app appends a synthesis message to this thread. At that point call council_read_outcomes once to get the outcomes, then write your synthesis. Do not poll or await after dispatch.\n`;
  const recordingsPrompt =
    `\n## Recordings (agentos-recordings MCP)\n` +
    `Access meeting recording transcripts and metadata.\n\n` +
    `Available tools:\n` +
    `- get_recording_meta(recording_id) — duration_seconds, created_at, thread_id, file paths\n` +
    `- get_transcript(recording_id) — raw transcript text\n`;
  parts.push(memoryPrompt, threadPrompt, councilPrompt, recordingsPrompt);
  effectiveSystemPrompt = parts.join('\n');

  if (taskCtx) {
    const taskPrompt =
      `\n## Your Assigned Task\n` +
      `- **ID:** ${taskCtx.id}\n` +
      `- **Title:** ${taskCtx.title}\n` +
      `- **Status:** ${taskCtx.status}\n` +
      (taskCtx.description ? `- **Description:** ${taskCtx.description}\n` : '') +
      // Stage workers stop after reporting; the main orchestrator must keep driving through all stages.
      (agentRole !== 'task-main'
        ? `\nWhen you have completed your work and moved the task, your job is done — stop. The kanban pipeline will handle what happens next.`
        : '');
    effectiveSystemPrompt = effectiveSystemPrompt ? `${effectiveSystemPrompt}\n${taskPrompt}` : taskPrompt;
  }

  const slackFormattingGuide =
    `\nSlack formatting (mrkdwn — NOT standard Markdown):\n` +
    `- Bold: *text* (single asterisks, not double)\n` +
    `- Italic: _text_\n` +
    `- Code: \`code\` or \`\`\`block\`\`\`\n` +
    `- Bullet: start line with • or -\n` +
    `- Do NOT use ## headers, **double asterisks**, or --- separators — they appear as raw text.`;

  let slackMcpUrl: string | null = null;
  if (slackCtx && useHeadless) {
    let slackPrompt: string;
    if (slackCtx.threadTs && agentRole === 'task-main') {
      // Kanban main thread: post autonomous progress updates to the thread, no approval gate.
      slackPrompt =
        `\nThis kanban task was created from Slack and mirrors to channel ${slackCtx.channelId}.\n` +
        `Post progress to the current thread via the 'agentos-thread' MCP server — posts appear in the in-app ` +
        `Thread view (the primary surface) and are echoed to Slack when connected:\n` +
        `- post_update(thread_id, message): post progress updates.\n` +
        `Always pass AGENTOS_THREAD_ID as thread_id.\n` +
        `\nPost a brief update at these moments only:\n` +
        `1. When the task starts (one line: task title + first stage).\n` +
        `2. When each stage completes (one line: stage name + outcome).\n` +
        `3. When the task finishes (brief summary of what was done).\n` +
        `Do NOT ask for approval or use ask_clarification — proceed autonomously.\n` +
        slackFormattingGuide +
        `\nOnly posts you make via these tools appear in the Thread view and Slack — your stdout is not forwarded.`;
      extraEnv = { ...(extraEnv ?? {}), SLACK_CHANNEL_ID: slackCtx.channelId, SLACK_THREAD_TS: slackCtx.threadTs };
    } else if (slackCtx.threadTs) {
      // Inbound: post replies to the current thread; Slack mirrors them when connected.
      slackPrompt =
        `\nThis task was submitted via Slack and mirrors to channel ${slackCtx.channelId}.\n` +
        `Autopilot is already active for this thread — do not call set_autopilot.\n` +
        `Post all replies to the current thread via the 'agentos-thread' MCP server. They appear in the in-app ` +
        `Thread view (the primary conversation surface) and are echoed to Slack when connected:\n` +
        `- post_update(thread_id, message): post a plan/todos at the start, progress updates during work, and your final result when done.\n` +
        `- ask_clarification(thread_id, questions): post questions and wait for the user's reply. Phrase questions as plain natural-language text (a numbered list for multiple) — never pass raw JSON or structured field blobs.\n` +
        `- upload_file(thread_id, file_path, filename?, initial_comment?): attach a file. file_path MUST be an absolute path under /workspace/.agentos/uploads/ — write outbound files there (same folder inbound attachments land in). Paths outside that folder are rejected.\n` +
        `Always pass the value of AGENTOS_THREAD_ID as thread_id.\n` +
        `\nWorkflow:\n` +
        `1. If the request is ambiguous or missing information needed to form a plan, call ask_clarification first and stop — the user will reply.\n` +
        `2. For coding or implementation tasks where you can form a plan: call post_update with your plan first, then call ask_clarification to get explicit approval before writing or modifying any code. Only proceed after the user confirms.\n` +
        `3. For non-coding tasks (research, analysis, answering questions): call post_update with a brief plan, proceed, then call post_update with your final result.\n` +
        `4. For conversational messages (greetings, questions, short answers): call post_update once with your response.\n` +
        `5. NEVER respond with plain text output — ALL responses must go through post_update or ask_clarification.\n` +
        `6. For skill-based or multi-step tasks: delegate the work to a subagent via the Agent tool, then call post_update with the returned findings.\n` +
        slackFormattingGuide +
        `\nOnly posts you make via these tools appear in the Thread view and Slack — your stdout is not forwarded.`;
      extraEnv = { ...(extraEnv ?? {}), SLACK_CHANNEL_ID: slackCtx.channelId, SLACK_THREAD_TS: slackCtx.threadTs };
    } else {
      // Automation: post a single summary to the channel as a new top-level message when done.
      // This top-level (no-thread) post has no thread binding to echo to, so it keeps using the
      // Slack MCP server directly.
      slackMcpUrl = mcpUrl(slackMcpPort, runOnHost);
      slackPrompt =
        `\nThis is an automated task. When you have finished, post a concise summary to Slack using the 'agentos-slack' MCP server.\n` +
        `SLACK_CHANNEL_ID=${slackCtx.channelId}\n` +
        `Use this single tool at the end:\n` +
        `- post_update(channel_id, message): post your summary as a new message to the channel.\n` +
        `Pass SLACK_CHANNEL_ID as channel_id. Do not pass thread_ts — this should be a new top-level post.\n` +
        `Post only once when fully done. Do not post intermediate updates.\n` +
        slackFormattingGuide;
      extraEnv = { ...(extraEnv ?? {}), SLACK_CHANNEL_ID: slackCtx.channelId };
    }
    effectiveSystemPrompt = effectiveSystemPrompt ? `${effectiveSystemPrompt}\n${slackPrompt}` : slackPrompt;
  }

  return {
    effectiveSystemPrompt: effectiveSystemPrompt ?? null,
    extraEnv,
    memoryMcpUrl,
    threadMcpUrl,
    councilMcpUrl,
    slackMcpUrl,
    kanbanMcpUrl,
    recordingsMcpUrl,
  };
}

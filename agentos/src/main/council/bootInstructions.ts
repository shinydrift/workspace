// Text injected into a council sub-thread on its first turn. Tells the agent
// the rules of the council protocol: read-only workspace, single MCP submission.
export function buildCouncilBootInstructions(opts: {
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

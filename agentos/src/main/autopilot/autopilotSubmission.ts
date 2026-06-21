export type AutopilotAction =
  | { action: 'send_message'; message: string; reason: string }
  | { action: 'stop'; reason: string };

/**
 * Build a validated AutopilotAction from raw tool arguments.
 * Throws on a send_message with no content; defaults a missing reason.
 */
export function buildAutopilotDecision(
  action: 'send_message' | 'stop',
  message: string | undefined,
  reason: string | undefined
): AutopilotAction {
  const trimmedReason = reason?.trim() || 'No reason provided.';
  if (action === 'send_message') {
    const trimmedMessage = message?.trim() ?? '';
    if (!trimmedMessage) throw new Error('action=send_message requires a non-empty message.');
    return { action: 'send_message', message: trimmedMessage, reason: trimmedReason };
  }
  return { action: 'stop', reason: trimmedReason };
}

/**
 * Bridges the planner's MCP tool call back to the awaiting adapter.
 *
 * The planner no longer prints JSON to stdout — it calls the `submit_autopilot_decision`
 * MCP tool, whose handler records the decision here. The adapter opens a slot before
 * launching the planner (receiving a single-use token), and reads the decision once the
 * process exits.
 *
 * Submission is bound to that per-run token, not to a caller-supplied thread id: a planner
 * only knows its own token, so it cannot write into another thread's open slot even though
 * all planners share one MCP server and bearer token.
 */
class AutopilotSubmissionRegistry {
  private byThread = new Map<
    string,
    { token: string; transcript: string; fetched: boolean; action: AutopilotAction | null }
  >();
  private tokenToThread = new Map<string, string>();

  /**
   * Open a submission slot before launching the planner, bound to the given single-use token.
   * The prepared transcript is stashed here so the planner can fetch it via the get_transcript
   * tool (keyed by token) instead of receiving it inlined in the prompt.
   */
  open(threadId: string, token: string, transcript: string): void {
    this.close(threadId); // clear any stale slot for this thread
    this.byThread.set(threadId, { token, transcript, fetched: false, action: null });
    this.tokenToThread.set(token, threadId);
  }

  /** True while a planner submission is awaited for this thread. */
  isOpen(threadId: string): boolean {
    return this.byThread.has(threadId);
  }

  /**
   * Read the prepared transcript bound to a run token, or null if the token is unknown.
   * Marks the slot as fetched so submit() can reject a send_message that never read the transcript.
   */
  getTranscript(token: string): string | null {
    const threadId = this.tokenToThread.get(token);
    if (threadId === undefined) return null;
    const slot = this.byThread.get(threadId);
    if (!slot) return null;
    slot.fetched = true;
    return slot.transcript;
  }

  /** True if get_transcript has been called for this token's slot. */
  wasTranscriptFetched(token: string): boolean {
    const threadId = this.tokenToThread.get(token);
    if (threadId === undefined) return false;
    return this.byThread.get(threadId)?.fetched ?? false;
  }

  /** Record the planner's decision against its run token. Returns false if the token is unknown. */
  submit(token: string, action: AutopilotAction): boolean {
    const threadId = this.tokenToThread.get(token);
    if (threadId === undefined) return false;
    const slot = this.byThread.get(threadId);
    if (!slot) return false;
    slot.action = action;
    return true;
  }

  /** Read the recorded decision (if any) without closing the slot. */
  peek(threadId: string): AutopilotAction | null {
    return this.byThread.get(threadId)?.action ?? null;
  }

  /** Close the slot once the planner run is finished. */
  close(threadId: string): void {
    const slot = this.byThread.get(threadId);
    if (slot) this.tokenToThread.delete(slot.token);
    this.byThread.delete(threadId);
  }
}

export const autopilotSubmissionRegistry = new AutopilotSubmissionRegistry();

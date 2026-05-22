export function extractCodexTokenUsage(events: Array<Record<string, unknown>>) {
  let model: string | undefined;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let found = false;

  for (const e of events) {
    if (typeof e.model === 'string' && e.model.trim()) model = e.model;
    const type = typeof e.type === 'string' ? e.type.toLowerCase() : '';
    if (type !== 'turn.completed' && type !== 'thread.completed') continue;
    const u = e.usage;
    if (!u || typeof u !== 'object') continue;
    const usage = u as Record<string, unknown>;
    const inputTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
    const outputTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
    if (inputTokens === 0 && outputTokens === 0) continue;
    totalInput += inputTokens;
    totalOutput += outputTokens;
    found = true;
    // OpenAI reports cached tokens under input_tokens_details.cached_tokens or usage.cached_tokens
    const details = usage.input_tokens_details;
    if (details && typeof details === 'object') {
      const d = details as Record<string, unknown>;
      if (typeof d.cached_tokens === 'number') totalCacheRead += d.cached_tokens;
    } else if (typeof usage.cached_tokens === 'number') {
      totalCacheRead += usage.cached_tokens;
    }
  }

  if (!found) return undefined;
  return { inputTokens: totalInput, outputTokens: totalOutput, cacheReadTokens: totalCacheRead, model };
}

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
    const inputTokens = firstNumber(usage, ['input_tokens', 'prompt_tokens']);
    const outputTokens = firstNumber(usage, ['output_tokens', 'completion_tokens']);
    if (inputTokens === 0 && outputTokens === 0) continue;
    totalInput += inputTokens;
    totalOutput += outputTokens;
    found = true;
    totalCacheRead += extractCachedInputTokens(usage);
  }

  if (!found) return undefined;
  return { inputTokens: totalInput, outputTokens: totalOutput, cacheReadTokens: totalCacheRead, model };
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

function cachedTokensFromDetails(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const details = value as Record<string, unknown>;
  const cachedTokens = details.cached_tokens;
  return typeof cachedTokens === 'number' && Number.isFinite(cachedTokens) ? cachedTokens : 0;
}

function extractCachedInputTokens(usage: Record<string, unknown>): number {
  for (const key of ['input_tokens_details', 'prompt_tokens_details', 'input_token_details', 'prompt_token_details']) {
    const cachedTokens = cachedTokensFromDetails(usage[key]);
    if (cachedTokens > 0) return cachedTokens;
  }
  return firstNumber(usage, ['cached_tokens', 'cached_input_tokens', 'cache_read_input_tokens']);
}

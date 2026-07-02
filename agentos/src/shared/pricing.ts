// Bundled pricing table — USD per 1M tokens.
// Prices are approximate list prices as of 2026-07. Update when a provider changes pricing.
// PRICING_LAST_UPDATED should be bumped whenever this table is revised.
export const PRICING_LAST_UPDATED = '2026-07';

export type ModelPrice = {
  input: number;
  output: number;
  // Anthropic prompt-caching rates (USD per 1M tokens).
  // cacheRead:     tokens served from cache  (~10% of input price)
  // cacheCreation: tokens written to cache   (~125% of input price)
  cacheRead?: number;
  cacheCreation?: number;
};

export const TOKEN_PRICES_USD_PER_1M: Record<string, ModelPrice> = {
  // Explicit Opus 4.7/4.8 entries override the legacy 'claude-opus-4' prefix match below.
  // Without these, the fuzzy matcher would bill 4.7/4.8 at the legacy Opus 4 rate of $15/$75.
  // Fable 5 ($10/$50) is placed AFTER the cheaper Opus entries so that the fuzzy
  // matcher returns Opus pricing for short free-text prefixes like 'claude' or
  // 'claude-' (Ollama/OpenRouter model strings) instead of the more expensive Fable 5.
  'claude-opus-4-8': { input: 5.0, output: 25.0, cacheRead: 0.5, cacheCreation: 6.25 },
  'claude-opus-4-7': { input: 5.0, output: 25.0, cacheRead: 0.5, cacheCreation: 6.25 },
  'claude-fable-5': { input: 10.0, output: 50.0, cacheRead: 1.0, cacheCreation: 12.5 },
  'claude-opus-4': { input: 15.0, output: 75.0, cacheRead: 1.5, cacheCreation: 18.75 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0, cacheRead: 0.3, cacheCreation: 3.75 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0, cacheRead: 0.1, cacheCreation: 1.25 },
  // OpenAI list prices. codex-default is the fallback for unpinned/free-text Codex models.
  'gpt-5.5': { input: 5.0, output: 30.0, cacheRead: 0.5 },
  'gpt-5.4': { input: 2.5, output: 15.0, cacheRead: 0.25 },
  'gpt-5.4-mini': { input: 0.75, output: 4.5 },
  'codex-default': { input: 3.0, output: 12.0 },
  // Gemini list prices. Cache read ≈ 25% of input on the 2.x line; Gemini 3.x dropped to 10%.
  'gemini-3.5-flash': { input: 1.5, output: 9.0, cacheRead: 0.15 },
  'gemini-3.1-pro-preview': { input: 2.0, output: 12.0, cacheRead: 0.2 },
  'gemini-3-pro': { input: 2.0, output: 12.0, cacheRead: 0.2 },
  'gemini-3-flash': { input: 0.5, output: 3.0, cacheRead: 0.05 },
  'gemini-2.5-pro': { input: 1.25, output: 10.0, cacheRead: 0.31 },
  'gemini-2.5-flash': { input: 0.15, output: 0.6, cacheRead: 0.0375 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4, cacheRead: 0.025 },
  'gemini-default': { input: 0.075, output: 0.3, cacheRead: 0.01875 },
};

const FALLBACK_PRICE: ModelPrice = { input: 3.0, output: 15.0, cacheRead: 0.3, cacheCreation: 3.75 };

// 1 USD = 1,000,000 micro-dollars. Stored as integers to avoid float precision issues.
export const MICRODOLLARS_PER_DOLLAR = 1_000_000;

function resolvePrice(model: string | undefined): ModelPrice {
  if (!model) return FALLBACK_PRICE;
  if (TOKEN_PRICES_USD_PER_1M[model]) return TOKEN_PRICES_USD_PER_1M[model];
  // Fuzzy match by prefix (e.g. "claude-sonnet-4" matches "claude-sonnet-4-6")
  for (const [key, price] of Object.entries(TOKEN_PRICES_USD_PER_1M)) {
    if (model.startsWith(key) || key.startsWith(model)) return price;
  }
  // Unknown Gemini model → use gemini-default rather than Claude fallback
  if (model.startsWith('gemini')) return TOKEN_PRICES_USD_PER_1M['gemini-default'];
  return FALLBACK_PRICE;
}

// Returns estimated cost in micro-dollars (1e-6 USD) to avoid float precision issues.
// cacheReadTokens and cacheCreationTokens are Anthropic prompt-caching token counts.
export function calcCostUsdMicro(
  inputTokens: number,
  outputTokens: number,
  model?: string,
  cacheReadTokens = 0,
  cacheCreationTokens = 0
): number {
  const price = resolvePrice(model);
  const cacheReadRate = price.cacheRead ?? price.input * 0.1;
  const cacheCreationRate = price.cacheCreation ?? price.input * 1.25;
  const costUsd =
    (inputTokens * price.input +
      outputTokens * price.output +
      cacheReadTokens * cacheReadRate +
      cacheCreationTokens * cacheCreationRate) /
    MICRODOLLARS_PER_DOLLAR;
  return Math.round(costUsd * MICRODOLLARS_PER_DOLLAR);
}

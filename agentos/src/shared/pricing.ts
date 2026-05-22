// Bundled pricing table — USD per 1M tokens.
// Prices are approximate list prices as of 2026-03. Update when Anthropic changes pricing.
// PRICING_LAST_UPDATED should be bumped whenever this table is revised.
export const PRICING_LAST_UPDATED = '2026-03';

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
  'claude-opus-4': { input: 15.0, output: 75.0, cacheRead: 1.5, cacheCreation: 18.75 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0, cacheRead: 0.3, cacheCreation: 3.75 },
  'claude-haiku-4-5': { input: 0.8, output: 4.0, cacheRead: 0.08, cacheCreation: 1.0 },
  'codex-default': { input: 3.0, output: 12.0 },
  // Gemini list prices. Cache read ≈ 25% of input.
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

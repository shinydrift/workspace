/**
 * Tests for shared/pricing.ts — calcCostUsdMicro and resolvePrice
 * Functions are inlined (no TS loader available in node:test runner).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from pricing.ts ───────────────────────────────────────────────────

const TOKEN_PRICES_USD_PER_1M = {
  'claude-opus-4': { input: 15.0, output: 75.0, cacheRead: 1.5, cacheCreation: 18.75 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0, cacheRead: 0.3, cacheCreation: 3.75 },
  'claude-haiku-4-5': { input: 0.8, output: 4.0, cacheRead: 0.08, cacheCreation: 1.0 },
  'gpt-5.4-mini': { input: 0.75, output: 4.5, cacheRead: 0.075 },
  'codex-default': { input: 3.0, output: 12.0, cacheRead: 0.3 },
  'gemini-2.5-pro': { input: 1.25, output: 10.0, cacheRead: 0.31 },
  'gemini-2.5-flash': { input: 0.15, output: 0.6, cacheRead: 0.0375 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4, cacheRead: 0.025 },
  'gemini-default': { input: 0.075, output: 0.3, cacheRead: 0.01875 },
};

const FALLBACK_PRICE = { input: 3.0, output: 15.0, cacheRead: 0.3, cacheCreation: 3.75 };
const MICRODOLLARS_PER_DOLLAR = 1_000_000;

function resolvePrice(model) {
  if (!model) return FALLBACK_PRICE;
  if (TOKEN_PRICES_USD_PER_1M[model]) return TOKEN_PRICES_USD_PER_1M[model];
  for (const [key, price] of Object.entries(TOKEN_PRICES_USD_PER_1M)) {
    if (model.startsWith(key) || key.startsWith(model)) return price;
  }
  if (model.startsWith('gemini')) return TOKEN_PRICES_USD_PER_1M['gemini-default'];
  return FALLBACK_PRICE;
}

function calcCostUsdMicro(inputTokens, outputTokens, model, cacheReadTokens = 0, cacheCreationTokens = 0) {
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

// ── Tests ─────────────────────────────────────────────────────────────────────

test('zero tokens costs zero', () => {
  assert.equal(calcCostUsdMicro(0, 0, 'claude-sonnet-4-6'), 0);
});

test('exact model match — sonnet', () => {
  // 1M input @ $3 + 0 output = $3 = 3_000_000 microdollars
  assert.equal(calcCostUsdMicro(1_000_000, 0, 'claude-sonnet-4-6'), 3_000_000);
});

test('exact model match — opus output', () => {
  // 0 input + 1M output @ $75 = 75_000_000 microdollars
  assert.equal(calcCostUsdMicro(0, 1_000_000, 'claude-opus-4'), 75_000_000);
});

test('exact model match — haiku', () => {
  // 1M input @ $0.8 + 1M output @ $4 = $4.8 = 4_800_000 microdollars
  assert.equal(calcCostUsdMicro(1_000_000, 1_000_000, 'claude-haiku-4-5'), 4_800_000);
});

test('prefix fuzzy match — model is prefix of key', () => {
  // 'claude-sonnet-4' should fuzzy match 'claude-sonnet-4-6'
  assert.equal(calcCostUsdMicro(1_000_000, 0, 'claude-sonnet-4'), 3_000_000);
});

test('prefix fuzzy match — key is prefix of model', () => {
  // 'claude-opus-4-extra' starts with 'claude-opus-4'
  assert.equal(calcCostUsdMicro(0, 1_000_000, 'claude-opus-4-extra'), 75_000_000);
});

test('unknown model uses fallback price', () => {
  // fallback = sonnet prices: 1M input @ $3
  assert.equal(calcCostUsdMicro(1_000_000, 0, 'unknown-model-xyz'), 3_000_000);
});

test('undefined model uses fallback price', () => {
  assert.equal(calcCostUsdMicro(1_000_000, 0, undefined), 3_000_000);
});

test('result is rounded integer', () => {
  const result = calcCostUsdMicro(1, 1, 'claude-sonnet-4-6');
  assert.equal(result, Math.round(result));
  assert.equal(typeof result, 'number');
});

test('gemini model — very low price', () => {
  // 1M input @ $0.075 = $0.075 = 75_000 microdollars
  assert.equal(calcCostUsdMicro(1_000_000, 0, 'gemini-default'), 75_000);
});

test('gemini-2.5-pro — exact match', () => {
  // 1M input @ $1.25 = 1_250_000 microdollars
  assert.equal(calcCostUsdMicro(1_000_000, 0, 'gemini-2.5-pro'), 1_250_000);
});

test('gemini unknown model falls to gemini-default not Claude fallback', () => {
  // 1M input @ $0.075 = 75_000 (not $3 Claude fallback = 3_000_000)
  assert.equal(calcCostUsdMicro(1_000_000, 0, 'gemini-9.0-ultra'), 75_000);
});

test('gemini cache read tokens factored in', () => {
  // 1M cache read @ $0.31 = 310_000 microdollars
  assert.equal(calcCostUsdMicro(0, 0, 'gemini-2.5-pro', 1_000_000), 310_000);
});

test('claude cache read tokens factored in', () => {
  // 1M cache read @ $0.3 = 300_000 microdollars
  assert.equal(calcCostUsdMicro(0, 0, 'claude-sonnet-4-6', 1_000_000), 300_000);
});

test('gpt-5.4-mini cache read tokens use explicit OpenAI cached input price', () => {
  // 1M cache read @ $0.075 = 75_000 microdollars
  assert.equal(calcCostUsdMicro(0, 0, 'gpt-5.4-mini', 1_000_000), 75_000);
});

test('codex-default cache read tokens use explicit cached input price', () => {
  // 1M cache read @ $0.3 = 300_000 microdollars
  assert.equal(calcCostUsdMicro(0, 0, 'codex-default', 1_000_000), 300_000);
});

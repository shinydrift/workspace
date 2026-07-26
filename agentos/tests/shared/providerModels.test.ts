import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CODEX_REASONING_VALUES,
  PROVIDER_MODELS,
  isKnownProviderModel,
  normalizeCodexReasoning,
  normalizeProviderOrder,
} from '../../src/shared/types/provider';
import { calcCostUsdMicro } from '../../src/shared/pricing';

test('provider model menus expose the current official agent models', () => {
  assert.deepEqual(PROVIDER_MODELS.claude, [
    'claude-fable-5',
    'claude-opus-5',
    'claude-opus-4-8',
    'claude-sonnet-5',
    'claude-haiku-4-5',
  ]);
  assert.deepEqual(PROVIDER_MODELS.codex, [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
  ]);
  assert.deepEqual(PROVIDER_MODELS.gemini, [
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-pro-preview',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
  ]);
});

test('legacy models remain valid without appearing in new-selection menus', () => {
  assert.equal(PROVIDER_MODELS.claude.includes('claude-opus-4-7'), false);
  assert.equal(PROVIDER_MODELS.gemini.includes('gemini-3-flash'), false);
  assert.equal(isKnownProviderModel('claude', 'claude-opus-4-7'), true);
  assert.equal(isKnownProviderModel('gemini', 'gemini-3-flash'), true);
  assert.deepEqual(normalizeProviderOrder([{ provider: 'claude', model: 'claude-opus-4-7' }]), [
    {
      provider: 'claude',
      backend: undefined,
      model: 'claude-opus-4-7',
      baseUrl: undefined,
      effort: undefined,
      reasoning: undefined,
    },
  ]);
});

test('Codex reasoning levels match current config values and migrate extra-high', () => {
  assert.deepEqual(CODEX_REASONING_VALUES, ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(normalizeCodexReasoning('extra-high'), 'xhigh');
  assert.equal(normalizeCodexReasoning('ultra'), undefined);
});

test('new model pricing uses current standard token rates', () => {
  assert.equal(calcCostUsdMicro(1_000_000, 1_000_000, 'claude-opus-5'), 30_000_000);
  assert.equal(calcCostUsdMicro(1_000_000, 1_000_000, 'gpt-5.6-sol'), 35_000_000);
  assert.equal(calcCostUsdMicro(1_000_000, 1_000_000, 'gpt-5.6-terra'), 17_500_000);
  assert.equal(calcCostUsdMicro(1_000_000, 1_000_000, 'gpt-5.6-luna'), 7_000_000);
  assert.equal(calcCostUsdMicro(1_000_000, 1_000_000, 'gemini-3.6-flash'), 9_000_000);
  assert.equal(calcCostUsdMicro(1_000_000, 1_000_000, 'gemini-3.5-flash-lite'), 2_800_000);
});

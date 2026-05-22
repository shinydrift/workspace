import type { Provider } from '../../shared/types';
import { normalizeClaude, normalizeClaudeMessages } from './claude';
import { normalizeCodex, normalizeCodexMessages } from './codex';
import { normalizeGemini } from './gemini';
import type { NormalizedMessageInput, NormalizedMessageResult, ProviderNormalizer } from './types';
import { buildPlainTextResult } from './types';

// Partial map so the runtime `?? buildPlainTextResult` fallback fires for unknown providers
// (e.g. data stored before a provider was added, or future dynamic providers).
const providerNormalizers: Partial<Record<Provider, ProviderNormalizer>> = {
  claude: normalizeClaude,
  'claude-interactive': normalizeClaude,
  codex: normalizeCodex,
  gemini: normalizeGemini,
};

export function normalizeMessage(input: NormalizedMessageInput): NormalizedMessageResult {
  const normalizer = providerNormalizers[input.provider] ?? buildPlainTextResult;
  return normalizer(input);
}

/**
 * Normalize a provider message into display results.
 * For `codex`, this may return multiple results (one per agent turn).
 * For other providers, always returns a single-element array.
 */
export function normalizeMessages(input: NormalizedMessageInput): NormalizedMessageResult[] {
  if (input.provider === 'codex') {
    return normalizeCodexMessages(input);
  }
  return [normalizeMessage(input)];
}

/**
 * Like `normalizeMessages` but also splits multi-turn Claude streams.
 * Use this for embedded child threads (council/kanban workers) that flush only at process
 * exit and would otherwise collapse multiple tool-use rounds into a single assistant message.
 */
export function normalizeMessagesMultiTurn(input: NormalizedMessageInput): NormalizedMessageResult[] {
  if (input.provider === 'claude' || input.provider === 'claude-interactive') {
    return normalizeClaudeMessages(input);
  }
  if (input.provider === 'codex') {
    return normalizeCodexMessages(input);
  }
  return [normalizeMessage(input)];
}

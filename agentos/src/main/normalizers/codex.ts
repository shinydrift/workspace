import stripAnsi from 'strip-ansi';
import type { NormalizedMessageInput, NormalizedMessageResult } from './types';
import { buildPlainTextResult, extractRateLimitWindows, parseJsonLines } from './types';
import { cleanupLines, filterPromptNoise, isCodexAuthScreen, normalizeTerminalText } from './codex/terminal';
import { extractCodexTokenUsage } from './codex/metadata';
import {
  buildFromCodexJsonEvents,
  buildSplitMessagesFromCodexJsonEvents,
  extractCodexTextFragments,
} from './codex/eventParsing';

export { CodexEventType } from './codex/eventParsing';

export function normalizeCodex(input: NormalizedMessageInput): NormalizedMessageResult {
  if (input.role !== 'assistant') return buildPlainTextResult(input);

  const rawText = typeof input.raw === 'string' ? input.raw : input.text;
  const jsonEvents = parseJsonLines(rawText);
  if (jsonEvents.length > 0) {
    const structured = buildFromCodexJsonEvents(input, jsonEvents);
    if (structured) {
      structured.tokenUsage = extractCodexTokenUsage(jsonEvents);
      structured.rateLimitWindows = extractRateLimitWindows(jsonEvents);
      return structured;
    }
  }

  const normalized = normalizeTerminalText(rawText);
  const stripped = stripAnsi(normalized);
  const lines = cleanupLines(stripped);

  if (lines.length === 0) return buildPlainTextResult({ ...input, text: '' });
  if (isCodexAuthScreen(lines)) return buildPlainTextResult({ ...input, text: '' });

  const filtered = filterPromptNoise(lines);
  const content = filtered.join('\n').trim();
  return buildPlainTextResult({ ...input, text: content, raw: input.raw ?? input.text });
}

export function normalizeCodexMessages(input: NormalizedMessageInput): NormalizedMessageResult[] {
  if (input.role !== 'assistant') return [buildPlainTextResult(input)];

  const rawText = typeof input.raw === 'string' ? input.raw : input.text;
  const jsonEvents = parseJsonLines(rawText);
  if (jsonEvents.length > 0) {
    const split = buildSplitMessagesFromCodexJsonEvents(input, jsonEvents);
    if (split.length > 0) {
      // Attach token usage and rate limits to the last result, matching normalizeClaude_multi behavior.
      split[split.length - 1].tokenUsage = extractCodexTokenUsage(jsonEvents);
      split[split.length - 1].rateLimitWindows = extractRateLimitWindows(jsonEvents);
      return split;
    }
  }

  return [normalizeCodex(input)];
}

/**
 * Decode plain text from a raw Codex NDJSON buffer.
 *
 * Codex always outputs NDJSON (--json flag). This extracts the text content
 * from message-bearing events so callers that need plain text (e.g. the council
 * outcome sentinel scanner) can use the same extraction logic as the main-thread
 * normalizer instead of maintaining a separate decoder.
 */
export function decodeCodexBuffer(rawBuffer: string): string {
  return extractCodexTextFragments(parseJsonLines(rawBuffer)).join('\n');
}

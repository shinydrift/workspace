/**
 * Tests for the external-session transcript reader — the backfill/mirror logic that turns raw
 * Claude Code JSONL entries into AgentOS messages. Pure logic, no Electron.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { JsonlEntry } from '../../../src/main/sessions/claudeInteractive/ClaudeJsonlWatcher';
import {
  extractHumanUserText,
  transcriptHasAssistant,
  parseTranscriptLines,
  TranscriptMessageEmitter,
} from '../../../src/main/sessions/externalImport/transcriptReader';

const humanString: JsonlEntry = { type: 'user', message: { role: 'user', content: '  hello there  ' } };
const humanBlocks: JsonlEntry = {
  type: 'user',
  message: {
    role: 'user',
    content: [
      { type: 'text', text: 'line 1' },
      { type: 'text', text: 'line 2' },
    ],
  },
};
const toolResultCarrier: JsonlEntry = {
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
};
const metaEntry: JsonlEntry = { type: 'user', isMeta: true, message: { role: 'user', content: 'caveat' } };
const assistantEntry: JsonlEntry = {
  type: 'assistant',
  message: { id: 'm1', content: [{ type: 'text', text: 'hi' }] },
};

test('extractHumanUserText returns trimmed string content', () => {
  assert.equal(extractHumanUserText(humanString), 'hello there');
});

test('extractHumanUserText joins text blocks', () => {
  assert.equal(extractHumanUserText(humanBlocks), 'line 1\nline 2');
});

test('extractHumanUserText returns null for a tool_result carrier', () => {
  assert.equal(extractHumanUserText(toolResultCarrier), null);
});

test('extractHumanUserText returns null for meta entries', () => {
  assert.equal(extractHumanUserText(metaEntry), null);
});

test('extractHumanUserText returns null for non-user entries', () => {
  assert.equal(extractHumanUserText(assistantEntry), null);
});

test('transcriptHasAssistant detects assistant entries', () => {
  assert.equal(transcriptHasAssistant([humanString, assistantEntry]), true);
  assert.equal(transcriptHasAssistant([humanString, toolResultCarrier]), false);
});

test('parseTranscriptLines skips blank and partial lines', () => {
  const text = `${JSON.stringify(humanString)}\n\n{ broken\n${JSON.stringify(assistantEntry)}`;
  const entries = parseTranscriptLines(text);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].type, 'user');
  assert.equal(entries[1].type, 'assistant');
});

test('TranscriptMessageEmitter groups assistant turns and preserves human boundaries', () => {
  const calls: Array<{ kind: 'user' | 'assistant'; text: string }> = [];
  const emitter = new TranscriptMessageEmitter({
    appendUserMessage: (text) => calls.push({ kind: 'user', text }),
    appendAssistantRaw: (raw) => calls.push({ kind: 'assistant', text: raw }),
  });

  const q2: JsonlEntry = { type: 'user', message: { role: 'user', content: 'second question' } };
  const a2: JsonlEntry = { type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'bye' }] } };

  // q1 → a1 → tool_result → (a1 continues) → q2 → a2, then EOF flush.
  for (const e of [humanString, assistantEntry, toolResultCarrier, q2, a2]) emitter.push(e);
  emitter.flush();

  assert.deepEqual(
    calls.map((c) => c.kind),
    ['user', 'assistant', 'user', 'assistant']
  );
  assert.equal(calls[0].text, 'hello there');
  assert.equal(calls[2].text, 'second question');
  // The first assistant turn bundles the assistant entry + its tool-result carrier.
  assert.match(calls[1].text, /"type":"assistant"/);
  assert.match(calls[1].text, /"tool_result"/);
  // The second assistant turn is its own message.
  assert.match(calls[3].text, /"bye"/);
});

test('TranscriptMessageEmitter flush is a no-op with no buffered assistant entries', () => {
  const calls: string[] = [];
  const emitter = new TranscriptMessageEmitter({
    appendUserMessage: () => calls.push('user'),
    appendAssistantRaw: () => calls.push('assistant'),
  });
  emitter.flush();
  emitter.push(humanString);
  emitter.flush();
  assert.deepEqual(calls, ['user']);
});

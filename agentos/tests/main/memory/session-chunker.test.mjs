/**
 * Tests for memory/session-chunker.ts — serializeTurnsForFork, chunk ID format.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from session-chunker.ts ─────────────────────────────────────────

function serializeTurnsForFork(turns) {
  return turns
    .map((t, i) => {
      const label = i === turns.length - 1 ? ' [EVALUATE THIS TURN]' : '';
      return `--- Turn ${t.index}${label}\nUser: ${t.userText}\nAssistant: ${t.assistantText}`;
    })
    .join('\n\n');
}

// Chunk ID format: session:{threadId}:{turnIndex}:{chunkIdx}
function makeChunkId(threadId, turnIndex, chunkIdx) {
  return `session:${threadId}:${turnIndex}:${chunkIdx}`;
}

// ── serializeTurnsForFork ─────────────────────────────────────────────────────

test('serializes single turn with EVALUATE label', () => {
  const turns = [{ index: 0, userText: 'hello', assistantText: 'world' }];
  const output = serializeTurnsForFork(turns);
  assert.ok(output.includes('[EVALUATE THIS TURN]'));
  assert.ok(output.includes('Turn 0'));
  assert.ok(output.includes('User: hello'));
  assert.ok(output.includes('Assistant: world'));
});

test('last turn gets EVALUATE label, prior turns do not', () => {
  const turns = [
    { index: 0, userText: 'first', assistantText: 'response1' },
    { index: 1, userText: 'second', assistantText: 'response2' },
  ];
  const output = serializeTurnsForFork(turns);
  const lines = output.split('\n');
  const evalLine = lines.find((l) => l.includes('[EVALUATE THIS TURN]'));
  assert.ok(evalLine?.includes('Turn 1'), 'EVALUATE label on last turn');
  assert.ok(!output.includes('--- Turn 0 [EVALUATE THIS TURN]'), 'Turn 0 has no label');
});

test('multiple turns are separated by double newline', () => {
  const turns = [
    { index: 0, userText: 'q1', assistantText: 'a1' },
    { index: 1, userText: 'q2', assistantText: 'a2' },
  ];
  const output = serializeTurnsForFork(turns);
  assert.ok(output.includes('\n\n'));
});

test('turn index is included in output', () => {
  const turns = [{ index: 7, userText: 'q', assistantText: 'a' }];
  const output = serializeTurnsForFork(turns);
  assert.ok(output.includes('Turn 7'));
});

test('empty turns array returns empty string', () => {
  const output = serializeTurnsForFork([]);
  assert.equal(output, '');
});

test('user and assistant text are preserved exactly', () => {
  const turns = [{ index: 0, userText: 'What is 2+2?', assistantText: '4' }];
  const output = serializeTurnsForFork(turns);
  assert.ok(output.includes('User: What is 2+2?'));
  assert.ok(output.includes('Assistant: 4'));
});

// ── chunk ID format ───────────────────────────────────────────────────────────

test('chunk ID has session: prefix', () => {
  assert.ok(makeChunkId('thread1', 0, 0).startsWith('session:'));
});

test('chunk ID encodes all components', () => {
  const id = makeChunkId('abc123', 5, 2);
  assert.equal(id, 'session:abc123:5:2');
});

test('chunk IDs for different chunks are distinct', () => {
  const id0 = makeChunkId('t1', 3, 0);
  const id1 = makeChunkId('t1', 3, 1);
  assert.notEqual(id0, id1);
});

test('chunk IDs for different turns are distinct', () => {
  const id0 = makeChunkId('t1', 0, 0);
  const id1 = makeChunkId('t1', 1, 0);
  assert.notEqual(id0, id1);
});

test('chunk IDs for different threads are distinct', () => {
  const id0 = makeChunkId('t1', 0, 0);
  const id1 = makeChunkId('t2', 0, 0);
  assert.notEqual(id0, id1);
});

// ── FORK_PROMPT structure ─────────────────────────────────────────────────────

const FORK_PROMPT = `You are a memory indexing agent. You are given recent turns from a coding assistant session.
The LAST turn is the one to evaluate. Prior turns are context only — do not produce chunks for them.

Step 1 — Embeddability:
Decide if the last turn contains anything worth storing in long-term memory.
Worth storing: decisions made, user preferences stated, facts about the project, problems solved, code or config produced.
Not worth storing: clarifications, greetings, retries with same outcome, intermediate tool steps.

Step 2 — If embeddable, produce chunks:
One topic per chunk. Each chunk must be under 1400 characters. Target 150–350 words.
Write distilled, indexable prose — not raw conversation. No speaker labels.
Provide a short summary (one sentence) for each chunk.

Output valid JSON:
{ "embeddable": boolean, "reason": string, "chunks"?: [{ "summary": string, "text": string }] }

Turns:
{turns}`;

test('FORK_PROMPT contains turns placeholder', () => {
  assert.ok(FORK_PROMPT.includes('{turns}'));
});

test('FORK_PROMPT specifies embeddable JSON output schema', () => {
  assert.ok(FORK_PROMPT.includes('"embeddable": boolean'));
  assert.ok(FORK_PROMPT.includes('"reason": string'));
  assert.ok(FORK_PROMPT.includes('"chunks"'));
});

test('FORK_PROMPT instructs evaluation of LAST turn only', () => {
  assert.ok(FORK_PROMPT.includes('LAST turn'));
  assert.ok(FORK_PROMPT.includes('Prior turns are context only'));
});

// ── JSON extraction from fork response ────────────────────────────────────────

function extractJsonFromForkResponse(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

test('extractJsonFromForkResponse parses plain JSON', () => {
  const result = extractJsonFromForkResponse('{"embeddable":false,"reason":"noise"}');
  assert.equal(result.embeddable, false);
  assert.equal(result.reason, 'noise');
});

test('extractJsonFromForkResponse parses JSON wrapped in markdown code block', () => {
  const text = 'Here is my analysis:\n```json\n{"embeddable":true,"reason":"decision","chunks":[]}\n```';
  const result = extractJsonFromForkResponse(text);
  assert.equal(result.embeddable, true);
});

test('extractJsonFromForkResponse returns null when no JSON found', () => {
  const result = extractJsonFromForkResponse('No JSON here');
  assert.equal(result, null);
});

test('extractJsonFromForkResponse handles JSON with chunks array', () => {
  const text = '{"embeddable":true,"reason":"r","chunks":[{"summary":"s","text":"t"}]}';
  const result = extractJsonFromForkResponse(text);
  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].summary, 's');
});

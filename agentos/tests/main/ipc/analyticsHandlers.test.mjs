/**
 * Tests for ipc/handlers/analyticsHandlers.ts — pure computation functions.
 * Logic inlined — no TS loader needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from analyticsHandlers.ts ─────────────────────────────────────────

function computeToolBreakdown(messages) {
  const toolUseIdToName = new Map();
  const stats = new Map();

  for (const msg of messages) {
    for (const block of msg.normalized?.blocks ?? []) {
      if (block.type === 'tool_use') {
        toolUseIdToName.set(block.id, block.name);
        if (!stats.has(block.name)) {
          stats.set(block.name, { name: block.name, count: 0, successCount: 0, errorCount: 0 });
        }
        stats.get(block.name).count++;
      } else if (block.type === 'tool_result') {
        const name = toolUseIdToName.get(block.toolUseId);
        if (name && stats.has(name)) {
          if (block.isError) {
            stats.get(name).errorCount++;
          } else {
            stats.get(name).successCount++;
          }
        }
      }
    }
  }

  return [...stats.values()].sort((a, b) => b.count - a.count);
}

const RESPONSE_TRUNCATE_CHARS = 2000;

function computeToolInvocations(messages) {
  const toolUseById = new Map();
  const invocations = [];

  for (const msg of messages) {
    for (const block of msg.normalized?.blocks ?? []) {
      if (block.type === 'tool_use') {
        toolUseById.set(block.id, { name: block.name, input: block.input, calledAt: msg.timestamp });
      } else if (block.type === 'tool_result') {
        const use = toolUseById.get(block.toolUseId);
        if (use) {
          invocations.push({
            id: block.toolUseId,
            name: use.name,
            input: use.input,
            response:
              block.content.length > RESPONSE_TRUNCATE_CHARS
                ? block.content.slice(0, RESPONSE_TRUNCATE_CHARS) + '…'
                : block.content,
            isError: block.isError ?? false,
            calledAt: use.calledAt,
          });
        }
      }
    }
  }

  return invocations;
}

function computeTurnMetrics(messages, sessionStartedAt = null) {
  const result = [];
  let turn = 0;
  let lastUserTs = null;
  for (const msg of messages) {
    if (msg.role !== 'assistant') {
      lastUserTs = msg.timestamp;
      continue;
    }
    turn++;
    const toolCallCount = (msg.normalized?.blocks ?? []).filter((b) => b.type === 'tool_use').length;
    const startedAt = lastUserTs ?? sessionStartedAt ?? msg.timestamp;
    result.push({ turn, toolCallCount, startedAt, timestamp: msg.timestamp });
  }
  return result;
}

function aggregateToolStats(statsArrays) {
  const agg = new Map();
  for (const breakdown of statsArrays) {
    for (const stat of breakdown) {
      const existing = agg.get(stat.name);
      if (existing) {
        existing.count += stat.count;
        existing.successCount += stat.successCount;
        existing.errorCount += stat.errorCount;
      } else {
        agg.set(stat.name, { ...stat });
      }
    }
  }
  return [...agg.values()].sort((a, b) => b.count - a.count);
}

// ── helpers ───────────────────────────────────────────────────────────────────

function makeMsg(role, blocks, timestamp = 1000) {
  return { role, timestamp, normalized: { blocks } };
}

function toolUse(id, name, input = {}) {
  return { type: 'tool_use', id, name, input };
}

function toolResult(toolUseId, content, isError = false) {
  return { type: 'tool_result', toolUseId, content, isError };
}

// ── computeToolBreakdown ──────────────────────────────────────────────────────

test('computeToolBreakdown: empty messages returns empty array', () => {
  assert.deepEqual(computeToolBreakdown([]), []);
});

test('computeToolBreakdown: counts tool_use blocks', () => {
  const msgs = [
    makeMsg('assistant', [toolUse('id1', 'Read'), toolResult('id1', 'content')]),
  ];
  const stats = computeToolBreakdown(msgs);
  assert.equal(stats.length, 1);
  assert.equal(stats[0].name, 'Read');
  assert.equal(stats[0].count, 1);
});

test('computeToolBreakdown: counts success and error results', () => {
  const msgs = [
    makeMsg('assistant', [
      toolUse('id1', 'Bash'),
      toolResult('id1', 'ok'),
      toolUse('id2', 'Bash'),
      toolResult('id2', 'err', true),
    ]),
  ];
  const stats = computeToolBreakdown(msgs);
  assert.equal(stats.length, 1);
  assert.equal(stats[0].name, 'Bash');
  assert.equal(stats[0].count, 2);
  assert.equal(stats[0].successCount, 1);
  assert.equal(stats[0].errorCount, 1);
});

test('computeToolBreakdown: multiple tools sorted by count descending', () => {
  const msgs = [
    makeMsg('assistant', [
      toolUse('a1', 'Read'),
      toolResult('a1', 'r1'),
      toolUse('b1', 'Bash'),
      toolResult('b1', 'r2'),
      toolUse('b2', 'Bash'),
      toolResult('b2', 'r3'),
      toolUse('b3', 'Bash'),
      toolResult('b3', 'r4'),
    ]),
  ];
  const stats = computeToolBreakdown(msgs);
  assert.equal(stats[0].name, 'Bash');
  assert.equal(stats[0].count, 3);
  assert.equal(stats[1].name, 'Read');
  assert.equal(stats[1].count, 1);
});

test('computeToolBreakdown: tool_result without matching tool_use is ignored', () => {
  const msgs = [
    makeMsg('assistant', [toolResult('no-match', 'content')]),
  ];
  const stats = computeToolBreakdown(msgs);
  assert.deepEqual(stats, []);
});

test('computeToolBreakdown: messages without normalized blocks are skipped', () => {
  const msgs = [{ role: 'assistant', timestamp: 1000 }];
  assert.deepEqual(computeToolBreakdown(msgs), []);
});

// ── computeToolInvocations ────────────────────────────────────────────────────

test('computeToolInvocations: empty messages returns empty array', () => {
  assert.deepEqual(computeToolInvocations([]), []);
});

test('computeToolInvocations: pairs tool_use with tool_result', () => {
  const msgs = [
    makeMsg('assistant', [
      toolUse('id1', 'Read', { file_path: '/foo' }),
      toolResult('id1', 'file content'),
    ], 5000),
  ];
  const inv = computeToolInvocations(msgs);
  assert.equal(inv.length, 1);
  assert.equal(inv[0].id, 'id1');
  assert.equal(inv[0].name, 'Read');
  assert.deepEqual(inv[0].input, { file_path: '/foo' });
  assert.equal(inv[0].response, 'file content');
  assert.equal(inv[0].isError, false);
  assert.equal(inv[0].calledAt, 5000);
});

test('computeToolInvocations: error results are flagged', () => {
  const msgs = [
    makeMsg('assistant', [
      toolUse('id1', 'Bash', { command: 'ls' }),
      toolResult('id1', 'permission denied', true),
    ]),
  ];
  const inv = computeToolInvocations(msgs);
  assert.equal(inv[0].isError, true);
});

test('computeToolInvocations: response truncated at 2000 chars', () => {
  const longContent = 'x'.repeat(2500);
  const msgs = [
    makeMsg('assistant', [
      toolUse('id1', 'Read', {}),
      toolResult('id1', longContent),
    ]),
  ];
  const inv = computeToolInvocations(msgs);
  assert.equal(inv[0].response.length, 2001); // 2000 + '…'
  assert.ok(inv[0].response.endsWith('…'));
});

test('computeToolInvocations: response at exactly 2000 chars is not truncated', () => {
  const content = 'y'.repeat(2000);
  const msgs = [
    makeMsg('assistant', [
      toolUse('id1', 'Read', {}),
      toolResult('id1', content),
    ]),
  ];
  const inv = computeToolInvocations(msgs);
  assert.equal(inv[0].response, content);
  assert.ok(!inv[0].response.endsWith('…'));
});

test('computeToolInvocations: tool_result without matching use is omitted', () => {
  const msgs = [
    makeMsg('assistant', [toolResult('no-match', 'content')]),
  ];
  assert.deepEqual(computeToolInvocations(msgs), []);
});

// ── computeTurnMetrics ────────────────────────────────────────────────────────

test('computeTurnMetrics: empty messages returns empty array', () => {
  assert.deepEqual(computeTurnMetrics([]), []);
});

test('computeTurnMetrics: only user messages returns empty array', () => {
  const msgs = [makeMsg('user', [], 1000)];
  assert.deepEqual(computeTurnMetrics(msgs), []);
});

test('computeTurnMetrics: each assistant message is a turn', () => {
  const msgs = [
    makeMsg('user', [], 1000),
    makeMsg('assistant', [], 2000),
    makeMsg('user', [], 3000),
    makeMsg('assistant', [], 4000),
  ];
  const turns = computeTurnMetrics(msgs);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].turn, 1);
  assert.equal(turns[1].turn, 2);
});

test('computeTurnMetrics: startedAt uses preceding user message timestamp', () => {
  const msgs = [
    makeMsg('user', [], 1000),
    makeMsg('assistant', [], 2000),
  ];
  const turns = computeTurnMetrics(msgs);
  assert.equal(turns[0].startedAt, 1000);
  assert.equal(turns[0].timestamp, 2000);
});

test('computeTurnMetrics: startedAt uses sessionStartedAt when no preceding user message', () => {
  const msgs = [makeMsg('assistant', [], 2000)];
  const turns = computeTurnMetrics(msgs, 500);
  assert.equal(turns[0].startedAt, 500);
});

test('computeTurnMetrics: startedAt falls back to message timestamp when no prior user or session', () => {
  const msgs = [makeMsg('assistant', [], 2000)];
  const turns = computeTurnMetrics(msgs, null);
  assert.equal(turns[0].startedAt, 2000);
});

test('computeTurnMetrics: toolCallCount counts tool_use blocks', () => {
  const msgs = [
    makeMsg('user', [], 1000),
    makeMsg('assistant', [toolUse('a', 'Read'), toolUse('b', 'Bash'), toolResult('a', 'r')], 2000),
  ];
  const turns = computeTurnMetrics(msgs);
  assert.equal(turns[0].toolCallCount, 2);
});

// ── aggregateToolStats ────────────────────────────────────────────────────────

test('aggregateToolStats: empty input returns empty array', () => {
  assert.deepEqual(aggregateToolStats([]), []);
});

test('aggregateToolStats: single breakdown returned unchanged (sorted)', () => {
  const stats = [
    { name: 'Bash', count: 3, successCount: 2, errorCount: 1 },
    { name: 'Read', count: 5, successCount: 5, errorCount: 0 },
  ];
  const result = aggregateToolStats([stats]);
  assert.equal(result[0].name, 'Read');
  assert.equal(result[1].name, 'Bash');
});

test('aggregateToolStats: merges counts across multiple breakdowns', () => {
  const a = [{ name: 'Read', count: 2, successCount: 2, errorCount: 0 }];
  const b = [{ name: 'Read', count: 3, successCount: 2, errorCount: 1 }];
  const result = aggregateToolStats([a, b]);
  assert.equal(result.length, 1);
  assert.equal(result[0].count, 5);
  assert.equal(result[0].successCount, 4);
  assert.equal(result[0].errorCount, 1);
});

test('aggregateToolStats: different tools from different breakdowns are combined', () => {
  const a = [{ name: 'Read', count: 2, successCount: 2, errorCount: 0 }];
  const b = [{ name: 'Bash', count: 4, successCount: 3, errorCount: 1 }];
  const result = aggregateToolStats([a, b]);
  assert.equal(result.length, 2);
  assert.equal(result[0].name, 'Bash'); // higher count first
  assert.equal(result[1].name, 'Read');
});

test('aggregateToolStats: empty breakdowns in input are ignored', () => {
  const a = [{ name: 'Read', count: 1, successCount: 1, errorCount: 0 }];
  const result = aggregateToolStats([[], a, []]);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Read');
});

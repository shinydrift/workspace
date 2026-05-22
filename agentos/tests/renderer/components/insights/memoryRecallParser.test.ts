import { test, expect } from 'vitest';
import {
  parseMemoryRecall,
  countMemoryRecall,
  EMPTY_MEMORY_RECALL,
} from '../../../../src/renderer/components/insights/memoryRecallParser';
import type { ToolCallInvocation } from '../../../../src/shared/types';

const SEARCH_TOOL = 'mcp__agentos-memory__memory_search';
const GET_TOOL = 'mcp__agentos-memory__memory_get';

function makeInvocation(overrides: Partial<ToolCallInvocation>): ToolCallInvocation {
  return {
    id: 'i1',
    name: SEARCH_TOOL,
    isError: false,
    input: { query: 'test' },
    response: '[]',
    ...overrides,
  };
}

// ── EMPTY_MEMORY_RECALL ───────────────────────────────────────────────────────

test('EMPTY_MEMORY_RECALL: is the zero value', () => {
  expect(EMPTY_MEMORY_RECALL.groups).toEqual([]);
  expect(EMPTY_MEMORY_RECALL.searchCount).toBe(0);
  expect(EMPTY_MEMORY_RECALL.avgMaxScore).toBe(null);
});

// ── countMemoryRecall ─────────────────────────────────────────────────────────

test('countMemoryRecall: counts search and get calls', () => {
  const invocations = [
    makeInvocation({ name: SEARCH_TOOL }),
    makeInvocation({ name: SEARCH_TOOL }),
    makeInvocation({ name: GET_TOOL }),
  ];
  const { searchCount, getCount } = countMemoryRecall(invocations);
  expect(searchCount).toBe(2);
  expect(getCount).toBe(1);
});

test('countMemoryRecall: returns zero counts for empty array', () => {
  const { searchCount, getCount } = countMemoryRecall([]);
  expect(searchCount).toBe(0);
  expect(getCount).toBe(0);
});

// ── parseMemoryRecall ─────────────────────────────────────────────────────────

test('parseMemoryRecall: empty invocations returns empty result', () => {
  const result = parseMemoryRecall([]);
  expect(result.searchCount).toBe(0);
  expect(result.getCalls.length).toBe(0);
  expect(result.avgMaxScore).toBe(null);
});

test('parseMemoryRecall: search with no results is counted', () => {
  const inv = makeInvocation({ name: SEARCH_TOOL, input: { query: 'foo' }, response: '[]' });
  const result = parseMemoryRecall([inv]);
  expect(result.searchCount).toBe(1);
  expect(result.searchesWithoutResults).toBe(1);
  expect(result.searchesWithResults).toBe(0);
});

test('parseMemoryRecall: search with hits parses entries', () => {
  const hits = [
    { path: 'memory/foo.md', score: 0.9, source: 'memory', snippet: 'some text' },
    { path: 'memory/foo.md', score: 0.8, source: 'memory', snippet: 'more' },
  ];
  const inv = makeInvocation({
    name: SEARCH_TOOL,
    input: { query: 'bar' },
    response: JSON.stringify(hits),
  });
  const result = parseMemoryRecall([inv]);
  expect(result.searchesWithResults).toBe(1);
  expect(result.groups[0].entries.length).toBe(1); // grouped by path
  expect(result.groups[0].entries[0].chunkCount).toBe(2);
  expect(result.groups[0].entries[0].maxScore).toBe(0.9);
});

test('parseMemoryRecall: avgMaxScore is average of all entry maxScores', () => {
  const hits1 = [{ path: 'a.md', score: 0.8, source: 'memory', snippet: '' }];
  const hits2 = [{ path: 'b.md', score: 0.6, source: 'sessions', snippet: '' }];
  const result = parseMemoryRecall([
    makeInvocation({ name: SEARCH_TOOL, input: { query: 'q1' }, response: JSON.stringify(hits1) }),
    makeInvocation({ name: SEARCH_TOOL, input: { query: 'q2' }, response: JSON.stringify(hits2) }),
  ]);
  expect(result.avgMaxScore).not.toBe(null);
  expect(Math.abs(result.avgMaxScore! - 0.7) < 0.001).toBeTruthy();
});

test('parseMemoryRecall: get call with result is a hit', () => {
  const inv = makeInvocation({
    name: GET_TOOL,
    input: { path: 'memory/foo.md' },
    response: '# Content\nsome text',
  });
  const result = parseMemoryRecall([inv]);
  expect(result.getCalls.length).toBe(1);
  expect(result.getCalls[0].hit).toBe(true);
  expect(result.getCalls[0].target).toBe('memory/foo.md');
});

test('parseMemoryRecall: get call with no match is not a hit', () => {
  const inv = makeInvocation({
    name: GET_TOOL,
    input: { path: 'memory/missing.md' },
    response: 'No matching memory entry found',
  });
  const result = parseMemoryRecall([inv]);
  expect(result.getCalls[0].hit).toBe(false);
});

test('parseMemoryRecall: wrapped content array response format', () => {
  const hits = [{ path: 'x.md', score: 0.75, source: 'sessions', snippet: 'hi' }];
  const response = JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(hits) }] });
  const inv = makeInvocation({ name: SEARCH_TOOL, input: { query: 'x' }, response });
  const result = parseMemoryRecall([inv]);
  expect(result.searchesWithResults).toBe(1);
});

test('parseMemoryRecall: later text-block in content array is parsed', () => {
  const hits = [{ path: 'memory/foo.md', score: 0.85, source: 'memory', snippet: 'detail' }];
  const response = JSON.stringify({
    content: [
      { type: 'text', text: 'search started' },
      { type: 'text', text: JSON.stringify(hits) },
    ],
  });
  const inv = makeInvocation({ name: SEARCH_TOOL, input: { query: 'later' }, response });
  const result = parseMemoryRecall([inv]);
  expect(result.searchesWithResults).toBe(1);
  expect(result.searchesWithoutResults).toBe(0);
  expect(result.groups[0].entries[0].maxScore).toBe(0.85);
});

test('parseMemoryRecall: trailing hint text after JSON array is extracted', () => {
  const hits = [{ path: 'memory/bar.md', score: 0.7, source: 'sessions', snippet: 'note' }];
  const response = JSON.stringify({
    content: [{ type: 'text', text: `${JSON.stringify(hits)}\n\nIf any result looks relevant...` }],
  });
  const inv = makeInvocation({ name: SEARCH_TOOL, input: { query: 'trailing' }, response });
  const result = parseMemoryRecall([inv]);
  expect(result.searchesWithResults).toBe(1);
  expect(result.groups[0].entries[0].maxScore).toBe(0.7);
});

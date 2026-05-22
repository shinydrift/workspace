import { test, expect } from 'vitest';
import { buildDiffRows, parseTaskResult } from '../../../../src/renderer/components/chat/toolCardUtils';

// ── buildDiffRows ─────────────────────────────────────────────────────────────

test('buildDiffRows: both empty returns empty', () => {
  expect(buildDiffRows('', '')).toEqual([]);
});

test('buildDiffRows: identical single line is context', () => {
  expect(buildDiffRows('hello', 'hello')).toEqual([{ type: 'context', text: 'hello' }]);
});

test('buildDiffRows: added line only', () => {
  expect(buildDiffRows('', 'added')).toEqual([{ type: 'add', text: 'added' }]);
});

test('buildDiffRows: deleted line only', () => {
  expect(buildDiffRows('deleted', '')).toEqual([{ type: 'delete', text: 'deleted' }]);
});

test('buildDiffRows: replaced line shows delete then add', () => {
  const rows = buildDiffRows('old', 'new');
  expect(rows.length).toBe(2);
  expect(rows[0]).toEqual({ type: 'delete', text: 'old' });
  expect(rows[1]).toEqual({ type: 'add', text: 'new' });
});

test('buildDiffRows: common lines preserved as context', () => {
  const rows = buildDiffRows('a\nb\nc', 'a\nx\nc');
  expect(rows[0].type).toBe('context'); // a
  expect(rows[rows.length - 1].type).toBe('context'); // c
});

test('buildDiffRows: insertion in middle', () => {
  const types = buildDiffRows('a\nc', 'a\nb\nc').map((r) => r.type);
  expect(types.includes('add')).toBeTruthy();
  expect(types.includes('context')).toBeTruthy();
  expect(types.includes('delete')).toBeFalsy();
});

test('buildDiffRows: deletion in middle', () => {
  const types = buildDiffRows('a\nb\nc', 'a\nc').map((r) => r.type);
  expect(types.includes('delete')).toBeTruthy();
  expect(types.includes('context')).toBeTruthy();
  expect(types.includes('add')).toBeFalsy();
});

test('buildDiffRows: multiline identical', () => {
  const text = 'line1\nline2\nline3';
  const rows = buildDiffRows(text, text);
  expect(rows.every((r) => r.type === 'context')).toBeTruthy();
  expect(rows.length).toBe(3);
});

test('buildDiffRows: completely different content', () => {
  const rows = buildDiffRows('foo\nbar', 'baz\nqux');
  expect(rows.every((r) => r.type === 'delete' || r.type === 'add')).toBeTruthy();
});

// ── parseTaskResult ───────────────────────────────────────────────────────────

test('parseTaskResult: plain string passthrough', () => {
  expect(parseTaskResult('hello world')).toBe('hello world');
});

test('parseTaskResult: non-JSON string passthrough', () => {
  expect(parseTaskResult('not { json }')).toBe('not { json }');
});

test('parseTaskResult: JSON array of text blocks joined', () => {
  const input = JSON.stringify([
    { type: 'text', text: 'first' },
    { type: 'text', text: 'second' },
  ]);
  expect(parseTaskResult(input)).toBe('first\n\nsecond');
});

test('parseTaskResult: non-text blocks filtered out', () => {
  const input = JSON.stringify([{ type: 'tool_use', id: 'x' }, { type: 'text', text: 'kept' }]);
  expect(parseTaskResult(input)).toBe('kept');
});

test('parseTaskResult: empty array returns empty string', () => {
  expect(parseTaskResult('[]')).toBe('');
});

test('parseTaskResult: JSON object (not array) passthrough', () => {
  const input = JSON.stringify({ type: 'text', text: 'hi' });
  expect(parseTaskResult(input)).toBe(input);
});

test('parseTaskResult: blocks missing text field filtered', () => {
  const input = JSON.stringify([{ type: 'text' }, { type: 'text', text: 'valid' }]);
  expect(parseTaskResult(input)).toBe('valid');
});

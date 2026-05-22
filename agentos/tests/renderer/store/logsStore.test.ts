import { test, expect } from 'vitest';
import { useLogsStore } from '../../../src/renderer/store/logsStore';
import type { AppLogEntry } from '../../../src/shared/types';

const MAX = 1000;

function reset() {
  useLogsStore.setState({ logs: [] });
}

function makeEntry(overrides: Partial<AppLogEntry> = {}): AppLogEntry {
  return { id: 'e1', level: 'info', message: 'msg', timestamp: Date.now(), ...overrides } as AppLogEntry;
}

function makeEntries(n: number): AppLogEntry[] {
  return Array.from({ length: n }, (_, i) => makeEntry({ id: `e${i}`, message: `msg-${i}` }));
}

// ── Initial state ─────────────────────────────────────────────────────────────

test('logsStore: initial logs is empty array', () => {
  reset();
  expect(useLogsStore.getState().logs).toEqual([]);
});

// ── setLogs ───────────────────────────────────────────────────────────────────

test('logsStore: setLogs replaces log list', () => {
  reset();
  useLogsStore.getState().setLogs([makeEntry({ id: 'a' }), makeEntry({ id: 'b' })]);
  expect(useLogsStore.getState().logs.length).toBe(2);
});

test('logsStore: setLogs truncates to last MAX entries', () => {
  reset();
  useLogsStore.getState().setLogs(makeEntries(MAX + 50));
  expect(useLogsStore.getState().logs.length).toBe(MAX);
  // should keep the LAST 1000
  expect(useLogsStore.getState().logs[MAX - 1].id).toBe(`e${MAX + 49}`);
});

// ── addLog ────────────────────────────────────────────────────────────────────

test('logsStore: addLog appends entry', () => {
  reset();
  useLogsStore.getState().addLog(makeEntry({ id: 'first', message: 'hello' }));
  expect(useLogsStore.getState().logs.length).toBe(1);
  expect(useLogsStore.getState().logs[0].message).toBe('hello');
});

test('logsStore: addLog respects MAX cap — evicts oldest', () => {
  reset();
  useLogsStore.getState().setLogs(makeEntries(MAX));
  useLogsStore.getState().addLog(makeEntry({ id: 'new', message: 'overflow' }));
  const logs = useLogsStore.getState().logs;
  expect(logs.length).toBe(MAX);
  expect(logs[MAX - 1].message).toBe('overflow');
  // oldest entry (e0) should be gone
  expect(logs.some((l) => l.id === 'e0')).toBeFalsy();
});

// ── addLogs ───────────────────────────────────────────────────────────────────

test('logsStore: addLogs appends multiple entries', () => {
  reset();
  useLogsStore.getState().addLogs([makeEntry({ id: 'a' }), makeEntry({ id: 'b' })]);
  expect(useLogsStore.getState().logs.length).toBe(2);
});

test('logsStore: addLogs empty array is no-op', () => {
  reset();
  useLogsStore.getState().addLog(makeEntry({ id: 'x' }));
  const before = useLogsStore.getState().logs;
  useLogsStore.getState().addLogs([]);
  expect(useLogsStore.getState().logs).toBe(before);
});

test('logsStore: addLogs truncates combined list to MAX', () => {
  reset();
  useLogsStore.getState().setLogs(makeEntries(MAX - 1));
  useLogsStore.getState().addLogs(makeEntries(10).map((e) => ({ ...e, id: `new-${e.id}` })));
  expect(useLogsStore.getState().logs.length).toBe(MAX);
});

// ── clearLogs ─────────────────────────────────────────────────────────────────

test('logsStore: clearLogs empties the list', () => {
  reset();
  useLogsStore.getState().addLogs(makeEntries(5));
  useLogsStore.getState().clearLogs();
  expect(useLogsStore.getState().logs).toEqual([]);
});

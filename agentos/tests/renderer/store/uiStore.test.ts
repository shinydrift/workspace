/**
 * Tests for src/renderer/store/uiStore.ts
 */

import { test, expect } from 'vitest';
import { useUIStore } from '../../../src/renderer/store/uiStore';

function reset() {
  useUIStore.setState({
    selectedThreadId: null,
    threadView: 'chat',
    sandboxBuildProgress: null,
    threadFilter: { query: '', status: 'all', sortBy: 'newest' },
    devMode: false,
  });
}

test('initial state defaults', () => {
  reset();
  const s = useUIStore.getState();
  expect(s.selectedThreadId).toBe(null);
  expect(s.threadView).toBe('chat');
  expect(s.sandboxBuildProgress).toBe(null);
  expect(s.devMode).toBe(false);
  expect(s.threadFilter).toEqual({ query: '', status: 'all', sortBy: 'newest' });
});

test('setSelectedThread sets selectedThreadId', () => {
  reset();
  useUIStore.getState().setSelectedThread('t-1');
  expect(useUIStore.getState().selectedThreadId).toBe('t-1');
});

test('setSelectedThread accepts null', () => {
  reset();
  useUIStore.getState().setSelectedThread('t-1');
  useUIStore.getState().setSelectedThread(null);
  expect(useUIStore.getState().selectedThreadId).toBe(null);
});

test('setThreadView switches to terminal', () => {
  reset();
  useUIStore.getState().setThreadView('terminal');
  expect(useUIStore.getState().threadView).toBe('terminal');
});

test('setThreadView switches back to chat', () => {
  reset();
  useUIStore.getState().setThreadView('terminal');
  useUIStore.getState().setThreadView('chat');
  expect(useUIStore.getState().threadView).toBe('chat');
});

test('setSandboxBuildProgress sets message', () => {
  reset();
  useUIStore.getState().setSandboxBuildProgress('Building image...');
  expect(useUIStore.getState().sandboxBuildProgress).toBe('Building image...');
});

test('setSandboxBuildProgress clears with null', () => {
  reset();
  useUIStore.getState().setSandboxBuildProgress('Building...');
  useUIStore.getState().setSandboxBuildProgress(null);
  expect(useUIStore.getState().sandboxBuildProgress).toBe(null);
});

test('setThreadFilter patches query', () => {
  reset();
  useUIStore.getState().setThreadFilter({ query: 'hello' });
  const f = useUIStore.getState().threadFilter;
  expect(f.query).toBe('hello');
  expect(f.status).toBe('all');
  expect(f.sortBy).toBe('newest');
});

test('setThreadFilter patches status without touching other fields', () => {
  reset();
  useUIStore.getState().setThreadFilter({ query: 'x' });
  useUIStore.getState().setThreadFilter({ status: 'running' });
  const f = useUIStore.getState().threadFilter;
  expect(f.query).toBe('x');
  expect(f.status).toBe('running');
});

test('setThreadFilter patches sortBy', () => {
  reset();
  useUIStore.getState().setThreadFilter({ sortBy: 'name' });
  expect(useUIStore.getState().threadFilter.sortBy).toBe('name');
});

test('setDevMode enables dev mode', () => {
  reset();
  useUIStore.getState().setDevMode(true);
  expect(useUIStore.getState().devMode).toBe(true);
});

test('setDevMode disables dev mode', () => {
  reset();
  useUIStore.getState().setDevMode(true);
  useUIStore.getState().setDevMode(false);
  expect(useUIStore.getState().devMode).toBe(false);
});

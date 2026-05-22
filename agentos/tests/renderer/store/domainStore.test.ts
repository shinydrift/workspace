/**
 * Tests for src/renderer/store/domainStore.ts
 *
 * Zustand stores are pure state — no DOM or Electron APIs required.
 * We reset the store between tests by calling setState directly.
 */

import { test, expect } from 'vitest';
import { useDomainStore } from '../../../src/renderer/store/domainStore';
import { useUIStore } from '../../../src/renderer/store/uiStore';
import type { Thread, AutomationJob, SavedProject } from '../../../src/shared/types';

function resetStores() {
  useDomainStore.setState({ threads: {}, threadsLoaded: false, automations: [], projects: {} });
  useUIStore.setState({ selectedThreadId: null });
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    name: 'Test Thread',
    status: 'idle',
    workingDirectory: '/tmp',
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    autopilot: false,
    createdAt: Date.now(),
    ...overrides,
  } as Thread;
}

function makeAutomation(overrides: Partial<AutomationJob> = {}): AutomationJob {
  return {
    id: 'auto-1',
    name: 'My Automation',
    prompt: 'do something',
    enabled: true,
    schedule: '* * * * *',
    createdAt: Date.now(),
    ...overrides,
  } as AutomationJob;
}

function makeProject(overrides: Partial<SavedProject> = {}): SavedProject {
  return {
    id: 'proj-1',
    name: 'My Project',
    path: '/tmp/project',
    createdAt: Date.now(),
    ...overrides,
  } as SavedProject;
}

// ── Thread tests ──────────────────────────────────────────────────────────────

test('initial state: threads empty, threadsLoaded false', () => {
  resetStores();
  const state = useDomainStore.getState();
  expect(state.threads).toEqual({});
  expect(state.threadsLoaded).toBe(false);
});

test('setThreads populates threads and sets threadsLoaded', () => {
  resetStores();
  const t1 = makeThread({ id: 'a' });
  const t2 = makeThread({ id: 'b' });
  useDomainStore.getState().setThreads([t1, t2]);
  const state = useDomainStore.getState();
  expect('a' in state.threads).toBeTruthy();
  expect('b' in state.threads).toBeTruthy();
  expect(state.threadsLoaded).toBe(true);
});

test('setThreads indexes threads by id', () => {
  resetStores();
  const t = makeThread({ id: 'xyz', name: 'Named' });
  useDomainStore.getState().setThreads([t]);
  expect(useDomainStore.getState().threads['xyz'].name).toBe('Named');
});

test('upsertThread adds a new thread', () => {
  resetStores();
  const t = makeThread({ id: 'new-1' });
  useDomainStore.getState().upsertThread(t);
  expect('new-1' in useDomainStore.getState().threads).toBeTruthy();
});

test('upsertThread overwrites existing thread', () => {
  resetStores();
  const t = makeThread({ id: 't1', name: 'Old' });
  useDomainStore.getState().upsertThread(t);
  useDomainStore.getState().upsertThread({ ...t, name: 'New' });
  expect(useDomainStore.getState().threads['t1'].name).toBe('New');
});

test('removeThread deletes thread from map', () => {
  resetStores();
  useDomainStore.getState().upsertThread(makeThread({ id: 'del-me' }));
  useDomainStore.getState().removeThread('del-me');
  expect('del-me' in useDomainStore.getState().threads).toBeFalsy();
});

test('removeThread clears selectedThreadId if it matches', () => {
  resetStores();
  useDomainStore.getState().upsertThread(makeThread({ id: 'sel' }));
  useUIStore.getState().setSelectedThread('sel');
  useDomainStore.getState().removeThread('sel');
  expect(useUIStore.getState().selectedThreadId).toBe(null);
});

test('removeThread does not clear selectedThreadId for other threads', () => {
  resetStores();
  useDomainStore.getState().upsertThread(makeThread({ id: 'a' }));
  useDomainStore.getState().upsertThread(makeThread({ id: 'b' }));
  useUIStore.getState().setSelectedThread('b');
  useDomainStore.getState().removeThread('a');
  expect(useUIStore.getState().selectedThreadId).toBe('b');
});

test('updateThreadStatus changes status and extra fields', () => {
  resetStores();
  useDomainStore.getState().upsertThread(makeThread({ id: 't', status: 'idle' }));
  useDomainStore.getState().updateThreadStatus('t', 'running');
  expect(useDomainStore.getState().threads['t'].status).toBe('running');
});

test('updateThreadStatus is a no-op for unknown thread id', () => {
  resetStores();
  const before = { ...useDomainStore.getState().threads };
  useDomainStore.getState().updateThreadStatus('nonexistent', 'running');
  expect(useDomainStore.getState().threads).toEqual(before);
});

test('renameThread changes thread name', () => {
  resetStores();
  useDomainStore.getState().upsertThread(makeThread({ id: 'r', name: 'Old' }));
  useDomainStore.getState().renameThread('r', 'New Name');
  expect(useDomainStore.getState().threads['r'].name).toBe('New Name');
});

test('renameThread is a no-op for unknown thread id', () => {
  resetStores();
  const before = { ...useDomainStore.getState().threads };
  useDomainStore.getState().renameThread('ghost', 'Whatever');
  expect(useDomainStore.getState().threads).toEqual(before);
});

// ── Automation tests ──────────────────────────────────────────────────────────

test('initial state: automations empty array', () => {
  resetStores();
  expect(useDomainStore.getState().automations).toEqual([]);
});

test('setAutomations replaces automation list', () => {
  resetStores();
  const jobs = [makeAutomation({ id: 'j1' }), makeAutomation({ id: 'j2' })];
  useDomainStore.getState().setAutomations(jobs);
  expect(useDomainStore.getState().automations.length).toBe(2);
});

test('upsertAutomation adds new job at front', () => {
  resetStores();
  useDomainStore.getState().setAutomations([makeAutomation({ id: 'old' })]);
  useDomainStore.getState().upsertAutomation(makeAutomation({ id: 'new' }));
  expect(useDomainStore.getState().automations[0].id).toBe('new');
});

test('upsertAutomation replaces existing job', () => {
  resetStores();
  useDomainStore.getState().setAutomations([makeAutomation({ id: 'x', name: 'Before' })]);
  useDomainStore.getState().upsertAutomation(makeAutomation({ id: 'x', name: 'After' }));
  const jobs = useDomainStore.getState().automations;
  expect(jobs.filter((j: AutomationJob) => j.id === 'x').length).toBe(1);
  expect(jobs.find((j: AutomationJob) => j.id === 'x').name).toBe('After');
});

test('removeAutomation removes job by id', () => {
  resetStores();
  useDomainStore.getState().setAutomations([makeAutomation({ id: 'del' }), makeAutomation({ id: 'keep' })]);
  useDomainStore.getState().removeAutomation('del');
  const jobs = useDomainStore.getState().automations;
  expect(jobs.some((j: AutomationJob) => j.id === 'del')).toBeFalsy();
  expect(jobs.some((j: AutomationJob) => j.id === 'keep')).toBeTruthy();
});

// ── Project tests ─────────────────────────────────────────────────────────────

test('initial state: projects empty', () => {
  resetStores();
  expect(useDomainStore.getState().projects).toEqual({});
});

test('setProjects indexes projects by id', () => {
  resetStores();
  useDomainStore.getState().setProjects([makeProject({ id: 'p1' }), makeProject({ id: 'p2' })]);
  const { projects } = useDomainStore.getState();
  expect('p1' in projects).toBeTruthy();
  expect('p2' in projects).toBeTruthy();
});

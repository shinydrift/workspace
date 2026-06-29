/**
 * Tests for the generic config merge — src/shared/config/merge.ts.
 * Verifies project-wins precedence, wholesale array replacement, and explicit-null semantics.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeConfig } from '../../../src/shared/config/merge';
import type { AppSettings, ProjectConfig } from '../../../src/shared/config/schema';

const APP: AppSettings = {
  claudeStreamJson: true,
  skipPermissions: true,
  maxLogBufferSize: 2000,
  persistDebugLogs: false,
  devMode: false,
  theme: 'dark',
  fontSize: 14,
  runOnHost: false,
  agents: {
    providerOrder: [{ provider: 'claude' }, { provider: 'codex' }],
    queueSilenceFallbackMs: 1500,
    autopilot: { enabled: true, maxConsecutiveTurns: 10, transcriptMessages: 25 },
  },
  worktree: { autoCreate: true, pruneOnStop: true },
  sandbox: {
    readOnlyRoot: false,
    dropAllCapabilities: true,
    noNewPrivileges: true,
    network: 'bridge',
    tmpfs: ['/tmp'],
  },
};

test('null project returns app unchanged', () => {
  assert.equal(mergeConfig(APP, null), APP);
  assert.equal(mergeConfig(APP, undefined), APP);
});

test('project scalar wins over app', () => {
  const merged = mergeConfig(APP, { runOnHost: true });
  assert.equal(merged.runOnHost, true);
  assert.equal(merged.devMode, false); // untouched app value preserved
});

test('nested objects deep-merge, project-wins per leaf', () => {
  const project: ProjectConfig = { worktree: { autoCreate: false } };
  const merged = mergeConfig(APP, project);
  assert.equal(merged.worktree?.autoCreate, false); // project wins
  assert.equal(merged.worktree?.pruneOnStop, true); // app value preserved
});

test('arrays are replaced wholesale, not element-merged', () => {
  const project: ProjectConfig = { agents: { providerOrder: [{ provider: 'gemini' }] } };
  const merged = mergeConfig(APP, project);
  assert.deepEqual(
    merged.agents.providerOrder.map((e) => e.provider),
    ['gemini']
  );
});

test('does not mutate the input app object', () => {
  const before = APP.worktree?.autoCreate;
  mergeConfig(APP, { worktree: { autoCreate: false } });
  assert.equal(APP.worktree?.autoCreate, before);
});

test('explicit null in project wins as a value', () => {
  // tailscale.authKey is nullable; an explicit null clears it.
  const merged = mergeConfig({ ...APP, tailscale: { authKey: 'live' } }, { tailscale: { authKey: null } });
  assert.equal(merged.tailscale?.authKey, null);
});

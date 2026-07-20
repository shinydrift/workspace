/**
 * Behavior tests for src/shared/effectiveProjectSettings.ts — the non-provider accessors
 * now derive from the generic mergeConfig (project-wins). Verifies precedence and the
 * preserved clamps / app-only autopilot semantics.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getEffectiveQueueSilenceFallbackMs,
  getEffectiveAutopilotSettings,
  getEffectiveWorktreeSettings,
  getEffectiveContainerPruneSettings,
  getEffectiveRunOnHost,
} from '../../src/shared/effectiveProjectSettings';
import type { AppSettings } from '../../src/shared/config/schema';

const APP: AppSettings = {
  claudeStreamJson: true,
  skipPermissions: true,
  maxLogBufferSize: 2000,
  persistDebugLogs: false,
  devMode: false,
  theme: 'dark',
  fontSize: 14,
  agents: {
    providerOrder: [{ provider: 'claude' }],
    queueSilenceFallbackMs: 1500,
    autopilot: { enabled: true, maxConsecutiveTurns: 10, transcriptMessages: 25, plannerProvider: 'claude' },
  },
  worktree: { autoCreate: true, pruneOnStop: true },
  containers: { pruneIdleHours: 24, pruneMaxAgeDays: 7 },
};

test('queue silence: project wins, clamped to >= 200', () => {
  assert.equal(getEffectiveQueueSilenceFallbackMs(APP, { agents: { queueSilenceFallbackMs: 3000 } }), 3000);
  assert.equal(getEffectiveQueueSilenceFallbackMs(APP, { agents: { queueSilenceFallbackMs: 10 } }), 200);
  assert.equal(getEffectiveQueueSilenceFallbackMs(APP, null), 1500);
});

test('autopilot: project overrides turns/transcript but NOT enabled/planner (app-only)', () => {
  const eff = getEffectiveAutopilotSettings(APP, {
    agents: { autopilot: { maxConsecutiveTurns: 3, transcriptMessages: 5 } },
  });
  assert.equal(eff.maxConsecutiveTurns, 3); // project wins
  assert.equal(eff.transcriptMessages, 5); // project wins
  assert.equal(eff.enabled, true); // app-controlled
  assert.equal(eff.plannerProvider, 'claude'); // app-controlled
});

test('autopilot: turns/transcript clamped to >= 1 and floored', () => {
  const eff = getEffectiveAutopilotSettings(APP, {
    agents: { autopilot: { maxConsecutiveTurns: 0, transcriptMessages: 7.9 } },
  });
  assert.equal(eff.maxConsecutiveTurns, 1);
  assert.equal(eff.transcriptMessages, 7);
});

test('worktree: project leaf wins, app leaf preserved, default fallback', () => {
  const eff = getEffectiveWorktreeSettings(APP, { worktree: { autoCreate: false } });
  assert.equal(eff.autoCreate, false);
  assert.equal(eff.pruneOnStop, true);
  // No app worktree → defaults apply.
  const eff2 = getEffectiveWorktreeSettings({ ...APP, worktree: undefined }, null);
  assert.equal(eff2.autoCreate, true);
  assert.equal(eff2.pruneOnStop, true);
});

test('container prune: project wins, renamed + clamped to >= 0 and floored', () => {
  const eff = getEffectiveContainerPruneSettings(APP, {
    containers: { pruneIdleHours: 5.6, pruneMaxAgeDays: -2 },
  });
  assert.equal(eff.idleHours, 5);
  assert.equal(eff.maxAgeDays, 0);
  // Falls back to app values when project absent.
  assert.deepEqual(getEffectiveContainerPruneSettings(APP, null), { idleHours: 24, maxAgeDays: 7 });
});

test('runOnHost: project overrides app; defaults to sandboxed (false)', () => {
  // Project wins over app in both directions.
  assert.equal(getEffectiveRunOnHost({ ...APP, runOnHost: false }, { runOnHost: true }), true);
  assert.equal(getEffectiveRunOnHost({ ...APP, runOnHost: true }, { runOnHost: false }), false);
  // Falls back to app when project absent, then to sandboxed default.
  assert.equal(getEffectiveRunOnHost({ ...APP, runOnHost: true }, null), true);
  assert.equal(getEffectiveRunOnHost(APP, null), false);
});

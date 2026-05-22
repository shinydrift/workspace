/**
 * Tests for utils/docker/ops.ts — computeContainerConfigHash, shouldPruneContainer (inlined).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// ── Inlined from ops.ts ───────────────────────────────────────────────────────

function computeContainerConfigHash(params) {
  const hashInput = JSON.stringify({
    threadId: params.threadId,
    workingDirectory: params.workingDirectory,
    imageName: params.imageName,
    provider: params.provider,
    sandbox: params.sandbox ?? {},
    providerArgs: params.providerArgs,
    extraReadonlyMounts: params.extraReadonlyMounts,
    dockerfileHash: params.dockerfileHash ?? null,
  });
  return crypto.createHash('sha256').update(hashInput).digest('hex');
}

function shouldPruneContainer(entry, now, idleHours, maxAgeDays) {
  const idleMs = now - entry.lastUsedAtMs;
  const ageMs = now - entry.createdAtMs;
  return (
    (idleHours > 0 && idleMs > idleHours * 60 * 60 * 1000) ||
    (maxAgeDays > 0 && ageMs > maxAgeDays * 24 * 60 * 60 * 1000)
  );
}

// ── computeContainerConfigHash ────────────────────────────────────────────────

const BASE_PARAMS = {
  threadId: 'thread-abc',
  workingDirectory: '/home/user/project',
  imageName: 'agentos-sandbox:latest',
  provider: 'claude',
  sandbox: {},
  providerArgs: [],
  extraReadonlyMounts: [],
  dockerfileHash: null,
};

test('computeContainerConfigHash returns a 64-char hex string', () => {
  const hash = computeContainerConfigHash(BASE_PARAMS);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test('same params produce same hash', () => {
  const a = computeContainerConfigHash(BASE_PARAMS);
  const b = computeContainerConfigHash({ ...BASE_PARAMS });
  assert.equal(a, b);
});

test('different threadId produces different hash', () => {
  const a = computeContainerConfigHash(BASE_PARAMS);
  const b = computeContainerConfigHash({ ...BASE_PARAMS, threadId: 'thread-xyz' });
  assert.notEqual(a, b);
});

test('different provider produces different hash', () => {
  const a = computeContainerConfigHash(BASE_PARAMS);
  const b = computeContainerConfigHash({ ...BASE_PARAMS, provider: 'codex' });
  assert.notEqual(a, b);
});

test('different imageName produces different hash', () => {
  const a = computeContainerConfigHash(BASE_PARAMS);
  const b = computeContainerConfigHash({ ...BASE_PARAMS, imageName: 'agentos-project-foo:latest' });
  assert.notEqual(a, b);
});

test('different providerArgs produces different hash', () => {
  const a = computeContainerConfigHash(BASE_PARAMS);
  const b = computeContainerConfigHash({ ...BASE_PARAMS, providerArgs: ['--dangerously-skip-permissions'] });
  assert.notEqual(a, b);
});

test('different extraReadonlyMounts produces different hash', () => {
  const a = computeContainerConfigHash(BASE_PARAMS);
  const b = computeContainerConfigHash({
    ...BASE_PARAMS,
    extraReadonlyMounts: [{ hostPath: '/agentos-memory', containerPath: '/agentos-memory' }],
  });
  assert.notEqual(a, b);
});

test('undefined sandbox treated same as empty object', () => {
  const withUndefined = computeContainerConfigHash({ ...BASE_PARAMS, sandbox: undefined });
  const withEmpty = computeContainerConfigHash({ ...BASE_PARAMS, sandbox: {} });
  assert.equal(withUndefined, withEmpty);
});

test('undefined dockerfileHash treated same as null', () => {
  const withUndefined = computeContainerConfigHash({ ...BASE_PARAMS, dockerfileHash: undefined });
  const withNull = computeContainerConfigHash({ ...BASE_PARAMS, dockerfileHash: null });
  assert.equal(withUndefined, withNull);
});

test('non-null dockerfileHash produces different hash', () => {
  const a = computeContainerConfigHash(BASE_PARAMS);
  const b = computeContainerConfigHash({ ...BASE_PARAMS, dockerfileHash: 'abc123' });
  assert.notEqual(a, b);
});

test('different sandbox content produces different hash', () => {
  const a = computeContainerConfigHash({ ...BASE_PARAMS, sandbox: { network: 'bridge' } });
  const b = computeContainerConfigHash({ ...BASE_PARAMS, sandbox: { network: 'none' } });
  assert.notEqual(a, b);
});

// ── shouldPruneContainer ──────────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

test('returns false when both thresholds are zero', () => {
  const now = Date.now();
  const entry = { lastUsedAtMs: now - 100 * HOUR_MS, createdAtMs: now - 200 * DAY_MS };
  assert.equal(shouldPruneContainer(entry, now, 0, 0), false);
});

test('returns false when container is not idle enough', () => {
  const now = Date.now();
  const entry = { lastUsedAtMs: now - 1 * HOUR_MS, createdAtMs: now - 10 * DAY_MS };
  assert.equal(shouldPruneContainer(entry, now, 24, 0), false);
});

test('returns true when container is idle beyond idleHours', () => {
  const now = Date.now();
  const entry = { lastUsedAtMs: now - 25 * HOUR_MS, createdAtMs: now - 1 * DAY_MS };
  assert.equal(shouldPruneContainer(entry, now, 24, 0), true);
});

test('returns false when container is not old enough', () => {
  const now = Date.now();
  const entry = { lastUsedAtMs: now - 100 * HOUR_MS, createdAtMs: now - 5 * DAY_MS };
  assert.equal(shouldPruneContainer(entry, now, 0, 7), false);
});

test('returns true when container exceeds maxAgeDays', () => {
  const now = Date.now();
  const entry = { lastUsedAtMs: now - 1 * HOUR_MS, createdAtMs: now - 8 * DAY_MS };
  assert.equal(shouldPruneContainer(entry, now, 0, 7), true);
});

test('returns true when either idle or age threshold is exceeded', () => {
  const now = Date.now();
  const idleEntry = { lastUsedAtMs: now - 25 * HOUR_MS, createdAtMs: now - 1 * DAY_MS };
  assert.equal(shouldPruneContainer(idleEntry, now, 24, 7), true);

  const agedEntry = { lastUsedAtMs: now - 1 * HOUR_MS, createdAtMs: now - 8 * DAY_MS };
  assert.equal(shouldPruneContainer(agedEntry, now, 24, 7), true);
});

test('returns false when neither threshold exceeded', () => {
  const now = Date.now();
  const entry = { lastUsedAtMs: now - 1 * HOUR_MS, createdAtMs: now - 1 * DAY_MS };
  assert.equal(shouldPruneContainer(entry, now, 24, 7), false);
});

test('boundary: exactly at idleHours threshold is not pruned', () => {
  const now = Date.now();
  const entry = { lastUsedAtMs: now - 24 * HOUR_MS, createdAtMs: now - 1 * DAY_MS };
  // exactly 24 hours idle, threshold is 24 — not > so not pruned
  assert.equal(shouldPruneContainer(entry, now, 24, 0), false);
});

test('boundary: one ms past idleHours threshold is pruned', () => {
  const now = Date.now();
  const entry = { lastUsedAtMs: now - 24 * HOUR_MS - 1, createdAtMs: now - 1 * DAY_MS };
  assert.equal(shouldPruneContainer(entry, now, 24, 0), true);
});

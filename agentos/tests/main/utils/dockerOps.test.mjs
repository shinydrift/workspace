/**
 * Tests for utils/docker/ops.ts — inspectContainer output parsing, computeContainerConfigHash,
 * and shouldPruneContainer (all inlined). No actual Docker calls are made.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// ── Inlined parsing logic from ops.ts ────────────────────────────────────────

function parseInspectOutput(stdout, code) {
  if (code !== 0) {
    return { exists: false, running: false, image: null, labels: {} };
  }

  const raw = stdout.trim();
  const [runningRaw = 'false', imageRaw = '', labelsRaw = '{}'] = raw.split('\t');
  let labels = {};
  try {
    labels = JSON.parse(labelsRaw);
  } catch {
    labels = {};
  }

  return {
    exists: true,
    running: runningRaw === 'true',
    image: imageRaw || null,
    labels,
  };
}

// ── tests ──────────────────────────────────────────────────────────────────────

test('non-zero code returns non-existent container', () => {
  const result = parseInspectOutput('', 1);
  assert.deepEqual(result, { exists: false, running: false, image: null, labels: {} });
});

test('running container parses correctly', () => {
  const stdout = 'true\tagentos-sandbox:latest\t{"app":"agentos","env":"sandbox"}';
  const result = parseInspectOutput(stdout, 0);
  assert.equal(result.exists, true);
  assert.equal(result.running, true);
  assert.equal(result.image, 'agentos-sandbox:latest');
  assert.deepEqual(result.labels, { app: 'agentos', env: 'sandbox' });
});

test('stopped container parses correctly', () => {
  const stdout = 'false\tagentos-sandbox:latest\t{}';
  const result = parseInspectOutput(stdout, 0);
  assert.equal(result.exists, true);
  assert.equal(result.running, false);
  assert.equal(result.image, 'agentos-sandbox:latest');
});

test('empty image raw becomes null', () => {
  const stdout = 'true\t\t{}';
  const result = parseInspectOutput(stdout, 0);
  assert.equal(result.image, null);
});

test('invalid JSON labels defaults to empty object', () => {
  const stdout = 'true\tsome-image\tnot-valid-json';
  const result = parseInspectOutput(stdout, 0);
  assert.deepEqual(result.labels, {});
});

test('labels with multiple key-value pairs', () => {
  const labels = { a: '1', b: '2', c: '3' };
  const stdout = `false\tmy-image\t${JSON.stringify(labels)}`;
  const result = parseInspectOutput(stdout, 0);
  assert.deepEqual(result.labels, labels);
});

// ── computeContainerConfigHash ────────────────────────────────────────────────

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

const BASE_PARAMS = {
  threadId: 't1',
  workingDirectory: '/workspace',
  imageName: 'agentos-sandbox:latest',
  provider: 'claude',
  sandbox: {},
  providerArgs: [],
  extraReadonlyMounts: [],
  dockerfileHash: null,
};

test('computeContainerConfigHash: returns 64-char hex string', () => {
  const hash = computeContainerConfigHash(BASE_PARAMS);
  assert.equal(hash.length, 64);
  assert.match(hash, /^[0-9a-f]+$/);
});

test('computeContainerConfigHash: deterministic for same params', () => {
  const h1 = computeContainerConfigHash(BASE_PARAMS);
  const h2 = computeContainerConfigHash(BASE_PARAMS);
  assert.equal(h1, h2);
});

test('computeContainerConfigHash: different threadId produces different hash', () => {
  const h1 = computeContainerConfigHash({ ...BASE_PARAMS, threadId: 'a' });
  const h2 = computeContainerConfigHash({ ...BASE_PARAMS, threadId: 'b' });
  assert.notEqual(h1, h2);
});

test('computeContainerConfigHash: different provider produces different hash', () => {
  const h1 = computeContainerConfigHash({ ...BASE_PARAMS, provider: 'claude' });
  const h2 = computeContainerConfigHash({ ...BASE_PARAMS, provider: 'codex' });
  assert.notEqual(h1, h2);
});

test('computeContainerConfigHash: null sandbox defaults to {}', () => {
  const h1 = computeContainerConfigHash({ ...BASE_PARAMS, sandbox: null });
  const h2 = computeContainerConfigHash({ ...BASE_PARAMS, sandbox: {} });
  assert.equal(h1, h2);
});

test('computeContainerConfigHash: undefined dockerfileHash defaults to null', () => {
  const h1 = computeContainerConfigHash({ ...BASE_PARAMS, dockerfileHash: undefined });
  const h2 = computeContainerConfigHash({ ...BASE_PARAMS, dockerfileHash: null });
  assert.equal(h1, h2);
});

test('computeContainerConfigHash: non-null dockerfileHash changes hash', () => {
  const h1 = computeContainerConfigHash({ ...BASE_PARAMS, dockerfileHash: null });
  const h2 = computeContainerConfigHash({ ...BASE_PARAMS, dockerfileHash: 'abc123' });
  assert.notEqual(h1, h2);
});

test('computeContainerConfigHash: providerArgs order matters', () => {
  const h1 = computeContainerConfigHash({ ...BASE_PARAMS, providerArgs: ['--foo', '--bar'] });
  const h2 = computeContainerConfigHash({ ...BASE_PARAMS, providerArgs: ['--bar', '--foo'] });
  assert.notEqual(h1, h2);
});

test('computeContainerConfigHash: extraReadonlyMounts included in hash', () => {
  const h1 = computeContainerConfigHash({ ...BASE_PARAMS, extraReadonlyMounts: [] });
  const h2 = computeContainerConfigHash({ ...BASE_PARAMS, extraReadonlyMounts: [{ hostPath: '/x', containerPath: '/y' }] });
  assert.notEqual(h1, h2);
});

// ── shouldPruneContainer ──────────────────────────────────────────────────────

function shouldPruneContainer(entry, now, idleHours, maxAgeDays) {
  const idleMs = now - entry.lastUsedAtMs;
  const ageMs = now - entry.createdAtMs;
  return (
    (idleHours > 0 && idleMs > idleHours * 60 * 60 * 1000) ||
    (maxAgeDays > 0 && ageMs > maxAgeDays * 24 * 60 * 60 * 1000)
  );
}

const NOW = 1_000_000_000_000; // fixed reference time

test('shouldPruneContainer: idle beyond threshold returns true', () => {
  const entry = { lastUsedAtMs: NOW - 3 * 60 * 60 * 1000, createdAtMs: NOW - 3 * 60 * 60 * 1000 };
  assert.equal(shouldPruneContainer(entry, NOW, 2, 0), true);
});

test('shouldPruneContainer: idle within threshold returns false', () => {
  const entry = { lastUsedAtMs: NOW - 1 * 60 * 60 * 1000, createdAtMs: NOW - 1 * 60 * 60 * 1000 };
  assert.equal(shouldPruneContainer(entry, NOW, 2, 0), false);
});

test('shouldPruneContainer: age beyond maxAgeDays returns true', () => {
  const entry = { lastUsedAtMs: NOW - 1000, createdAtMs: NOW - 8 * 24 * 60 * 60 * 1000 };
  assert.equal(shouldPruneContainer(entry, NOW, 0, 7), true);
});

test('shouldPruneContainer: age within maxAgeDays returns false', () => {
  const entry = { lastUsedAtMs: NOW - 1000, createdAtMs: NOW - 5 * 24 * 60 * 60 * 1000 };
  assert.equal(shouldPruneContainer(entry, NOW, 0, 7), false);
});

test('shouldPruneContainer: idleHours=0 disables idle check', () => {
  const entry = { lastUsedAtMs: 0, createdAtMs: NOW - 1 };
  assert.equal(shouldPruneContainer(entry, NOW, 0, 0), false);
});

test('shouldPruneContainer: maxAgeDays=0 disables age check', () => {
  const entry = { lastUsedAtMs: NOW - 1000, createdAtMs: 0 };
  assert.equal(shouldPruneContainer(entry, NOW, 0, 0), false);
});

test('shouldPruneContainer: both conditions true returns true', () => {
  const entry = { lastUsedAtMs: NOW - 10 * 60 * 60 * 1000, createdAtMs: NOW - 30 * 24 * 60 * 60 * 1000 };
  assert.equal(shouldPruneContainer(entry, NOW, 2, 7), true);
});

test('shouldPruneContainer: exactly at idle boundary not pruned', () => {
  const idleHours = 2;
  const entry = { lastUsedAtMs: NOW - idleHours * 60 * 60 * 1000, createdAtMs: NOW };
  assert.equal(shouldPruneContainer(entry, NOW, idleHours, 0), false);
});

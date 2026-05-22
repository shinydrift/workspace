/**
 * Tests for ipc/handlers/sandboxHandlers.ts — schema validation logic (inlined).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined constraints from sandboxHandlers.ts ───────────────────────────────

const CONTAINER_NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

function validateRemoveContainer(req) {
  if (!req || typeof req !== 'object') return false;
  if (typeof req.containerName !== 'string') return false;
  if (req.containerName.length < 1 || req.containerName.length > 128) return false;
  if (!CONTAINER_NAME_PATTERN.test(req.containerName)) return false;
  return true;
}

// ── RemoveContainerSchema ─────────────────────────────────────────────────────

test('RemoveContainer: valid simple name', () => {
  assert.ok(validateRemoveContainer({ containerName: 'my-container' }));
});

test('RemoveContainer: valid alphanumeric name', () => {
  assert.ok(validateRemoveContainer({ containerName: 'container123' }));
});

test('RemoveContainer: valid name with dots and underscores', () => {
  assert.ok(validateRemoveContainer({ containerName: 'arc_thread.v1' }));
});

test('RemoveContainer: valid name exactly 128 chars', () => {
  assert.ok(validateRemoveContainer({ containerName: 'a'.repeat(128) }));
});

test('RemoveContainer: rejects empty name', () => {
  assert.ok(!validateRemoveContainer({ containerName: '' }));
});

test('RemoveContainer: rejects name over 128 chars', () => {
  assert.ok(!validateRemoveContainer({ containerName: 'a'.repeat(129) }));
});

test('RemoveContainer: rejects name with spaces', () => {
  assert.ok(!validateRemoveContainer({ containerName: 'my container' }));
});

test('RemoveContainer: rejects name with slashes', () => {
  assert.ok(!validateRemoveContainer({ containerName: 'my/container' }));
});

test('RemoveContainer: rejects name with special chars', () => {
  assert.ok(!validateRemoveContainer({ containerName: 'container@1' }));
  assert.ok(!validateRemoveContainer({ containerName: 'container:latest' }));
});

test('RemoveContainer: rejects non-string containerName', () => {
  assert.ok(!validateRemoveContainer({ containerName: 42 }));
  assert.ok(!validateRemoveContainer({ containerName: null }));
});

test('RemoveContainer: rejects missing containerName', () => {
  assert.ok(!validateRemoveContainer({}));
});

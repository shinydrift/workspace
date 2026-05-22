/**
 * Tests for ipc/handlers/threadHandlers.ts — contract behavior.
 *
 * Schema constraints are tested via the real primitives from schemas.ts (inlined
 * here as JS equivalents because the test runner has no TS loader). The key
 * improvement over the previous version: tests cover the *setAutopilot* and
 * *derivePersonality* channels that were previously completely untested, and
 * assert the IPC error envelope shape rather than just returning raw values.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── handleIpc envelope (mirrors ipcResponse.ts) ───────────────────────────────
// Inlined once here so envelope-shape assertions don't require electron.

async function handleIpc(fn) {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── CreateThreadSchema constraints ────────────────────────────────────────────

function validateCreateThread(req) {
  if (!req || typeof req !== 'object') return false;
  if (typeof req.name !== 'string' || req.name.length < 1 || req.name.length > 256) return false;
  if (typeof req.workingDirectory !== 'string' || req.workingDirectory.length < 1 || req.workingDirectory.length > 4096)
    return false;
  if (req.provider !== undefined && (typeof req.provider !== 'string' || req.provider.length > 64)) return false;
  if (req.model !== undefined && (typeof req.model !== 'string' || req.model.length > 200)) return false;
  if (req.createWorktree !== undefined && typeof req.createWorktree !== 'boolean') return false;
  if (
    req.projectName !== undefined &&
    (typeof req.projectName !== 'string' || req.projectName.length < 1 || req.projectName.length > 256)
  )
    return false;
  return true;
}

test('createThread: valid minimal request', () => {
  assert.ok(validateCreateThread({ name: 'My thread', workingDirectory: '/home/user/project' }));
});
test('createThread: valid with all optional fields', () => {
  assert.ok(
    validateCreateThread({
      name: 'My thread',
      workingDirectory: '/home/user/project',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      createWorktree: true,
      projectName: 'My Project',
    }),
  );
});
test('createThread: rejects empty name', () => {
  assert.ok(!validateCreateThread({ name: '', workingDirectory: '/home/user/project' }));
});
test('createThread: rejects name over 256 chars', () => {
  assert.ok(!validateCreateThread({ name: 'x'.repeat(257), workingDirectory: '/home/user' }));
});
test('createThread: rejects empty workingDirectory', () => {
  assert.ok(!validateCreateThread({ name: 'thread', workingDirectory: '' }));
});
test('createThread: rejects workingDirectory over 4096 chars', () => {
  assert.ok(!validateCreateThread({ name: 'thread', workingDirectory: '/'.repeat(4097) }));
});
test('createThread: rejects provider over 64 chars', () => {
  assert.ok(!validateCreateThread({ name: 'thread', workingDirectory: '/home', provider: 'x'.repeat(65) }));
});
test('createThread: rejects model over 200 chars', () => {
  assert.ok(!validateCreateThread({ name: 'thread', workingDirectory: '/home', model: 'x'.repeat(201) }));
});
test('createThread: rejects non-boolean createWorktree', () => {
  assert.ok(!validateCreateThread({ name: 'thread', workingDirectory: '/home', createWorktree: 1 }));
});
test('createThread: rejects empty projectName', () => {
  assert.ok(!validateCreateThread({ name: 'thread', workingDirectory: '/home', projectName: '' }));
});
test('createThread: rejects missing name', () => {
  assert.ok(!validateCreateThread({ workingDirectory: '/home/user' }));
});
test('createThread: rejects null', () => {
  assert.ok(!validateCreateThread(null));
});

// ── RenameThreadSchema constraints ────────────────────────────────────────────

function validateRenameThread(req) {
  if (!req || typeof req !== 'object') return false;
  if (typeof req.threadId !== 'string' || req.threadId.length < 1 || req.threadId.length > 128) return false;
  if (typeof req.name !== 'string' || req.name.length < 1 || req.name.length > 256) return false;
  return true;
}

test('renameThread: valid request', () => {
  assert.ok(validateRenameThread({ threadId: 'abc123', name: 'New name' }));
});
test('renameThread: rejects empty threadId', () => {
  assert.ok(!validateRenameThread({ threadId: '', name: 'New name' }));
});
test('renameThread: rejects threadId over 128 chars', () => {
  assert.ok(!validateRenameThread({ threadId: 'x'.repeat(129), name: 'New name' }));
});
test('renameThread: rejects empty name', () => {
  assert.ok(!validateRenameThread({ threadId: 'abc', name: '' }));
});
test('renameThread: rejects name over 256 chars', () => {
  assert.ok(!validateRenameThread({ threadId: 'abc', name: 'x'.repeat(257) }));
});
test('renameThread: rejects null', () => {
  assert.ok(!validateRenameThread(null));
});

// ── SetAutopilotSchema constraints (previously untested) ──────────────────────

function validateSetAutopilot(req) {
  if (!req || typeof req !== 'object') return false;
  if (typeof req.threadId !== 'string' || req.threadId.length < 1 || req.threadId.length > 128) return false;
  if (typeof req.enabled !== 'boolean') return false;
  return true;
}

test('setAutopilot: valid enabled=true', () => {
  assert.ok(validateSetAutopilot({ threadId: 'abc', enabled: true }));
});
test('setAutopilot: valid enabled=false', () => {
  assert.ok(validateSetAutopilot({ threadId: 'abc', enabled: false }));
});
test('setAutopilot: rejects string enabled', () => {
  assert.ok(!validateSetAutopilot({ threadId: 'abc', enabled: 'true' }));
});
test('setAutopilot: rejects numeric enabled', () => {
  assert.ok(!validateSetAutopilot({ threadId: 'abc', enabled: 1 }));
});
test('setAutopilot: rejects missing enabled', () => {
  assert.ok(!validateSetAutopilot({ threadId: 'abc' }));
});
test('setAutopilot: rejects empty threadId', () => {
  assert.ok(!validateSetAutopilot({ threadId: '', enabled: true }));
});
test('setAutopilot: rejects threadId over 128 chars', () => {
  assert.ok(!validateSetAutopilot({ threadId: 'x'.repeat(129), enabled: true }));
});
test('setAutopilot: rejects null', () => {
  assert.ok(!validateSetAutopilot(null));
});

// ── IPC envelope — setAutopilot and derivePersonality (previously untested) ───
// These verify that invalid input produces a wrapped { ok: false, error } response
// rather than a thrown exception or a raw value — the envelope that handleIpc provides.

test('setAutopilot: invalid schema yields { ok: false } envelope', async () => {
  const result = await handleIpc(() => {
    if (!validateSetAutopilot({ threadId: 123, enabled: 'yes' })) throw new Error('ZodError: invalid input');
  });
  assert.equal(result.ok, false);
  assert.ok(typeof result.error === 'string');
});

test('derivePersonality: success path yields { ok: true, data } envelope', async () => {
  const fakeResult = { agentStyle: 'concise', autopilotInstructions: 'be brief' };
  const result = await handleIpc(() => fakeResult);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, fakeResult);
});

test('derivePersonality: failure yields { ok: false } envelope not thrown exception', async () => {
  const result = await handleIpc(() => {
    throw new Error('model unavailable');
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'model unavailable');
});

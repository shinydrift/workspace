/**
 * Tests for ipc/handlers/councilHandlers.ts — schema validation and IPC envelope.
 *
 * Validators are inlined as JS equivalents (no TS loader in this test runner).
 * Covers all 8 IPC channels: LIST_CONFIGS, GET_CONFIG, UPSERT_CONFIG,
 * DELETE_CONFIG, RUN, GET_RUN, GET_OUTCOMES, LIST_RUNS_BY_THREAD.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── handleIpc envelope (mirrors ipcResponse.ts) ───────────────────────────────

async function handleIpc(fn) {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Member schema (mirrors councilHandlers.ts > memberSchema) ─────────────────

const PROVIDERS = ['claude', 'codex', 'gemini'];
const EFFORT_VALUES = ['low', 'medium', 'high', 'extra-high', 'max'];
const REASONING_VALUES = ['low', 'medium', 'high', 'extra-high'];

function validateMember(m) {
  if (!m || typeof m !== 'object') return false;
  if (!PROVIDERS.includes(m.provider)) return false;
  if (typeof m.model !== 'string' || m.model.length < 1 || m.model.length > 128) return false;
  if (m.effort !== undefined && !EFFORT_VALUES.includes(m.effort)) return false;
  if (m.reasoning !== undefined && !REASONING_VALUES.includes(m.reasoning)) return false;
  return true;
}

// ── COUNCIL_GET_CONFIG / DELETE_CONFIG (id schema) ────────────────────────────

function validateConfigId(req) {
  if (!req || typeof req !== 'object') return false;
  if (typeof req.id !== 'string' || req.id.length < 1) return false;
  return true;
}

// ── COUNCIL_UPSERT_CONFIG ─────────────────────────────────────────────────────

function validateUpsertConfig(req) {
  if (!req || typeof req !== 'object') return false;
  if (req.id !== undefined && (typeof req.id !== 'string' || req.id.length < 1)) return false;
  if (typeof req.name !== 'string' || req.name.length < 1 || req.name.length > 128) return false;
  if (!Array.isArray(req.members) || req.members.length < 1 || req.members.length > 8) return false;
  if (req.members.some((m) => !validateMember(m))) return false;
  return true;
}

// ── COUNCIL_RUN ───────────────────────────────────────────────────────────────

function validateRunCouncil(req) {
  if (!req || typeof req !== 'object') return false;
  if (typeof req.configId !== 'string' || req.configId.length < 1) return false;
  if (typeof req.parentThreadId !== 'string' || req.parentThreadId.length < 1) return false;
  if (typeof req.prompt !== 'string' || req.prompt.length < 1 || req.prompt.length > 50_000) return false;
  return true;
}

// ── COUNCIL_GET_RUN / GET_OUTCOMES (runId schema) ─────────────────────────────

function validateRunId(req) {
  if (!req || typeof req !== 'object') return false;
  if (typeof req.runId !== 'string' || req.runId.length < 1) return false;
  return true;
}

// ── COUNCIL_LIST_RUNS_BY_THREAD ───────────────────────────────────────────────

function validateListRunsByThread(req) {
  if (!req || typeof req !== 'object') return false;
  if (typeof req.parentThreadId !== 'string' || req.parentThreadId.length < 1) return false;
  return true;
}

// ── memberSchema ──────────────────────────────────────────────────────────────

test('member: valid minimal (provider + model)', () => {
  assert.ok(validateMember({ provider: 'claude', model: 'claude-opus-4-7' }));
});

test('member: valid with all optional fields', () => {
  assert.ok(validateMember({ provider: 'gemini', model: 'gemini-2.0-flash', effort: 'high', reasoning: 'medium' }));
});

test('member: all providers accepted', () => {
  for (const provider of PROVIDERS) {
    assert.ok(validateMember({ provider, model: 'some-model' }), `${provider} should be valid`);
  }
});

test('member: rejects unknown provider', () => {
  assert.ok(!validateMember({ provider: 'openai', model: 'gpt-4' }));
});

test('member: rejects empty model', () => {
  assert.ok(!validateMember({ provider: 'claude', model: '' }));
});

test('member: rejects model over 128 chars', () => {
  assert.ok(!validateMember({ provider: 'claude', model: 'x'.repeat(129) }));
});

test('member: accepts model exactly 128 chars', () => {
  assert.ok(validateMember({ provider: 'claude', model: 'x'.repeat(128) }));
});

test('member: all effort values accepted', () => {
  for (const effort of EFFORT_VALUES) {
    assert.ok(validateMember({ provider: 'claude', model: 'm', effort }), `effort ${effort} should be valid`);
  }
});

test('member: rejects invalid effort value', () => {
  assert.ok(!validateMember({ provider: 'claude', model: 'm', effort: 'ultra' }));
});

test('member: all reasoning values accepted', () => {
  for (const reasoning of REASONING_VALUES) {
    assert.ok(validateMember({ provider: 'claude', model: 'm', reasoning }), `reasoning ${reasoning} should be valid`);
  }
});

test('member: rejects invalid reasoning value', () => {
  assert.ok(!validateMember({ provider: 'claude', model: 'm', reasoning: 'max' }));
});

test('member: rejects null', () => {
  assert.ok(!validateMember(null));
});

// ── COUNCIL_LIST_CONFIGS ──────────────────────────────────────────────────────
// Channel accepts z.undefined() — no request payload.

test('COUNCIL_LIST_CONFIGS: success envelope with no input', async () => {
  const result = await handleIpc(() => []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, []);
});

test('COUNCIL_LIST_CONFIGS: error propagates as { ok: false }', async () => {
  const result = await handleIpc(() => {
    throw new Error('db unavailable');
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'db unavailable');
});

// ── COUNCIL_GET_CONFIG ────────────────────────────────────────────────────────

test('COUNCIL_GET_CONFIG: valid id', () => {
  assert.ok(validateConfigId({ id: 'cfg-abc123' }));
});

test('COUNCIL_GET_CONFIG: rejects empty id', () => {
  assert.ok(!validateConfigId({ id: '' }));
});

test('COUNCIL_GET_CONFIG: rejects missing id', () => {
  assert.ok(!validateConfigId({}));
});

test('COUNCIL_GET_CONFIG: rejects numeric id', () => {
  assert.ok(!validateConfigId({ id: 42 }));
});

test('COUNCIL_GET_CONFIG: rejects null', () => {
  assert.ok(!validateConfigId(null));
});

test('COUNCIL_GET_CONFIG: invalid id yields { ok: false } envelope', async () => {
  const result = await handleIpc(() => {
    if (!validateConfigId({ id: '' })) throw new Error('ZodError: invalid id');
  });
  assert.equal(result.ok, false);
  assert.ok(typeof result.error === 'string');
});

// ── COUNCIL_DELETE_CONFIG ─────────────────────────────────────────────────────

test('COUNCIL_DELETE_CONFIG: valid id', () => {
  assert.ok(validateConfigId({ id: 'cfg-to-delete' }));
});

test('COUNCIL_DELETE_CONFIG: rejects empty id', () => {
  assert.ok(!validateConfigId({ id: '' }));
});

test('COUNCIL_DELETE_CONFIG: success envelope (void return)', async () => {
  const result = await handleIpc(() => undefined);
  assert.equal(result.ok, true);
  assert.equal(result.data, undefined);
});

// ── COUNCIL_UPSERT_CONFIG ─────────────────────────────────────────────────────

const validMember = { provider: 'claude', model: 'claude-opus-4-7' };

test('COUNCIL_UPSERT_CONFIG: valid minimal (no id)', () => {
  assert.ok(validateUpsertConfig({ name: 'My Council', members: [validMember] }));
});

test('COUNCIL_UPSERT_CONFIG: valid with optional id', () => {
  assert.ok(validateUpsertConfig({ id: 'cfg-1', name: 'My Council', members: [validMember] }));
});

test('COUNCIL_UPSERT_CONFIG: valid with 8 members (max)', () => {
  assert.ok(validateUpsertConfig({ name: 'Full Council', members: Array(8).fill(validMember) }));
});

test('COUNCIL_UPSERT_CONFIG: rejects 9 members (over max)', () => {
  assert.ok(!validateUpsertConfig({ name: 'Council', members: Array(9).fill(validMember) }));
});

test('COUNCIL_UPSERT_CONFIG: rejects empty members array', () => {
  assert.ok(!validateUpsertConfig({ name: 'Council', members: [] }));
});

test('COUNCIL_UPSERT_CONFIG: rejects empty name', () => {
  assert.ok(!validateUpsertConfig({ name: '', members: [validMember] }));
});

test('COUNCIL_UPSERT_CONFIG: rejects name over 128 chars', () => {
  assert.ok(!validateUpsertConfig({ name: 'x'.repeat(129), members: [validMember] }));
});

test('COUNCIL_UPSERT_CONFIG: accepts name exactly 128 chars', () => {
  assert.ok(validateUpsertConfig({ name: 'x'.repeat(128), members: [validMember] }));
});

test('COUNCIL_UPSERT_CONFIG: rejects invalid member in array', () => {
  assert.ok(!validateUpsertConfig({ name: 'Council', members: [{ provider: 'unknown', model: 'm' }] }));
});

test('COUNCIL_UPSERT_CONFIG: rejects member with empty model', () => {
  assert.ok(!validateUpsertConfig({ name: 'Council', members: [{ provider: 'claude', model: '' }] }));
});

test('COUNCIL_UPSERT_CONFIG: rejects empty optional id', () => {
  assert.ok(!validateUpsertConfig({ id: '', name: 'Council', members: [validMember] }));
});

test('COUNCIL_UPSERT_CONFIG: mixed valid and invalid member triggers rejection', () => {
  const badMember = { provider: 'badprovider', model: 'x' };
  assert.ok(!validateUpsertConfig({ name: 'Council', members: [validMember, badMember] }));
});

test('COUNCIL_UPSERT_CONFIG: rejects non-array members', () => {
  assert.ok(!validateUpsertConfig({ name: 'Council', members: 'claude' }));
});

test('COUNCIL_UPSERT_CONFIG: rejects null', () => {
  assert.ok(!validateUpsertConfig(null));
});

test('COUNCIL_UPSERT_CONFIG: invalid input yields { ok: false } envelope', async () => {
  const result = await handleIpc(() => {
    if (!validateUpsertConfig({ name: '', members: [] })) throw new Error('ZodError: invalid config');
  });
  assert.equal(result.ok, false);
  assert.ok(typeof result.error === 'string');
});

// ── COUNCIL_RUN ───────────────────────────────────────────────────────────────

test('COUNCIL_RUN: valid request', () => {
  assert.ok(validateRunCouncil({ configId: 'cfg-1', parentThreadId: 'th-1', prompt: 'What should I build?' }));
});

test('COUNCIL_RUN: rejects empty configId', () => {
  assert.ok(!validateRunCouncil({ configId: '', parentThreadId: 'th-1', prompt: 'hello' }));
});

test('COUNCIL_RUN: rejects empty parentThreadId', () => {
  assert.ok(!validateRunCouncil({ configId: 'cfg-1', parentThreadId: '', prompt: 'hello' }));
});

test('COUNCIL_RUN: rejects empty prompt', () => {
  assert.ok(!validateRunCouncil({ configId: 'cfg-1', parentThreadId: 'th-1', prompt: '' }));
});

test('COUNCIL_RUN: rejects prompt over 50000 chars', () => {
  assert.ok(!validateRunCouncil({ configId: 'cfg-1', parentThreadId: 'th-1', prompt: 'x'.repeat(50_001) }));
});

test('COUNCIL_RUN: accepts prompt exactly 50000 chars', () => {
  assert.ok(validateRunCouncil({ configId: 'cfg-1', parentThreadId: 'th-1', prompt: 'x'.repeat(50_000) }));
});

test('COUNCIL_RUN: rejects null', () => {
  assert.ok(!validateRunCouncil(null));
});

test('COUNCIL_RUN: success path yields { ok: true, data } envelope', async () => {
  const fakeRun = { id: 'run-abc', status: 'running', parentThreadId: 'th-1' };
  const result = await handleIpc(async () => fakeRun);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, fakeRun);
});

test('COUNCIL_RUN: service error yields { ok: false } envelope', async () => {
  const result = await handleIpc(async () => {
    throw new Error('council service unavailable');
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'council service unavailable');
});

// ── COUNCIL_GET_RUN ───────────────────────────────────────────────────────────

test('COUNCIL_GET_RUN: valid runId', () => {
  assert.ok(validateRunId({ runId: 'run-abc123' }));
});

test('COUNCIL_GET_RUN: rejects empty runId', () => {
  assert.ok(!validateRunId({ runId: '' }));
});

test('COUNCIL_GET_RUN: rejects missing runId', () => {
  assert.ok(!validateRunId({}));
});

test('COUNCIL_GET_RUN: rejects numeric runId', () => {
  assert.ok(!validateRunId({ runId: 42 }));
});

test('COUNCIL_GET_RUN: rejects null', () => {
  assert.ok(!validateRunId(null));
});

test('COUNCIL_GET_RUN: success path yields { ok: true, data } envelope', async () => {
  const fakeRun = { id: 'run-xyz', status: 'done', parentThreadId: 'th-2' };
  const result = await handleIpc(() => fakeRun);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, fakeRun);
});

// ── COUNCIL_GET_OUTCOMES ──────────────────────────────────────────────────────

test('COUNCIL_GET_OUTCOMES: valid runId', () => {
  assert.ok(validateRunId({ runId: 'run-outcomes-1' }));
});

test('COUNCIL_GET_OUTCOMES: rejects empty runId', () => {
  assert.ok(!validateRunId({ runId: '' }));
});

test('COUNCIL_GET_OUTCOMES: rejects missing runId', () => {
  assert.ok(!validateRunId({}));
});

test('COUNCIL_GET_OUTCOMES: rejects numeric runId', () => {
  assert.ok(!validateRunId({ runId: 42 }));
});

test('COUNCIL_GET_OUTCOMES: success path yields array in { ok: true } envelope', async () => {
  const fakeOutcomes = [{ memberId: 'm1', text: 'option A' }, { memberId: 'm2', text: 'option B' }];
  const result = await handleIpc(() => fakeOutcomes);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, fakeOutcomes);
});

test('COUNCIL_GET_OUTCOMES: invalid runId yields { ok: false } envelope', async () => {
  const result = await handleIpc(() => {
    if (!validateRunId({ runId: '' })) throw new Error('ZodError: invalid runId');
  });
  assert.equal(result.ok, false);
  assert.ok(typeof result.error === 'string');
});

// ── COUNCIL_LIST_RUNS_BY_THREAD ───────────────────────────────────────────────

test('COUNCIL_LIST_RUNS_BY_THREAD: valid parentThreadId', () => {
  assert.ok(validateListRunsByThread({ parentThreadId: 'th-abc123' }));
});

test('COUNCIL_LIST_RUNS_BY_THREAD: rejects empty parentThreadId', () => {
  assert.ok(!validateListRunsByThread({ parentThreadId: '' }));
});

test('COUNCIL_LIST_RUNS_BY_THREAD: rejects missing parentThreadId', () => {
  assert.ok(!validateListRunsByThread({}));
});

test('COUNCIL_LIST_RUNS_BY_THREAD: rejects numeric parentThreadId', () => {
  assert.ok(!validateListRunsByThread({ parentThreadId: 99 }));
});

test('COUNCIL_LIST_RUNS_BY_THREAD: rejects null', () => {
  assert.ok(!validateListRunsByThread(null));
});

test('COUNCIL_LIST_RUNS_BY_THREAD: success path yields array in { ok: true } envelope', async () => {
  const fakeRuns = [{ id: 'run-1', status: 'done' }, { id: 'run-2', status: 'running' }];
  const result = await handleIpc(() => fakeRuns);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, fakeRuns);
});

test('COUNCIL_LIST_RUNS_BY_THREAD: invalid input yields { ok: false } envelope', async () => {
  const result = await handleIpc(() => {
    if (!validateListRunsByThread({ parentThreadId: '' })) throw new Error('ZodError: invalid parentThreadId');
  });
  assert.equal(result.ok, false);
  assert.ok(typeof result.error === 'string');
});

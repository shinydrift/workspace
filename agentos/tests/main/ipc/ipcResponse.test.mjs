/**
 * Tests for ipc/ipcResponse.ts — handleIpc success and error paths.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from ipcResponse.ts ───────────────────────────────────────────────

async function handleIpc(fn) {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── success path ──────────────────────────────────────────────────────────────

test('handleIpc returns ok:true with data on success', async () => {
  const result = await handleIpc(() => 42);
  assert.deepEqual(result, { ok: true, data: 42 });
});

test('handleIpc wraps async function data', async () => {
  const result = await handleIpc(async () => 'hello');
  assert.deepEqual(result, { ok: true, data: 'hello' });
});

test('handleIpc returns ok:true with undefined data when fn returns void', async () => {
  const result = await handleIpc(() => {});
  assert.equal(result.ok, true);
  assert.equal(result.data, undefined);
});

test('handleIpc returns ok:true with null data', async () => {
  const result = await handleIpc(() => null);
  assert.deepEqual(result, { ok: true, data: null });
});

test('handleIpc returns ok:true with object data', async () => {
  const result = await handleIpc(() => ({ foo: 'bar' }));
  assert.deepEqual(result, { ok: true, data: { foo: 'bar' } });
});

// ── error path ────────────────────────────────────────────────────────────────

test('handleIpc returns ok:false with error message on thrown Error', async () => {
  const result = await handleIpc(() => {
    throw new Error('something went wrong');
  });
  assert.deepEqual(result, { ok: false, error: 'something went wrong' });
});

test('handleIpc returns ok:false with string representation of non-Error throw', async () => {
  const result = await handleIpc(() => {
    throw 'plain string error';
  });
  assert.deepEqual(result, { ok: false, error: 'plain string error' });
});

test('handleIpc catches rejected promises', async () => {
  const result = await handleIpc(() => Promise.reject(new Error('async fail')));
  assert.deepEqual(result, { ok: false, error: 'async fail' });
});

test('handleIpc converts non-Error objects to string', async () => {
  const result = await handleIpc(() => {
    throw { code: 42 };
  });
  assert.equal(result.ok, false);
  assert.ok(typeof result.error === 'string');
});

test('handleIpc wraps async errors', async () => {
  const result = await handleIpc(async () => {
    await Promise.resolve();
    throw new Error('deferred error');
  });
  assert.deepEqual(result, { ok: false, error: 'deferred error' });
});

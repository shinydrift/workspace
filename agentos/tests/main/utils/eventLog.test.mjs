/**
 * Tests for utils/eventLog.ts — sanitizeUnknown (redaction), getLogHistory buffer logic.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from eventLog.ts ──────────────────────────────────────────────────

const REDACTED_VALUE = '[REDACTED]';
const REDACT_KEYS = ['apikey', 'api_key', 'token', 'authorization', 'password', 'secret'];

function sanitizeUnknown(value, keyHint) {
  if (keyHint && REDACT_KEYS.some((k) => keyHint.toLowerCase().includes(k))) {
    return REDACTED_VALUE;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUnknown(item));
  }

  if (value && typeof value === 'object') {
    const input = value;
    const out = {};
    for (const [key, nested] of Object.entries(input)) {
      out[key] = sanitizeUnknown(nested, key);
    }
    return out;
  }

  return value;
}

function sanitizeMeta(meta) {
  if (!meta) return undefined;
  return sanitizeUnknown(meta);
}

// Simplified in-memory log buffer
function makeLogBuffer(maxEntries = 10) {
  const buffer = [];
  function push(entry) {
    buffer.push(entry);
    if (buffer.length > maxEntries) buffer.shift();
  }
  function getHistory() {
    return [...buffer];
  }
  return { push, getHistory };
}

// ── sanitizeUnknown — redaction ───────────────────────────────────────────────

test('redacts value when keyHint is "token"', () => {
  assert.equal(sanitizeUnknown('abc', 'token'), REDACTED_VALUE);
});

test('redacts value when keyHint is "api_key"', () => {
  assert.equal(sanitizeUnknown('sk-xxx', 'api_key'), REDACTED_VALUE);
});

test('redacts value when keyHint is "apikey" (no underscore)', () => {
  assert.equal(sanitizeUnknown('secret', 'apikey'), REDACTED_VALUE);
});

test('redacts value when keyHint is "authorization"', () => {
  assert.equal(sanitizeUnknown('Bearer tok', 'authorization'), REDACTED_VALUE);
});

test('redacts value when keyHint is "password"', () => {
  assert.equal(sanitizeUnknown('p4ss!', 'password'), REDACTED_VALUE);
});

test('redacts value when keyHint is "secret"', () => {
  assert.equal(sanitizeUnknown('shhh', 'secret'), REDACTED_VALUE);
});

test('redacts key containing "token" as substring', () => {
  assert.equal(sanitizeUnknown('val', 'access_token'), REDACTED_VALUE);
});

test('does not redact when keyHint is safe', () => {
  assert.equal(sanitizeUnknown('hello', 'name'), 'hello');
});

test('passes through primitive values when no keyHint', () => {
  assert.equal(sanitizeUnknown(42), 42);
  assert.equal(sanitizeUnknown('text'), 'text');
  assert.equal(sanitizeUnknown(null), null);
});

// ── sanitizeUnknown — nested objects ─────────────────────────────────────────

test('redacts nested token key in object', () => {
  const result = sanitizeUnknown({ token: 'abc123', name: 'alice' });
  assert.equal(result.token, REDACTED_VALUE);
  assert.equal(result.name, 'alice');
});

test('redacts deeply nested secret', () => {
  const result = sanitizeUnknown({ outer: { secret: 'hidden', visible: 'yes' } });
  assert.equal(result.outer.secret, REDACTED_VALUE);
  assert.equal(result.outer.visible, 'yes');
});

test('handles array values — passes through non-sensitive', () => {
  const result = sanitizeUnknown([1, 'two', null]);
  assert.deepEqual(result, [1, 'two', null]);
});

test('sanitizeMeta returns undefined for falsy input', () => {
  assert.equal(sanitizeMeta(undefined), undefined);
  assert.equal(sanitizeMeta(null), undefined);
});

test('sanitizeMeta redacts token in meta object', () => {
  const result = sanitizeMeta({ token: 'xyz', info: 'safe' });
  assert.equal(result.token, REDACTED_VALUE);
  assert.equal(result.info, 'safe');
});

// ── in-memory log buffer ──────────────────────────────────────────────────────

test('buffer starts empty', () => {
  const { getHistory } = makeLogBuffer();
  assert.deepEqual(getHistory(), []);
});

test('buffer holds pushed entries', () => {
  const { push, getHistory } = makeLogBuffer();
  push({ level: 'info', message: 'a' });
  push({ level: 'warn', message: 'b' });
  assert.equal(getHistory().length, 2);
});

test('buffer evicts oldest when exceeding maxEntries', () => {
  const { push, getHistory } = makeLogBuffer(3);
  push({ id: 1 });
  push({ id: 2 });
  push({ id: 3 });
  push({ id: 4 });
  const history = getHistory();
  assert.equal(history.length, 3);
  assert.equal(history[0].id, 2);
  assert.equal(history[2].id, 4);
});

test('getHistory returns a copy, not the internal array', () => {
  const { push, getHistory } = makeLogBuffer();
  push({ id: 1 });
  const h1 = getHistory();
  push({ id: 2 });
  assert.equal(h1.length, 1);
  assert.equal(getHistory().length, 2);
});

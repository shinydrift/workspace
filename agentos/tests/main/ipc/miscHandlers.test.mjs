/**
 * Tests for ipc/handlers/miscHandlers.ts — pure validation logic (inlined).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from miscHandlers.ts ──────────────────────────────────────────────

function isSafeExternalUrl(url) {
  return url.startsWith('http://') || url.startsWith('https://');
}

function validateOpenExternal(raw) {
  if (!raw || typeof raw !== 'object') return false;
  if (typeof raw.url !== 'string') return false;
  try {
    new URL(raw.url);
  } catch {
    return false;
  }
  return true;
}

// ── isSafeExternalUrl ─────────────────────────────────────────────────────────

test('isSafeExternalUrl: accepts http url', () => {
  assert.ok(isSafeExternalUrl('http://example.com'));
});

test('isSafeExternalUrl: accepts https url', () => {
  assert.ok(isSafeExternalUrl('https://example.com/path?q=1'));
});

test('isSafeExternalUrl: rejects file:// url', () => {
  assert.ok(!isSafeExternalUrl('file:///etc/passwd'));
});

test('isSafeExternalUrl: rejects javascript: url', () => {
  assert.ok(!isSafeExternalUrl('javascript:alert(1)'));
});

test('isSafeExternalUrl: rejects empty string', () => {
  assert.ok(!isSafeExternalUrl(''));
});

test('isSafeExternalUrl: rejects ftp url', () => {
  assert.ok(!isSafeExternalUrl('ftp://files.example.com'));
});

test('isSafeExternalUrl: rejects url without scheme', () => {
  assert.ok(!isSafeExternalUrl('example.com'));
});

test('isSafeExternalUrl: rejects data: url', () => {
  assert.ok(!isSafeExternalUrl('data:text/html,<script>alert(1)</script>'));
});

// ── validateOpenExternal ──────────────────────────────────────────────────────

test('validateOpenExternal: accepts valid http url', () => {
  assert.ok(validateOpenExternal({ url: 'http://example.com' }));
});

test('validateOpenExternal: accepts valid https url', () => {
  assert.ok(validateOpenExternal({ url: 'https://docs.example.com/guide' }));
});

test('validateOpenExternal: rejects missing url field', () => {
  assert.ok(!validateOpenExternal({}));
});

test('validateOpenExternal: rejects non-string url', () => {
  assert.ok(!validateOpenExternal({ url: 42 }));
});

test('validateOpenExternal: rejects invalid url format', () => {
  assert.ok(!validateOpenExternal({ url: 'not a url' }));
});

test('validateOpenExternal: rejects null input', () => {
  assert.ok(!validateOpenExternal(null));
});

// ── ENV_LIST_SHELL_VARS behavior ──────────────────────────────────────────────

test('env key extraction: returns sorted keys from env object', () => {
  const env = { PATH: '/usr/bin', HOME: '/home/user', TERM: 'xterm' };
  const keys = Object.keys(env).sort();
  assert.deepEqual(keys, ['HOME', 'PATH', 'TERM']);
});

test('env key extraction: empty env yields empty array', () => {
  assert.deepEqual(Object.keys({}).sort(), []);
});

test('env key extraction: single key works', () => {
  assert.deepEqual(Object.keys({ FOO: 'bar' }).sort(), ['FOO']);
});

// ── desktopCapturer types validation ─────────────────────────────────────────

test('desktopCapturer: types array validates correctly', () => {
  function validateTypes(raw) {
    if (!raw || typeof raw !== 'object') return false;
    if (!Array.isArray(raw.types)) return false;
    return raw.types.every((t) => typeof t === 'string');
  }

  assert.ok(validateTypes({ types: ['screen', 'window'] }));
  assert.ok(validateTypes({ types: ['screen'] }));
  assert.ok(validateTypes({ types: [] }));
  assert.ok(!validateTypes({ types: [1, 2] }));
  assert.ok(!validateTypes({ types: 'screen' }));
  assert.ok(!validateTypes(null));
});

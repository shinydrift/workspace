/**
 * Tests for ipc/handlers/audioHandlers.ts — schema validation logic (inlined).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined constraints from audioHandlers.ts ─────────────────────────────────

function validatePlayTTS(req) {
  if (!req || typeof req !== 'object') return false;
  if (typeof req.text !== 'string') return false;
  if (req.text.length < 1 || req.text.length > 10_000) return false;
  return true;
}

// ── PlayTTSSchema ─────────────────────────────────────────────────────────────

test('PlayTTS: valid text', () => {
  assert.ok(validatePlayTTS({ text: 'Hello, world!' }));
});

test('PlayTTS: valid single character', () => {
  assert.ok(validatePlayTTS({ text: 'A' }));
});

test('PlayTTS: valid text exactly 10000 chars', () => {
  assert.ok(validatePlayTTS({ text: 'x'.repeat(10_000) }));
});

test('PlayTTS: rejects empty text', () => {
  assert.ok(!validatePlayTTS({ text: '' }));
});

test('PlayTTS: rejects text over 10000 chars', () => {
  assert.ok(!validatePlayTTS({ text: 'x'.repeat(10_001) }));
});

test('PlayTTS: rejects non-string text', () => {
  assert.ok(!validatePlayTTS({ text: 42 }));
  assert.ok(!validatePlayTTS({ text: null }));
  assert.ok(!validatePlayTTS({ text: ['hello'] }));
});

test('PlayTTS: rejects missing text', () => {
  assert.ok(!validatePlayTTS({}));
});

test('PlayTTS: rejects null request', () => {
  assert.ok(!validatePlayTTS(null));
});

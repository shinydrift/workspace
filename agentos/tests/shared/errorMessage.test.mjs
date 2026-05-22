/**
 * Tests for shared/utils/errorMessage.ts — getErrorMessage (inlined).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from shared/utils/errorMessage.ts ────────────────────────────────

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// ── tests ─────────────────────────────────────────────────────────────────────

test('returns message from Error instance', () => {
  assert.equal(getErrorMessage(new Error('oops')), 'oops');
});

test('returns String() for plain string', () => {
  assert.equal(getErrorMessage('something went wrong'), 'something went wrong');
});

test('returns String() for number', () => {
  assert.equal(getErrorMessage(42), '42');
});

test('returns String() for null', () => {
  assert.equal(getErrorMessage(null), 'null');
});

test('returns String() for undefined', () => {
  assert.equal(getErrorMessage(undefined), 'undefined');
});

test('returns String() for plain object', () => {
  assert.equal(getErrorMessage({ code: 404 }), '[object Object]');
});

test('returns message from Error subclass', () => {
  class CustomError extends Error {}
  assert.equal(getErrorMessage(new CustomError('custom msg')), 'custom msg');
});

test('empty Error message returns empty string', () => {
  assert.equal(getErrorMessage(new Error('')), '');
});

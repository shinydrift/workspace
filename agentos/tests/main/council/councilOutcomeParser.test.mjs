/**
 * Tests for council outcome submission validation.
 * Covers the actual submission path (council_submit_outcome MCP tool) rather
 * than the legacy sentinel-based parser which is no longer used.
 *
 * Logic inlined per repo convention.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inline the submission validation logic (mirrors councilMcpServer Zod schema) ─

function validateSubmitOutcome(input) {
  const errors = [];
  if (typeof input.run_id !== 'string' || input.run_id.length === 0) errors.push('run_id required');
  if (typeof input.child_thread_id !== 'string' || input.child_thread_id.length === 0) errors.push('child_thread_id required');
  if (typeof input.summary !== 'string' || input.summary.length === 0) errors.push('summary required');
  if (typeof input.answer !== 'string' || input.answer.length === 0) errors.push('answer required');
  if (input.confidence !== undefined) {
    if (typeof input.confidence !== 'number' || input.confidence < 0 || input.confidence > 1) {
      errors.push('confidence must be number 0..1');
    }
  }
  if (input.caveats !== undefined) {
    if (!Array.isArray(input.caveats) || input.caveats.some((c) => typeof c !== 'string')) {
      errors.push('caveats must be string[]');
    }
  }
  return errors;
}

// ── Required fields ───────────────────────────────────────────────────────────

test('valid submission with all required fields passes', () => {
  const errs = validateSubmitOutcome({
    run_id: 'crun_abc',
    child_thread_id: 'child_xyz',
    summary: 'The answer is 42.',
    answer: 'The full answer here.',
  });
  assert.equal(errs.length, 0);
});

test('missing run_id fails', () => {
  const errs = validateSubmitOutcome({ child_thread_id: 'x', summary: 's', answer: 'a' });
  assert.ok(errs.some((e) => e.includes('run_id')));
});

test('missing child_thread_id fails', () => {
  const errs = validateSubmitOutcome({ run_id: 'r', summary: 's', answer: 'a' });
  assert.ok(errs.some((e) => e.includes('child_thread_id')));
});

test('missing summary fails', () => {
  const errs = validateSubmitOutcome({ run_id: 'r', child_thread_id: 'c', answer: 'a' });
  assert.ok(errs.some((e) => e.includes('summary')));
});

test('missing answer fails', () => {
  const errs = validateSubmitOutcome({ run_id: 'r', child_thread_id: 'c', summary: 's' });
  assert.ok(errs.some((e) => e.includes('answer')));
});

// ── Optional fields ───────────────────────────────────────────────────────────

test('valid submission with confidence passes', () => {
  const errs = validateSubmitOutcome({
    run_id: 'r', child_thread_id: 'c', summary: 's', answer: 'a',
    confidence: 0.85,
  });
  assert.equal(errs.length, 0);
});

test('confidence of 0 passes', () => {
  const errs = validateSubmitOutcome({ run_id: 'r', child_thread_id: 'c', summary: 's', answer: 'a', confidence: 0 });
  assert.equal(errs.length, 0);
});

test('confidence of 1 passes', () => {
  const errs = validateSubmitOutcome({ run_id: 'r', child_thread_id: 'c', summary: 's', answer: 'a', confidence: 1 });
  assert.equal(errs.length, 0);
});

test('confidence > 1 fails', () => {
  const errs = validateSubmitOutcome({ run_id: 'r', child_thread_id: 'c', summary: 's', answer: 'a', confidence: 1.5 });
  assert.ok(errs.some((e) => e.includes('confidence')));
});

test('confidence < 0 fails', () => {
  const errs = validateSubmitOutcome({ run_id: 'r', child_thread_id: 'c', summary: 's', answer: 'a', confidence: -0.1 });
  assert.ok(errs.some((e) => e.includes('confidence')));
});

test('valid submission with caveats passes', () => {
  const errs = validateSubmitOutcome({
    run_id: 'r', child_thread_id: 'c', summary: 's', answer: 'a',
    caveats: ['caveat one', 'caveat two'],
  });
  assert.equal(errs.length, 0);
});

test('caveats with non-string element fails', () => {
  const errs = validateSubmitOutcome({
    run_id: 'r', child_thread_id: 'c', summary: 's', answer: 'a',
    caveats: ['ok', 42],
  });
  assert.ok(errs.some((e) => e.includes('caveats')));
});

test('caveats as non-array fails', () => {
  const errs = validateSubmitOutcome({
    run_id: 'r', child_thread_id: 'c', summary: 's', answer: 'a',
    caveats: 'not an array',
  });
  assert.ok(errs.some((e) => e.includes('caveats')));
});

/**
 * Tests for sessions/ThreadLifecycle.ts — fallback signal detection (inlined).
 *
 * Covers: unsupported flag signal matching used by shouldFallbackToPlainClaude.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from ThreadLifecycle.ts ──────────────────────────────────────────

const UNSUPPORTED_FLAG_SIGNALS = [
  '--output-format',
  'unknown option',
  'invalid option',
  'unexpected argument',
  'unrecognized option',
  'stream-json',
];

function hasUnsupportedFlagSignal(rawOutput) {
  const lower = rawOutput.toLowerCase();
  return UNSUPPORTED_FLAG_SIGNALS.some((signal) => lower.includes(signal));
}

const PROVIDER_LIMIT_SIGNALS = [
  "you've hit your org's monthly usage limit",
  'monthly usage limit',
  'usage limit',
  'quota exceeded',
  'rate limit exceeded',
  'too many requests',
];

function hasProviderLimitSignal(rawOutput) {
  const lower = rawOutput.toLowerCase();
  return PROVIDER_LIMIT_SIGNALS.some((signal) => lower.includes(signal));
}

// ── each signal individually ──────────────────────────────────────────────────

test('hasUnsupportedFlagSignal: --output-format triggers fallback', () => {
  assert.equal(hasUnsupportedFlagSignal('error: --output-format is not supported'), true);
});

test('hasUnsupportedFlagSignal: unknown option triggers fallback', () => {
  assert.equal(hasUnsupportedFlagSignal('Unknown option: --foo'), true);
});

test('hasUnsupportedFlagSignal: invalid option triggers fallback', () => {
  assert.equal(hasUnsupportedFlagSignal('Invalid option provided'), true);
});

test('hasUnsupportedFlagSignal: unexpected argument triggers fallback', () => {
  assert.equal(hasUnsupportedFlagSignal('unexpected argument: --bar'), true);
});

test('hasUnsupportedFlagSignal: unrecognized option triggers fallback', () => {
  assert.equal(hasUnsupportedFlagSignal('Unrecognized option: --baz'), true);
});

test('hasUnsupportedFlagSignal: stream-json triggers fallback', () => {
  assert.equal(hasUnsupportedFlagSignal('stream-json is not a valid output format'), true);
});

// ── no signal ─────────────────────────────────────────────────────────────────

test('hasUnsupportedFlagSignal: normal output returns false', () => {
  assert.equal(hasUnsupportedFlagSignal('Hello, how can I help you today?'), false);
});

test('hasUnsupportedFlagSignal: empty string returns false', () => {
  assert.equal(hasUnsupportedFlagSignal(''), false);
});

test('hasUnsupportedFlagSignal: generic error without flag signal returns false', () => {
  assert.equal(hasUnsupportedFlagSignal('Error: something went wrong'), false);
});

// ── case insensitivity ────────────────────────────────────────────────────────

test('hasUnsupportedFlagSignal: uppercase UNKNOWN OPTION triggers fallback', () => {
  assert.equal(hasUnsupportedFlagSignal('UNKNOWN OPTION: --verbose'), true);
});

test('hasUnsupportedFlagSignal: mixed-case Invalid Option triggers fallback', () => {
  assert.equal(hasUnsupportedFlagSignal('Invalid Option: --output-format'), true);
});

// ── signal embedded in longer output ─────────────────────────────────────────

test('hasUnsupportedFlagSignal: signal anywhere in long output triggers fallback', () => {
  const output = `Starting claude CLI...
Loading config...
Connecting to API...
error: unrecognized option '--output-format stream-json'
Exiting with code 1`;
  assert.equal(hasUnsupportedFlagSignal(output), true);
});

test('hasUnsupportedFlagSignal: long output with no signal returns false', () => {
  const output = `Starting claude CLI...
Loaded project memory (1234 bytes)
Running task: summarize codebase
Response received in 3.2s
Done.`;
  assert.equal(hasUnsupportedFlagSignal(output), false);
});

// ── provider usage limit signals ──────────────────────────────────────────────

test("hasProviderLimitSignal: org's monthly usage limit triggers provider fallback", () => {
  assert.equal(hasProviderLimitSignal("You've hit your org's monthly usage limit"), true);
});

test('hasProviderLimitSignal: quota exceeded triggers provider fallback', () => {
  assert.equal(hasProviderLimitSignal('Error: quota exceeded for this account'), true);
});

test('hasProviderLimitSignal: normal output returns false', () => {
  assert.equal(hasProviderLimitSignal('The command completed successfully.'), false);
});

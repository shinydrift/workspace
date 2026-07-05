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
  "you've hit your org's monthly spend limit",
  'monthly spend limit',
  "you've hit your org's monthly usage limit",
  'monthly usage limit',
  'quota exceeded',
  'rate limit exceeded',
  'too many requests',
];
const CLAUDE_MONTHLY_SPEND_LIMIT =
  "You've hit your org's monthly spend limit · ask your admin to raise it at claude.ai/settings/usage";

function hasProviderLimitSignal(rawOutput) {
  const lower = rawOutput.toLowerCase();
  return PROVIDER_LIMIT_SIGNALS.some((signal) => lower.includes(signal));
}

function shouldTreatAsProviderLimit(exitCode, rawOutput) {
  void exitCode;
  return hasProviderLimitSignal(rawOutput);
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

test("hasProviderLimitSignal: org's monthly spend limit triggers provider fallback", () => {
  assert.equal(hasProviderLimitSignal(CLAUDE_MONTHLY_SPEND_LIMIT), true);
});

test('hasProviderLimitSignal: quota exceeded triggers provider fallback', () => {
  assert.equal(hasProviderLimitSignal('Error: quota exceeded for this account'), true);
});

test('hasProviderLimitSignal: normal output returns false', () => {
  assert.equal(hasProviderLimitSignal('The command completed successfully.'), false);
});

// Regression: bare "usage limit" / "spend limit" appearing in model-visible content (a user
// message echoed by a tool, a skill doc) must NOT trigger a provider fallback. This is what
// cascaded the Personality Refresh run through every provider. Only the qualified provider
// phrasings above should match.
test('hasProviderLimitSignal: echoed user message mentioning a usage limit returns false', () => {
  const echoed = "So the cloud usage limit doesn't automatically move us to the next agent.";
  assert.equal(hasProviderLimitSignal(echoed), false);
});

test('hasProviderLimitSignal: prose mentioning a spend limit returns false', () => {
  assert.equal(hasProviderLimitSignal('Check whether the spend limit is configured for the project.'), false);
});

test('shouldTreatAsProviderLimit: zero-exit Claude spend-limit output triggers provider fallback', () => {
  assert.equal(shouldTreatAsProviderLimit(0, CLAUDE_MONTHLY_SPEND_LIMIT), true);
});

test('shouldTreatAsProviderLimit: zero-exit normal output does not trigger provider fallback', () => {
  assert.equal(shouldTreatAsProviderLimit(0, 'The command completed successfully.'), false);
});

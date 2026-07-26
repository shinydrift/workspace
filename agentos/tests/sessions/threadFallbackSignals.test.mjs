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

const KILLED_EXIT_CODES = new Set([137, 143]);
const CLI_ERROR_EVENT_TYPES = new Set(['error', 'turn.failed']);

function isCliErrorEvent(event) {
  const type = typeof event.type === 'string' ? event.type.toLowerCase() : '';
  if (CLI_ERROR_EVENT_TYPES.has(type)) return true;
  return type === 'result' && (event.is_error === true || typeof event.error === 'string');
}

function cliReportedText(rawOutput, includePlainLines) {
  const parts = [];
  for (const rawLine of rawOutput.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!line.startsWith('{')) {
      if (includePlainLines) parts.push(line);
      continue;
    }
    if (!line.endsWith('}')) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event && typeof event === 'object' && !Array.isArray(event) && isCliErrorEvent(event)) parts.push(line);
  }
  return parts.join('\n');
}

function shouldTreatAsProviderLimit(exitCode, rawOutput) {
  if (exitCode !== undefined && KILLED_EXIT_CODES.has(exitCode)) return false;
  return hasProviderLimitSignal(cliReportedText(rawOutput, exitCode !== 0));
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

// ── shouldTreatAsProviderLimit: only the CLI's own reporting counts ───────────

const claudeResultEvent = (fields) => JSON.stringify({ type: 'result', subtype: 'success', ...fields });

test('shouldTreatAsProviderLimit: zero-exit Claude spend-limit result event triggers provider fallback', () => {
  const output = claudeResultEvent({ is_error: true, result: CLAUDE_MONTHLY_SPEND_LIMIT });
  assert.equal(shouldTreatAsProviderLimit(0, output), true);
});

test('shouldTreatAsProviderLimit: zero-exit Gemini result event carrying an error triggers provider fallback', () => {
  const output = JSON.stringify({ type: 'result', error: 'Quota exceeded for this project' });
  assert.equal(shouldTreatAsProviderLimit(0, output), true);
});

test('shouldTreatAsProviderLimit: Codex turn.failed with a limit error triggers provider fallback', () => {
  const output = JSON.stringify({ type: 'turn.failed', error: { message: 'rate limit exceeded' } });
  assert.equal(shouldTreatAsProviderLimit(0, output), true);
});

test('shouldTreatAsProviderLimit: non-zero exit with a limit phrase in CLI chatter triggers provider fallback', () => {
  assert.equal(shouldTreatAsProviderLimit(1, 'error: rate limit exceeded, retry after 60s'), true);
});

test('shouldTreatAsProviderLimit: zero-exit normal output does not trigger provider fallback', () => {
  assert.equal(shouldTreatAsProviderLimit(0, 'The command completed successfully.'), false);
});

// Regression: a thread that read headlessRunner.ts itself cascaded Claude → Codex → Gemini,
// because the file's own signal list landed in the turn buffer inside a tool_result. The turn
// had exited 0 — a succeeded turn's content is never a provider report.
test('shouldTreatAsProviderLimit: limit phrases inside a tool_result do not trigger provider fallback', () => {
  const output = JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          content: "const PROVIDER_LIMIT_SIGNALS = ['monthly spend limit', 'quota exceeded', 'too many requests'];",
        },
      ],
    },
  });
  assert.equal(shouldTreatAsProviderLimit(0, output), false);
});

// Regression: a thread reading Anthropic API error docs ("| 429 | rate_limit_error | Too many
// requests |") cascaded the same way.
test('shouldTreatAsProviderLimit: 429 docs echoed in assistant text do not trigger provider fallback', () => {
  const output = JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: '| 429 | rate_limit_error | Too many requests |' }] },
  });
  assert.equal(shouldTreatAsProviderLimit(0, output), false);
});

// The assistant's own final summary rides in the result event, so a clean result must not be
// scanned — only one flagged as an error.
test('shouldTreatAsProviderLimit: clean result event quoting a limit phrase does not trigger fallback', () => {
  const output = claudeResultEvent({
    is_error: false,
    result: 'I removed the "too many requests" signal from the list.',
  });
  assert.equal(shouldTreatAsProviderLimit(0, output), false);
});

// A truncated JSON line is content cut off mid-write, not CLI chatter — even on a failed turn.
test('shouldTreatAsProviderLimit: truncated tool_result on a failed turn does not trigger fallback', () => {
  const output = '{"type":"user","message":{"content":[{"type":"tool_result","content":"quota exceeded';
  assert.equal(shouldTreatAsProviderLimit(1, output), false);
});

test('shouldTreatAsProviderLimit: SIGKILLed turn does not trigger provider fallback', () => {
  assert.equal(shouldTreatAsProviderLimit(137, 'reading docs about quota exceeded errors'), false);
});

// Plain-text harnesses (pi) emit no structured events, so their prose only counts once the CLI
// has actually failed. A limit reported on a clean exit there is missed by design.
test('shouldTreatAsProviderLimit: plain-text limit message on a clean exit does not trigger fallback', () => {
  assert.equal(shouldTreatAsProviderLimit(0, CLAUDE_MONTHLY_SPEND_LIMIT), false);
});

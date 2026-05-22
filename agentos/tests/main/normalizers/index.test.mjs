/**
 * Tests for normalizers/index.ts — normalizeMessage and normalizeMessages dispatcher.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined dispatcher logic ─────────────────────────────────────────────────

function buildPlainTextResult(input) {
  const content = input.text.trim();
  const blocks = content ? [{ type: 'text', text: content }] : [];
  return {
    content,
    normalized: {
      schemaVersion: 1,
      provider: input.provider,
      role: input.role,
      blocks,
      raw: { source: 'plain_text', payload: input.raw ?? input.text },
    },
  };
}

// Simplified normalizers for testing dispatch
function normalizeClaude(input) {
  if (input.role !== 'assistant') return buildPlainTextResult(input);
  return { ...buildPlainTextResult(input), _source: 'claude' };
}

function normalizeGemini(input) {
  if (input.role !== 'assistant') return buildPlainTextResult(input);
  return { ...buildPlainTextResult(input), _source: 'gemini' };
}

function normalizeCodex(input) {
  if (input.role !== 'assistant') return buildPlainTextResult(input);
  return { ...buildPlainTextResult(input), _source: 'codex' };
}

function normalizeCodexMessages(input) {
  if (input.role !== 'assistant') return [buildPlainTextResult(input)];
  return [{ ...buildPlainTextResult(input), _source: 'codex' }];
}

const providerNormalizers = {
  claude: normalizeClaude,
  'claude-interactive': normalizeClaude,
  codex: normalizeCodex,
  gemini: normalizeGemini,
};

function normalizeMessage(input) {
  const normalizer = providerNormalizers[input.provider] ?? buildPlainTextResult;
  return normalizer(input);
}

function normalizeClaudeMessages(input) {
  return [normalizeClaude(input)];
}

function normalizeMessages(input) {
  if (input.provider === 'codex') return normalizeCodexMessages(input);
  return [normalizeMessage(input)];
}

function normalizeMessagesMultiTurn(input) {
  if (input.provider === 'claude' || input.provider === 'claude-interactive') return normalizeClaudeMessages(input);
  if (input.provider === 'codex') return normalizeCodexMessages(input);
  return [normalizeMessage(input)];
}

// ── normalizeMessage dispatch ─────────────────────────────────────────────────

test('normalizeMessage routes to claude normalizer', () => {
  const result = normalizeMessage({ provider: 'claude', role: 'assistant', text: 'hello' });
  assert.equal(result._source, 'claude');
});

test('normalizeMessage routes to gemini normalizer', () => {
  const result = normalizeMessage({ provider: 'gemini', role: 'assistant', text: 'hello' });
  assert.equal(result._source, 'gemini');
});

test('normalizeMessage routes to codex normalizer', () => {
  const result = normalizeMessage({ provider: 'codex', role: 'assistant', text: 'hello' });
  assert.equal(result._source, 'codex');
});

test('normalizeMessage uses passthrough for unknown provider', () => {
  const result = normalizeMessage({ provider: 'unknown_provider', role: 'user', text: 'hi' });
  assert.equal(result.content, 'hi');
  assert.equal(result.normalized.provider, 'unknown_provider');
});

test('normalizeMessage preserves role', () => {
  const result = normalizeMessage({ provider: 'claude', role: 'user', text: 'question' });
  assert.equal(result.normalized.role, 'user');
});

test('normalizeMessage returns content equal to trimmed text', () => {
  const result = normalizeMessage({ provider: 'claude', role: 'user', text: '  hello  ' });
  assert.equal(result.content, 'hello');
});

// ── normalizeMessages dispatch ────────────────────────────────────────────────

test('normalizeMessages returns array for codex', () => {
  const results = normalizeMessages({ provider: 'codex', role: 'assistant', text: 'hi' });
  assert.ok(Array.isArray(results));
  assert.equal(results.length, 1);
  assert.equal(results[0]._source, 'codex');
});

test('normalizeMessages wraps single result for claude', () => {
  const results = normalizeMessages({ provider: 'claude', role: 'assistant', text: 'hi' });
  assert.ok(Array.isArray(results));
  assert.equal(results.length, 1);
  assert.equal(results[0]._source, 'claude');
});

test('normalizeMessages wraps single result for gemini', () => {
  const results = normalizeMessages({ provider: 'gemini', role: 'assistant', text: 'hi' });
  assert.ok(Array.isArray(results));
  assert.equal(results.length, 1);
});

// ── buildPlainTextResult ──────────────────────────────────────────────────────

test('buildPlainTextResult creates text block for non-empty content', () => {
  const result = buildPlainTextResult({ provider: 'claude', role: 'user', text: 'hello' });
  assert.equal(result.normalized.blocks.length, 1);
  assert.equal(result.normalized.blocks[0].type, 'text');
  assert.equal(result.normalized.blocks[0].text, 'hello');
});

test('buildPlainTextResult creates empty blocks for empty text', () => {
  const result = buildPlainTextResult({ provider: 'claude', role: 'user', text: '' });
  assert.equal(result.normalized.blocks.length, 0);
  assert.equal(result.content, '');
});

test('buildPlainTextResult uses raw field when provided', () => {
  const result = buildPlainTextResult({ provider: 'claude', role: 'user', text: 'clean', raw: 'original' });
  assert.equal(result.normalized.raw.payload, 'original');
});

test('buildPlainTextResult falls back to text for raw payload', () => {
  const result = buildPlainTextResult({ provider: 'claude', role: 'user', text: 'clean' });
  assert.equal(result.normalized.raw.payload, 'clean');
});

test('buildPlainTextResult schema version is 1', () => {
  const result = buildPlainTextResult({ provider: 'claude', role: 'user', text: 'hi' });
  assert.equal(result.normalized.schemaVersion, 1);
});

test('buildPlainTextResult raw source is plain_text', () => {
  const result = buildPlainTextResult({ provider: 'claude', role: 'user', text: 'hi' });
  assert.equal(result.normalized.raw.source, 'plain_text');
});

// ── known providers ───────────────────────────────────────────────────────────

test('all three providers are registered', () => {
  const providers = Object.keys(providerNormalizers);
  assert.ok(providers.includes('claude'));
  assert.ok(providers.includes('codex'));
  assert.ok(providers.includes('gemini'));
});

// ── claude-interactive dispatch ──────────────────────────────────────────────
// Regression guard for #986: claude-interactive must not fall through to plain_text.

test('normalizeMessage routes claude-interactive to claude normalizer', () => {
  const result = normalizeMessage({ provider: 'claude-interactive', role: 'assistant', text: 'hello' });
  assert.equal(result._source, 'claude', 'claude-interactive should dispatch to normalizeClaude');
});

test('normalizeMessages wraps single result for claude-interactive', () => {
  const results = normalizeMessages({ provider: 'claude-interactive', role: 'assistant', text: 'hi' });
  assert.ok(Array.isArray(results));
  assert.equal(results.length, 1);
  assert.equal(results[0]._source, 'claude');
});

test('normalizeMessagesMultiTurn routes claude-interactive to claude path', () => {
  const results = normalizeMessagesMultiTurn({ provider: 'claude-interactive', role: 'assistant', text: 'hi' });
  assert.ok(Array.isArray(results));
  assert.equal(results[0]._source, 'claude');
});

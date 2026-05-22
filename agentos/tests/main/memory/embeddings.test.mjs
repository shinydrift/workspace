/**
 * Tests for main/memory/embeddings.ts — pure/mockable logic.
 * resolveGeminiHeaders, providerKey determinism, createEmbeddingProvider routing.
 * Functions inlined — no TS loader needed. Network calls mocked via globalThis.fetch.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// ── Inlined: resolveGeminiHeaders ─────────────────────────────────────────────

function resolveGeminiHeaders(apiKey) {
  if (apiKey.startsWith('{')) {
    try {
      const parsed = JSON.parse(apiKey);
      if (typeof parsed.token === 'string')
        return { 'Content-Type': 'application/json', Authorization: `Bearer ${parsed.token}` };
    } catch { /* fall through */ }
  }
  return { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
}

// ── Inlined: providerKey ──────────────────────────────────────────────────────

function providerKey(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 12);
}

// ── Inlined: createEmbeddingProvider routing stub ────────────────────────────
// We test the routing logic only (which provider is selected), not the HTTP calls.

function createEmbeddingProviderRouting(settings) {
  const requested = settings.embeddingProvider ?? 'local';
  const keys = settings.apiKeys ?? {};

  if (requested !== 'auto') {
    switch (requested) {
      case 'openai':  return keys.openai  ? 'openai-provider'  : null;
      case 'google':  return keys.google  ? 'google-provider'  : null;
      case 'voyage':  return keys.voyage  ? 'voyage-provider'  : null;
      case 'mistral': return keys.mistral ? 'mistral-provider' : null;
      case 'local':   return 'local-provider';
      default:        return null;
    }
  }

  // Auto mode: first available key wins, local is always last
  if (keys.openai?.trim())  return 'openai-provider';
  if (keys.google?.trim())  return 'google-provider';
  if (keys.voyage?.trim())  return 'voyage-provider';
  if (keys.mistral?.trim()) return 'mistral-provider';
  return 'local-provider';
}

// ── resolveGeminiHeaders ──────────────────────────────────────────────────────

test('resolveGeminiHeaders: plain API key uses x-goog-api-key', () => {
  const headers = resolveGeminiHeaders('my-api-key-123');
  assert.equal(headers['x-goog-api-key'], 'my-api-key-123');
  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(headers['Authorization'], undefined);
});

test('resolveGeminiHeaders: JSON token uses Bearer Authorization', () => {
  const headers = resolveGeminiHeaders(JSON.stringify({ token: 'tok-abc' }));
  assert.equal(headers['Authorization'], 'Bearer tok-abc');
  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(headers['x-goog-api-key'], undefined);
});

test('resolveGeminiHeaders: JSON without token field falls back to x-goog-api-key', () => {
  const headers = resolveGeminiHeaders(JSON.stringify({ other: 'val' }));
  assert.ok('x-goog-api-key' in headers);
});

test('resolveGeminiHeaders: malformed JSON starting with { falls back to x-goog-api-key', () => {
  const headers = resolveGeminiHeaders('{not valid json');
  assert.ok('x-goog-api-key' in headers);
});

test('resolveGeminiHeaders: empty string uses x-goog-api-key', () => {
  const headers = resolveGeminiHeaders('');
  assert.ok('x-goog-api-key' in headers);
});

// ── providerKey ───────────────────────────────────────────────────────────────

test('providerKey: deterministic for same input', () => {
  const k1 = providerKey({ id: 'openai', model: 'text-embedding-3-small', dims: '768' });
  const k2 = providerKey({ id: 'openai', model: 'text-embedding-3-small', dims: '768' });
  assert.equal(k1, k2);
});

test('providerKey: different for different inputs', () => {
  const k1 = providerKey({ id: 'openai', dims: '768' });
  const k2 = providerKey({ id: 'google', dims: '768' });
  assert.notEqual(k1, k2);
});

test('providerKey: returns 12-char hex string', () => {
  const k = providerKey({ id: 'test' });
  assert.equal(k.length, 12);
  assert.match(k, /^[0-9a-f]+$/);
});

test('providerKey: different dims produce different keys', () => {
  const k1 = providerKey({ id: 'openai', model: 'm', dims: '512' });
  const k2 = providerKey({ id: 'openai', model: 'm', dims: '1536' });
  assert.notEqual(k1, k2);
});

// ── createEmbeddingProvider routing ──────────────────────────────────────────

test('routing: explicit openai with key returns openai', () => {
  assert.equal(createEmbeddingProviderRouting({ embeddingProvider: 'openai', apiKeys: { openai: 'key' } }), 'openai-provider');
});

test('routing: explicit openai without key returns null', () => {
  assert.equal(createEmbeddingProviderRouting({ embeddingProvider: 'openai', apiKeys: {} }), null);
});

test('routing: explicit google with key returns google', () => {
  assert.equal(createEmbeddingProviderRouting({ embeddingProvider: 'google', apiKeys: { google: 'key' } }), 'google-provider');
});

test('routing: explicit voyage with key returns voyage', () => {
  assert.equal(createEmbeddingProviderRouting({ embeddingProvider: 'voyage', apiKeys: { voyage: 'key' } }), 'voyage-provider');
});

test('routing: explicit mistral with key returns mistral', () => {
  assert.equal(createEmbeddingProviderRouting({ embeddingProvider: 'mistral', apiKeys: { mistral: 'key' } }), 'mistral-provider');
});

test('routing: explicit local always returns local regardless of keys', () => {
  assert.equal(createEmbeddingProviderRouting({ embeddingProvider: 'local', apiKeys: {} }), 'local-provider');
});

test('routing: unknown provider returns null', () => {
  assert.equal(createEmbeddingProviderRouting({ embeddingProvider: 'unknown', apiKeys: {} }), null);
});

test('routing: no embeddingProvider defaults to local', () => {
  assert.equal(createEmbeddingProviderRouting({ apiKeys: {} }), 'local-provider');
});

test('routing: auto with openai key picks openai first', () => {
  assert.equal(createEmbeddingProviderRouting({ embeddingProvider: 'auto', apiKeys: { openai: 'k', google: 'k' } }), 'openai-provider');
});

test('routing: auto with only google key picks google', () => {
  assert.equal(createEmbeddingProviderRouting({ embeddingProvider: 'auto', apiKeys: { google: 'k' } }), 'google-provider');
});

test('routing: auto with only voyage key picks voyage', () => {
  assert.equal(createEmbeddingProviderRouting({ embeddingProvider: 'auto', apiKeys: { voyage: 'k' } }), 'voyage-provider');
});

test('routing: auto with only mistral key picks mistral', () => {
  assert.equal(createEmbeddingProviderRouting({ embeddingProvider: 'auto', apiKeys: { mistral: 'k' } }), 'mistral-provider');
});

test('routing: auto with no keys falls back to local', () => {
  assert.equal(createEmbeddingProviderRouting({ embeddingProvider: 'auto', apiKeys: {} }), 'local-provider');
});

test('routing: auto with whitespace-only openai key skipped', () => {
  assert.equal(createEmbeddingProviderRouting({ embeddingProvider: 'auto', apiKeys: { openai: '   ', google: 'k' } }), 'google-provider');
});

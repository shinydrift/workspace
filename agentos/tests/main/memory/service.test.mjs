import test from 'node:test';
import assert from 'node:assert/strict';

// Inline the auth header logic from AgentOSMemoryService to test it in isolation.
// Mirrors service.ts: resolveGeminiAuthHeaders
function resolveGeminiAuthHeaders(apiKey) {
  if (apiKey.startsWith('{')) {
    try {
      const parsed = JSON.parse(apiKey);
      if (typeof parsed.token === 'string' && parsed.token) {
        return { 'Content-Type': 'application/json', Authorization: `Bearer ${parsed.token}` };
      }
    } catch {
      // Fall through to plain API key.
    }
  }
  return { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
}

// ── resolveGeminiAuthHeaders ────────────────────────────────────────────────

test('plain API key uses x-goog-api-key header', () => {
  const headers = resolveGeminiAuthHeaders('my-api-key');
  assert.equal(headers['x-goog-api-key'], 'my-api-key');
  assert.equal(headers.Authorization, undefined);
  assert.equal(headers['Content-Type'], 'application/json');
});

test('OAuth JSON token uses Authorization Bearer header', () => {
  const token = JSON.stringify({ token: 'oauth-access-token', projectId: 'my-project' });
  const headers = resolveGeminiAuthHeaders(token);
  assert.equal(headers.Authorization, 'Bearer oauth-access-token');
  assert.equal(headers['x-goog-api-key'], undefined);
  assert.equal(headers['Content-Type'], 'application/json');
});

test('OAuth JSON with empty token falls back to x-goog-api-key', () => {
  const token = JSON.stringify({ token: '', projectId: 'my-project' });
  const headers = resolveGeminiAuthHeaders(token);
  assert.equal(headers['x-goog-api-key'], token);
  assert.equal(headers.Authorization, undefined);
});

test('malformed JSON falls back to x-goog-api-key', () => {
  const headers = resolveGeminiAuthHeaders('{not-valid-json');
  assert.equal(headers['x-goog-api-key'], '{not-valid-json');
  assert.equal(headers.Authorization, undefined);
});

// ── embedWithGoogle request format ─────────────────────────────────────────

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'models/gemini-embedding-001';

function buildEmbedRequest(texts, kind, apiKey = 'test-key') {
  const headers = resolveGeminiAuthHeaders(apiKey);
  const taskType = kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';
  const dimensions = 768;

  if (texts.length === 1) {
    return {
      url: `${BASE_URL}/${MODEL}:embedContent`,
      body: { model: MODEL, content: { parts: [{ text: texts[0] }] }, taskType, outputDimensionality: dimensions },
      headers,
    };
  }
  return {
    url: `${BASE_URL}/${MODEL}:batchEmbedContents`,
    body: {
      requests: texts.map((text) => ({
        model: MODEL,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: dimensions,
      })),
    },
    headers,
  };
}

test('single text uses embedContent endpoint', () => {
  const { url, body } = buildEmbedRequest(['hello'], 'query');
  assert.equal(url, `${BASE_URL}/${MODEL}:embedContent`);
  assert.deepEqual(body.content, { parts: [{ text: 'hello' }] });
  assert.equal(body.taskType, 'RETRIEVAL_QUERY');
  assert.equal(body.outputDimensionality, 768);
  assert.equal(body.requests, undefined);
});

test('multiple texts use batchEmbedContents endpoint', () => {
  const { url, body } = buildEmbedRequest(['hello', 'world'], 'document');
  assert.equal(url, `${BASE_URL}/${MODEL}:batchEmbedContents`);
  assert.equal(body.requests.length, 2);
  assert.deepEqual(body.requests[0].content, { parts: [{ text: 'hello' }] });
  assert.equal(body.requests[0].taskType, 'RETRIEVAL_DOCUMENT');
  assert.equal(body.requests[0].outputDimensionality, 768);
  assert.equal(body.content, undefined);
});

test('query kind sets RETRIEVAL_QUERY task type', () => {
  const { body } = buildEmbedRequest(['q'], 'query');
  assert.equal(body.taskType, 'RETRIEVAL_QUERY');
});

test('document kind sets RETRIEVAL_DOCUMENT task type', () => {
  const { body } = buildEmbedRequest(['d1', 'd2'], 'document');
  assert.equal(body.requests[0].taskType, 'RETRIEVAL_DOCUMENT');
});

test('OAuth token used for batch request headers', () => {
  const oauthKey = JSON.stringify({ token: 'sess-token' });
  const { headers } = buildEmbedRequest(['a', 'b'], 'document', oauthKey);
  assert.equal(headers.Authorization, 'Bearer sess-token');
  assert.equal(headers['x-goog-api-key'], undefined);
});

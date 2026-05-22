/**
 * Tests for mcp/BaseMcpServer.ts — request routing handler (inlined).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from BaseMcpServer.ts ─────────────────────────────────────────────

function createRequestHandler(validateAuth, handleMcpRequest) {
  return (req, res) => {
    if ((req.method === 'GET' || req.method === 'POST') && req.url === '/mcp') {
      if (!validateAuth(req)) {
        res.writeHead(401);
        res.end();
        return;
      }
      void handleMcpRequest(req, res);
    } else {
      res.writeHead(404);
      res.end();
    }
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockRes() {
  const r = { statusCode: null, ended: false };
  r.writeHead = (code) => { r.statusCode = code; };
  r.end = () => { r.ended = true; };
  return r;
}

function mockReq(method, url) {
  return { method, url };
}

// ── Route dispatch ────────────────────────────────────────────────────────────

test('GET /mcp with valid auth calls handleMcpRequest', () => {
  let called = false;
  const handler = createRequestHandler(() => true, () => { called = true; });
  const res = mockRes();
  handler(mockReq('GET', '/mcp'), res);
  assert.ok(called, 'handleMcpRequest should be called');
  assert.equal(res.statusCode, null, 'writeHead should not be called');
});

test('POST /mcp with valid auth calls handleMcpRequest', () => {
  let called = false;
  const handler = createRequestHandler(() => true, () => { called = true; });
  const res = mockRes();
  handler(mockReq('POST', '/mcp'), res);
  assert.ok(called);
});

test('GET /mcp with invalid auth returns 401', () => {
  const handler = createRequestHandler(() => false, () => { throw new Error('should not be called'); });
  const res = mockRes();
  handler(mockReq('GET', '/mcp'), res);
  assert.equal(res.statusCode, 401);
  assert.ok(res.ended);
});

test('POST /mcp with invalid auth returns 401', () => {
  const handler = createRequestHandler(() => false, () => { throw new Error('should not be called'); });
  const res = mockRes();
  handler(mockReq('POST', '/mcp'), res);
  assert.equal(res.statusCode, 401);
  assert.ok(res.ended);
});

// ── 404 paths ─────────────────────────────────────────────────────────────────

const handler404 = createRequestHandler(() => true, () => {});

for (const [method, url] of [
  ['GET', '/other'],
  ['GET', '/'],
  ['GET', '/mcp/extra'],
  ['DELETE', '/mcp'],
  ['PUT', '/mcp'],
  ['PATCH', '/mcp'],
]) {
  test(`${method} ${url} returns 404`, () => {
    const res = mockRes();
    handler404(mockReq(method, url), res);
    assert.equal(res.statusCode, 404);
    assert.ok(res.ended);
  });
}

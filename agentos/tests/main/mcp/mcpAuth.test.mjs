/**
 * Tests for mcp/mcpAuth.ts — getMcpToken, getMcpAuthHeaders, validateMcpAuth (inlined).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// ── Inlined from mcpAuth.ts ───────────────────────────────────────────────────

const MCP_TOKEN = crypto.randomBytes(32).toString('hex');
const AUTH_HEADER_VALUE = `Bearer ${MCP_TOKEN}`;
const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

let localhostAuthBypass = true;

function setLocalhostAuthBypass(enabled) {
  localhostAuthBypass = enabled;
}

function getMcpToken() {
  return MCP_TOKEN;
}

function getMcpAuthHeaders() {
  return { Authorization: AUTH_HEADER_VALUE };
}

function validateMcpAuth(req) {
  if (localhostAuthBypass && LOOPBACK_ADDRS.has(req.socket?.remoteAddress ?? '')) return true;
  return req.headers['authorization'] === AUTH_HEADER_VALUE;
}

// ── getMcpToken ───────────────────────────────────────────────────────────────

test('getMcpToken: returns a 64-char hex string', () => {
  const token = getMcpToken();
  assert.equal(typeof token, 'string');
  assert.equal(token.length, 64);
  assert.match(token, /^[0-9a-f]{64}$/);
});

test('getMcpToken: returns the same value on repeated calls', () => {
  assert.equal(getMcpToken(), getMcpToken());
});

// ── getMcpAuthHeaders ─────────────────────────────────────────────────────────

test('getMcpAuthHeaders: returns Authorization header', () => {
  const headers = getMcpAuthHeaders();
  assert.ok('Authorization' in headers);
  assert.ok(headers.Authorization.startsWith('Bearer '));
});

test('getMcpAuthHeaders: Authorization value contains the token', () => {
  const headers = getMcpAuthHeaders();
  assert.equal(headers.Authorization, `Bearer ${getMcpToken()}`);
});

// ── validateMcpAuth ───────────────────────────────────────────────────────────

test('validateMcpAuth: returns true for valid bearer token', () => {
  const req = { headers: { authorization: AUTH_HEADER_VALUE } };
  assert.equal(validateMcpAuth(req), true);
});

test('validateMcpAuth: returns false for wrong token', () => {
  const req = { headers: { authorization: 'Bearer wrongtoken' } };
  assert.equal(validateMcpAuth(req), false);
});

test('validateMcpAuth: returns false for missing Authorization header', () => {
  const req = { headers: {} };
  assert.equal(validateMcpAuth(req), false);
});

test('validateMcpAuth: returns false for bare token (no Bearer prefix)', () => {
  const req = { headers: { authorization: MCP_TOKEN } };
  assert.equal(validateMcpAuth(req), false);
});

test('validateMcpAuth: returns false for empty string', () => {
  const req = { headers: { authorization: '' } };
  assert.equal(validateMcpAuth(req), false);
});

// ── localhost bypass ──────────────────────────────────────────────────────────

test('validateMcpAuth: bypass on — loopback 127.0.0.1 passes without token', () => {
  setLocalhostAuthBypass(true);
  const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(validateMcpAuth(req), true);
});

test('validateMcpAuth: bypass on — loopback ::1 passes without token', () => {
  setLocalhostAuthBypass(true);
  const req = { headers: {}, socket: { remoteAddress: '::1' } };
  assert.equal(validateMcpAuth(req), true);
});

test('validateMcpAuth: bypass on — loopback ::ffff:127.0.0.1 passes without token', () => {
  setLocalhostAuthBypass(true);
  const req = { headers: {}, socket: { remoteAddress: '::ffff:127.0.0.1' } };
  assert.equal(validateMcpAuth(req), true);
});

test('validateMcpAuth: bypass on — non-loopback still requires valid token', () => {
  setLocalhostAuthBypass(true);
  const req = { headers: {}, socket: { remoteAddress: '192.168.1.5' } };
  assert.equal(validateMcpAuth(req), false);
});

test('validateMcpAuth: bypass off — loopback requires valid token', () => {
  setLocalhostAuthBypass(false);
  const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(validateMcpAuth(req), false);
});

test('validateMcpAuth: bypass off — valid token still passes from loopback', () => {
  setLocalhostAuthBypass(false);
  const req = { headers: { authorization: AUTH_HEADER_VALUE }, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(validateMcpAuth(req), true);
});

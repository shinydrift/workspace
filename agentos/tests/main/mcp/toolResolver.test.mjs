/**
 * Tests for main/mcp/toolResolver.ts — resolveDisallowedTools (inlined).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from main/mcp/toolResolver.ts ────────────────────────────────────

const DANGEROUS_TOOLS = new Set(['post_update', 'ask_clarification']);

function resolveDisallowedTools(_agentRole) {
  return [];
}

// ── resolveDisallowedTools ────────────────────────────────────────────────────

test('resolveDisallowedTools always returns empty array', () => {
  assert.deepEqual(resolveDisallowedTools('task-main'), []);
  assert.deepEqual(resolveDisallowedTools('stage-researching'), []);
  assert.deepEqual(resolveDisallowedTools('stage-implementing'), []);
  assert.deepEqual(resolveDisallowedTools('stage-reviewing'), []);
});

// ── DANGEROUS_TOOLS ───────────────────────────────────────────────────────────

test('DANGEROUS_TOOLS includes post_update', () => {
  assert.ok(DANGEROUS_TOOLS.has('post_update'));
});

test('DANGEROUS_TOOLS includes ask_clarification', () => {
  assert.ok(DANGEROUS_TOOLS.has('ask_clarification'));
});

test('DANGEROUS_TOOLS does not include safe tools', () => {
  assert.ok(!DANGEROUS_TOOLS.has('Read'));
  assert.ok(!DANGEROUS_TOOLS.has('WebSearch'));
  assert.ok(!DANGEROUS_TOOLS.has('Bash'));
});

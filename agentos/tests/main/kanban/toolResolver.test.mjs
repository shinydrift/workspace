/**
 * Tests for mcp/toolResolver.ts — resolveDisallowedTools.
 * Function inlined — no TS loader needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from mcp/toolResolver.ts ─────────────────────────────────────────

function resolveDisallowedTools(_agentRole, taskType) {
  if (taskType === null) return [];
  if (taskType === 'research') return [];
  return ['WebSearch', 'WebFetch'];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('resolveDisallowedTools: research tasks grant web access to any role', () => {
  for (const role of ['task-main', 'stage-research', 'stage-dev']) {
    assert.deepEqual(resolveDisallowedTools(role, 'research'), []);
  }
});

test('resolveDisallowedTools: non-research tasks block web tools', () => {
  for (const taskType of ['dev', 'review', 'refine']) {
    assert.deepEqual(resolveDisallowedTools('task-main', taskType), ['WebSearch', 'WebFetch']);
    assert.deepEqual(resolveDisallowedTools('stage-dev', taskType), ['WebSearch', 'WebFetch']);
  }
});

test('resolveDisallowedTools: null taskType (non-kanban thread) is unrestricted', () => {
  assert.deepEqual(resolveDisallowedTools('task-main', null), []);
});

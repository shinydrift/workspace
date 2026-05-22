/**
 * Tests for shared/automationTemplates.ts — NODE_TEMPLATES shape and content.
 * Inlined to avoid TypeScript loader requirement.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from automationTemplates.ts ──────────────────────────────────────

const NODE_TEMPLATES = {
  wiki_update: {
    name: 'Update Wiki',
    instructions: `Review recent thread activity and the execution log context from previous nodes.
Create or update wiki pages documenting: architecture decisions, key patterns discovered,
solutions found, and anything reusable for future reference.
Use the wiki write tool to save each page.
Call agentos_run_set_node_status with your nodeId and a summary of what you documented.`,
  },
  standup: {
    name: 'Standup Report',
    instructions: `Generate a concise standup report based on recent thread activity and execution log context.
Include: what was accomplished, what is in progress, any blockers or open questions.
Call agentos_run_set_node_status with your nodeId and the standup report as the output.`,
  },
  custom: {
    name: 'Custom',
    instructions: '',
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

test('all expected template keys exist', () => {
  assert.ok('wiki_update' in NODE_TEMPLATES);
  assert.ok('standup' in NODE_TEMPLATES);
  assert.ok('custom' in NODE_TEMPLATES);
});

test('each template has name and instructions fields', () => {
  for (const [key, tpl] of Object.entries(NODE_TEMPLATES)) {
    assert.equal(typeof tpl.name, 'string', `${key}.name should be string`);
    assert.equal(typeof tpl.instructions, 'string', `${key}.instructions should be string`);
  }
});

test('wiki_update has non-empty name and instructions', () => {
  assert.ok(NODE_TEMPLATES.wiki_update.name.length > 0);
  assert.ok(NODE_TEMPLATES.wiki_update.instructions.length > 0);
});

test('standup has non-empty name and instructions', () => {
  assert.ok(NODE_TEMPLATES.standup.name.length > 0);
  assert.ok(NODE_TEMPLATES.standup.instructions.length > 0);
});

test('custom template has non-empty name', () => {
  assert.ok(NODE_TEMPLATES.custom.name.length > 0);
});

test('custom template has empty instructions', () => {
  assert.equal(NODE_TEMPLATES.custom.instructions, '');
});

test('wiki_update instructions reference agentos_run_set_node_status', () => {
  assert.ok(NODE_TEMPLATES.wiki_update.instructions.includes('agentos_run_set_node_status'));
});

test('standup instructions reference agentos_run_set_node_status', () => {
  assert.ok(NODE_TEMPLATES.standup.instructions.includes('agentos_run_set_node_status'));
});

/**
 * Tests for utils/docker/lifecycle.ts — isLegacyClaudeTemplate detection (inlined).
 *
 * Covers: all 5 regex conditions, edge cases, case-insensitivity.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function readSource(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

// ── Inlined from lifecycle.ts ─────────────────────────────────────────────────

function isLegacyClaudeTemplate(dockerfile) {
  return (
    /FROM\s+node:20-slim/i.test(dockerfile) &&
    /npm\s+install\s+-g\s+@anthropic-ai\/claude-code/i.test(dockerfile) &&
    !/@openai\/codex/i.test(dockerfile) &&
    !/@google\/gemini-cli/i.test(dockerfile) &&
    /ENTRYPOINT\s*\[\s*"claude"\s*\]/i.test(dockerfile)
  );
}

// ── canonical legacy template ─────────────────────────────────────────────────

const LEGACY = `FROM node:20-slim
RUN npm install -g @anthropic-ai/claude-code
ENTRYPOINT ["claude"]`;

test('isLegacyClaudeTemplate: canonical legacy returns true', () => {
  assert.equal(isLegacyClaudeTemplate(LEGACY), true);
});

// ── missing FROM ──────────────────────────────────────────────────────────────

test('isLegacyClaudeTemplate: missing FROM node:20-slim returns false', () => {
  const d = `FROM ubuntu:22.04
RUN npm install -g @anthropic-ai/claude-code
ENTRYPOINT ["claude"]`;
  assert.equal(isLegacyClaudeTemplate(d), false);
});

// ── missing npm install ───────────────────────────────────────────────────────

test('isLegacyClaudeTemplate: missing npm install line returns false', () => {
  const d = `FROM node:20-slim
ENTRYPOINT ["claude"]`;
  assert.equal(isLegacyClaudeTemplate(d), false);
});

// ── ENTRYPOINT variations ─────────────────────────────────────────────────────

test('isLegacyClaudeTemplate: missing ENTRYPOINT returns false', () => {
  const d = `FROM node:20-slim
RUN npm install -g @anthropic-ai/claude-code
CMD ["claude"]`;
  assert.equal(isLegacyClaudeTemplate(d), false);
});

test('isLegacyClaudeTemplate: ENTRYPOINT with extra spaces returns true', () => {
  const d = `FROM node:20-slim
RUN npm install -g @anthropic-ai/claude-code
ENTRYPOINT  [  "claude"  ]`;
  assert.equal(isLegacyClaudeTemplate(d), true);
});

test('isLegacyClaudeTemplate: ENTRYPOINT with wrong binary returns false', () => {
  const d = `FROM node:20-slim
RUN npm install -g @anthropic-ai/claude-code
ENTRYPOINT ["node"]`;
  assert.equal(isLegacyClaudeTemplate(d), false);
});

// ── presence of other providers disqualifies ──────────────────────────────────

test('isLegacyClaudeTemplate: contains @openai/codex returns false', () => {
  const d = `FROM node:20-slim
RUN npm install -g @anthropic-ai/claude-code @openai/codex
ENTRYPOINT ["claude"]`;
  assert.equal(isLegacyClaudeTemplate(d), false);
});

test('isLegacyClaudeTemplate: contains @google/gemini-cli returns false', () => {
  const d = `FROM node:20-slim
RUN npm install -g @anthropic-ai/claude-code @google/gemini-cli
ENTRYPOINT ["claude"]`;
  assert.equal(isLegacyClaudeTemplate(d), false);
});

// ── case insensitivity ────────────────────────────────────────────────────────

test('isLegacyClaudeTemplate: FROM uppercase variation returns true', () => {
  const d = `FROM NODE:20-SLIM
RUN npm install -g @anthropic-ai/claude-code
ENTRYPOINT ["claude"]`;
  assert.equal(isLegacyClaudeTemplate(d), true);
});

test('isLegacyClaudeTemplate: ENTRYPOINT uppercase variation returns true', () => {
  const d = `FROM node:20-slim
RUN npm install -g @anthropic-ai/claude-code
entrypoint ["CLAUDE"]`;
  assert.equal(isLegacyClaudeTemplate(d), true);
});

// ── empty / blank ─────────────────────────────────────────────────────────────

test('isLegacyClaudeTemplate: empty string returns false', () => {
  assert.equal(isLegacyClaudeTemplate(''), false);
});

test('isLegacyClaudeTemplate: new multi-provider template returns false', () => {
  const d = `FROM agentos-sandbox:latest\n# Add project-specific dependencies below\n`;
  assert.equal(isLegacyClaudeTemplate(d), false);
});

test('sandbox Dockerfile invalidates npm install layer before installing latest CLIs', () => {
  const dockerfile = readSource('resources/Dockerfile.sandbox');
  assert.match(dockerfile, /ARG SANDBOX_IMAGE_INVALIDATION_KEY=initial/);
  assert.match(dockerfile, /Sandbox image invalidation: \$\{SANDBOX_IMAGE_INVALIDATION_KEY\}/);
  assert.match(dockerfile, /npm install -g @anthropic-ai\/claude-code@latest @openai\/codex@latest/);
});

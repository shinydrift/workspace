/**
 * Tests for sessions/threadStartConfig.ts — pure config-derivation logic (inlined).
 * Tests sandbox merging, provider args construction, and flag derivation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined pure logic from threadStartConfig.ts ──────────────────────────────

function resolveEffectiveSandbox(settingsSandbox, projectSandbox) {
  return {
    ...(settingsSandbox ?? {}),
    ...(projectSandbox ?? {}),
  };
}

function resolveMemoryAndBoot(projectConfig) {
  return {
    memoryEnabled: projectConfig?.memory?.enabled ?? true,
    bootEnabled: projectConfig?.boot?.enabled ?? true,
  };
}

// Mirrors the provider args logic
function resolveProviderArgs(provider, useClaudeStreamJson, skipPermissions) {
  if (provider !== 'claude') return [];
  return [
    ...(useClaudeStreamJson ? ['--output-format', 'stream-json'] : []),
    ...(skipPermissions ? ['--dangerously-skip-permissions'] : []),
  ];
}

// Mirrors useClaudeStreamJson condition
function resolveUseClaudeStreamJson(provider, useHeadless, claudeStreamJson, forceClaudePlainText) {
  return !useHeadless && provider === 'claude' && (claudeStreamJson ?? true) && !forceClaudePlainText;
}

// ── resolveEffectiveSandbox ───────────────────────────────────────────────────

test('project sandbox overrides settings sandbox', () => {
  const result = resolveEffectiveSandbox({ timeout: 30, network: false }, { timeout: 60 });
  assert.equal(result.timeout, 60);
  assert.equal(result.network, false);
});

test('settings sandbox used when no project config', () => {
  const result = resolveEffectiveSandbox({ timeout: 30 }, undefined);
  assert.equal(result.timeout, 30);
});

test('empty when both undefined', () => {
  const result = resolveEffectiveSandbox(undefined, undefined);
  assert.deepEqual(result, {});
});

test('project sandbox used when settings undefined', () => {
  const result = resolveEffectiveSandbox(undefined, { network: true });
  assert.equal(result.network, true);
});

// ── resolveMemoryAndBoot ──────────────────────────────────────────────────────

test('defaults to enabled when no project config', () => {
  const { memoryEnabled, bootEnabled } = resolveMemoryAndBoot(null);
  assert.equal(memoryEnabled, true);
  assert.equal(bootEnabled, true);
});

test('respects explicit false in project config', () => {
  const { memoryEnabled, bootEnabled } = resolveMemoryAndBoot({
    memory: { enabled: false },
    boot: { enabled: false },
  });
  assert.equal(memoryEnabled, false);
  assert.equal(bootEnabled, false);
});

test('explicit true preserved', () => {
  const { memoryEnabled } = resolveMemoryAndBoot({ memory: { enabled: true } });
  assert.equal(memoryEnabled, true);
});

// ── resolveProviderArgs ───────────────────────────────────────────────────────

test('non-claude provider returns empty args', () => {
  assert.deepEqual(resolveProviderArgs('codex', false, true), []);
  assert.deepEqual(resolveProviderArgs('gemini', true, true), []);
});

test('claude with stream-json and skip-permissions', () => {
  const args = resolveProviderArgs('claude', true, true);
  assert.deepEqual(args, ['--output-format', 'stream-json', '--dangerously-skip-permissions']);
});

test('claude with stream-json only', () => {
  const args = resolveProviderArgs('claude', true, false);
  assert.deepEqual(args, ['--output-format', 'stream-json']);
});

test('claude with skip-permissions only', () => {
  const args = resolveProviderArgs('claude', false, true);
  assert.deepEqual(args, ['--dangerously-skip-permissions']);
});

test('claude with neither flag', () => {
  const args = resolveProviderArgs('claude', false, false);
  assert.deepEqual(args, []);
});

// ── resolveUseClaudeStreamJson ────────────────────────────────────────────────

test('true for claude non-headless with claudeStreamJson unset', () => {
  assert.equal(resolveUseClaudeStreamJson('claude', false, undefined, false), true);
});

test('false when forceClaudePlainText', () => {
  assert.equal(resolveUseClaudeStreamJson('claude', false, true, true), false);
});

test('false when provider is not claude', () => {
  assert.equal(resolveUseClaudeStreamJson('codex', false, true, false), false);
});

test('false when useHeadless', () => {
  assert.equal(resolveUseClaudeStreamJson('claude', true, true, false), false);
});

test('false when claudeStreamJson is false', () => {
  assert.equal(resolveUseClaudeStreamJson('claude', false, false, false), false);
});

// ── provider extras injection (inlined from threadStartConfig.ts) ─────────────

// Mirrors the injection augmentation logic for non-Claude providers
function applyProviderExtras(provider, injectionPayload, globalClaudeMdContent, skillsPrompt) {
  if (provider === 'claude') return injectionPayload;
  const extraParts = [];
  if (globalClaudeMdContent) extraParts.push(globalClaudeMdContent);
  if (skillsPrompt) extraParts.push(skillsPrompt);
  if (extraParts.length === 0) return injectionPayload;
  const extra = extraParts.join('\n\n');
  return {
    ...injectionPayload,
    payload: injectionPayload.payload ? `${injectionPayload.payload}\n\n${extra}` : extra,
  };
}

test('claude provider: injection payload unchanged', () => {
  const payload = { payload: 'original', hasBoot: false, hasMemory: false, warnings: [], projectMemoryPath: null };
  const result = applyProviderExtras('claude', payload, 'global instructions', 'skills block');
  assert.equal(result.payload, 'original');
});

test('codex: appends global CLAUDE.md to existing payload', () => {
  const payload = { payload: 'boot content', hasBoot: true, hasMemory: false, warnings: [], projectMemoryPath: null };
  const result = applyProviderExtras('codex', payload, 'global instructions', null);
  assert.ok(result.payload.startsWith('boot content'));
  assert.ok(result.payload.includes('global instructions'));
});

test('codex: appends skills to existing payload', () => {
  const payload = { payload: 'boot content', hasBoot: true, hasMemory: false, warnings: [], projectMemoryPath: null };
  const result = applyProviderExtras('codex', payload, null, '## Available Skills');
  assert.ok(result.payload.includes('boot content'));
  assert.ok(result.payload.includes('## Available Skills'));
});

test('gemini: uses extras as payload when base payload is null', () => {
  const payload = { payload: null, hasBoot: false, hasMemory: false, warnings: [], projectMemoryPath: null };
  const result = applyProviderExtras('gemini', payload, 'global instructions', '## Skills');
  assert.ok(result.payload.includes('global instructions'));
  assert.ok(result.payload.includes('## Skills'));
});

test('codex: payload unchanged when no extras provided', () => {
  const payload = { payload: 'existing', hasBoot: false, hasMemory: false, warnings: [], projectMemoryPath: null };
  const result = applyProviderExtras('codex', payload, null, null);
  assert.equal(result.payload, 'existing');
});

test('gemini: non-payload fields preserved', () => {
  const payload = {
    payload: 'base',
    hasBoot: true,
    hasMemory: false,
    warnings: ['w1'],
    projectMemoryPath: '/some/path',
  };
  const result = applyProviderExtras('gemini', payload, 'extras', null);
  assert.equal(result.hasBoot, true);
  assert.deepEqual(result.warnings, ['w1']);
  assert.equal(result.projectMemoryPath, '/some/path');
});

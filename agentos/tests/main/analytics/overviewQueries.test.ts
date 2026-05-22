/**
 * Tests for src/main/analytics/overviewQueries.ts — pure mapper functions.
 * No database required: toProjectInsightsWindow and toGlobalInsightsWindow
 * are stateless row-to-object transforms.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { toProjectInsightsWindow, toGlobalInsightsWindow } from '../../../src/main/analytics/overviewQueries';
import type { ProjectWindowTotalsRow, GlobalWindowTotalsRow } from '../../../src/main/analytics/overviewQueries';

const baseRow: ProjectWindowTotalsRow = {
  total_input: 1000,
  total_output: 2000,
  total_cache_read: 300,
  total_cache_creation: 400,
  total_cost: 500,
  week_input: 10,
  week_output: 20,
  week_cache_read: 3,
  week_cache_creation: 4,
  week_cost: 5,
  week_sessions: 2,
  prev_input: 100,
  prev_output: 200,
  prev_cache_read: 30,
  prev_cache_creation: 40,
  prev_cost: 50,
  prev_sessions: 8,
};

const globalRow: GlobalWindowTotalsRow = {
  ...baseRow,
  week_projects: 7,
  prev_projects: 3,
};

// ── toProjectInsightsWindow ───────────────────────────────────────────────────

test('toProjectInsightsWindow week maps week_* fields', () => {
  const window = toProjectInsightsWindow(baseRow, 'week');
  assert.deepStrictEqual(window, {
    totalInputTokens: 10,
    totalOutputTokens: 20,
    totalCacheReadTokens: 3,
    totalCacheCreationTokens: 4,
    totalCostUsdMicro: 5,
    sessionCount: 2,
  });
});

test('toProjectInsightsWindow prev maps prev_* fields', () => {
  const window = toProjectInsightsWindow(baseRow, 'prev');
  assert.deepStrictEqual(window, {
    totalInputTokens: 100,
    totalOutputTokens: 200,
    totalCacheReadTokens: 30,
    totalCacheCreationTokens: 40,
    totalCostUsdMicro: 50,
    sessionCount: 8,
  });
});

// ── toGlobalInsightsWindow ────────────────────────────────────────────────────

test('toGlobalInsightsWindow week includes week_projects', () => {
  const window = toGlobalInsightsWindow(globalRow, 'week');
  assert.strictEqual(window.projectCount, 7);
  assert.strictEqual(window.totalInputTokens, 10);
  assert.strictEqual(window.sessionCount, 2);
});

test('toGlobalInsightsWindow prev includes prev_projects', () => {
  const window = toGlobalInsightsWindow(globalRow, 'prev');
  assert.strictEqual(window.projectCount, 3);
  assert.strictEqual(window.totalInputTokens, 100);
  assert.strictEqual(window.sessionCount, 8);
});

test('toGlobalInsightsWindow spreads project fields from toProjectInsightsWindow', () => {
  const week = toGlobalInsightsWindow(globalRow, 'week');
  const { projectCount: _, ...rest } = week;
  assert.deepStrictEqual(rest, toProjectInsightsWindow(globalRow, 'week'));
});

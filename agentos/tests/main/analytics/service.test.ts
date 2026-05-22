/**
 * Tests for AnalyticsService.init() idempotency in src/main/analytics/service.ts.
 *
 * Verifies that init() registers internalBus listeners exactly once on double-call,
 * and that dispose() + init() correctly re-registers them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import type { AnalyticsService as AnalyticsServiceType } from '../../../src/main/analytics/service';

// ── Stateful mock ──────────────────────────────────────────────────────────────

const busHandlers = new Map<string, Set<unknown>>();

const internalBusMock = {
  on: (event: string, fn: unknown) => {
    if (!busHandlers.has(event)) busHandlers.set(event, new Set());
    busHandlers.get(event)!.add(fn);
  },
  off: (event: string, fn: unknown) => {
    busHandlers.get(event)?.delete(fn);
  },
};

function resetMocks() {
  busHandlers.clear();
}

// ── Module._load mock ─────────────────────────────────────────────────────────

const origLoad = Module._load as (req: string, parent: unknown, isMain: boolean) => unknown;
(Module._load as unknown) = function (request: string, parent: unknown, isMain: boolean) {
  if (request.endsWith('/events') || request === '../events') {
    return { internalBus: internalBusMock };
  }
  if (request.endsWith('/analyticsStartup') || request === './analyticsStartup') {
    return { runStartupMaintenance: () => {} };
  }
  if (request.endsWith('/analyticsTracker') || request === './analyticsTracker') {
    return {
      AnalyticsTracker: class {
        constructor(_cb: unknown) {}
        onTokenUsage() {}
        onThreadIdle() {}
        recordAutomationRun() {}
        onAssistantMessage() {}
      },
    };
  }
  if (request.endsWith('/analyticsQueries') || request === './analyticsQueries') {
    return {
      AnalyticsQueries: class {
        invalidateCaches() {}
      },
    };
  }
  if (request.endsWith('/analyticsHelpers') || request === './analyticsHelpers') {
    return { safeDb: () => null, safeGlobalDb: () => null, getProjectIdForThread: () => null };
  }
  if (request.endsWith('/eventLog') || request.endsWith('/utils/eventLog')) {
    return { eventLogger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } };
  }
  return origLoad.call(this, request, parent, isMain);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { analyticsService } = require('../../../src/main/analytics/service') as {
  analyticsService: AnalyticsServiceType;
};

(Module._load as unknown) = origLoad;

// ── Tests ─────────────────────────────────────────────────────────────────────

test('AnalyticsService.init: registers token:usage and thread:idle listeners', () => {
  resetMocks();
  analyticsService.init();
  assert.strictEqual(busHandlers.get('token:usage')?.size ?? 0, 1);
  assert.strictEqual(busHandlers.get('thread:idle')?.size ?? 0, 1);
  analyticsService.dispose();
});

test('AnalyticsService.init: idempotent — double-init registers each listener exactly once', () => {
  resetMocks();
  analyticsService.init();
  analyticsService.init();
  assert.strictEqual(busHandlers.get('token:usage')?.size ?? 0, 1);
  assert.strictEqual(busHandlers.get('thread:idle')?.size ?? 0, 1);
  analyticsService.dispose();
});

test('AnalyticsService.dispose + init: re-registers listeners after disposal', () => {
  resetMocks();
  analyticsService.init();
  analyticsService.dispose();
  assert.strictEqual(busHandlers.get('token:usage')?.size ?? 0, 0, 'listeners removed after dispose');
  analyticsService.init();
  assert.strictEqual(busHandlers.get('token:usage')?.size ?? 0, 1, 'listener re-added after re-init');
  analyticsService.dispose();
});

import { z } from 'zod';
import { IPC_CHANNELS } from '../../../shared/types';
import { defineHandler } from '../ipcResponse';
import { analyticsService } from '../../analytics/service';
import { threadReads } from '../../sessions/ThreadManager';
import * as threadStore from '../../threads/threadStore';
import type { ToolCallStats, ToolCallInvocation, TurnMetric } from '../../../shared/types';
import { shortId, ThreadIdSchema, ProjectIdSchema } from './schemas';
import { getProviderRateLimits } from '../../analytics/providerRateLimitsStore';
import { refreshProviderRateLimits } from '../../analytics/providerRateLimitRefresh';
import { CacheWithTtl } from '../../utils/CacheWithTtl';

const JobIdReq = z.object({
  jobId: shortId,
  limit: z.number().int().positive().optional(),
  since: z.number().int().min(0).optional(),
});
const ProjectIdLimitReq = z.object({ projectId: shortId, limit: z.number().int().positive().optional() });

const ANALYTICS_TTL_MS = 30_000;

// Cache thread messages for the poll interval so repeated IPC calls within the same cycle
// share one disk read. TTL matches the 30s poll interval used by thread insights hooks.
const _msgCache = new CacheWithTtl<string, ReturnType<typeof threadReads.listMessages>>(ANALYTICS_TTL_MS);
function getCachedMessages(threadId: string) {
  return _msgCache.get(threadId, () => threadReads.listMessages(threadId));
}

// Longer-lived cache for project-level tool breakdown — matches the 30s poll interval.
// Avoids re-reading every thread's message file on each poll cycle.
const _projectBreakdownCache = new CacheWithTtl<string, ToolCallStats[]>(ANALYTICS_TTL_MS);
const _globalBreakdownCache = new CacheWithTtl<'_', ToolCallStats[]>(ANALYTICS_TTL_MS);

function computeToolBreakdown(threadId: string, since?: number): ToolCallStats[] {
  const allMessages = getCachedMessages(threadId);
  const messages = since != null ? allMessages.filter((m) => m.timestamp >= since) : allMessages;
  const toolUseIdToName = new Map<string, string>();
  const stats = new Map<string, ToolCallStats>();

  for (const msg of messages) {
    for (const block of msg.normalized?.blocks ?? []) {
      if (block.type === 'tool_use') {
        toolUseIdToName.set(block.id, block.name);
        if (!stats.has(block.name)) {
          stats.set(block.name, { name: block.name, count: 0, successCount: 0, errorCount: 0 });
        }
        stats.get(block.name)!.count++;
      } else if (block.type === 'tool_result') {
        const name = toolUseIdToName.get(block.toolUseId);
        if (name && stats.has(name)) {
          if (block.isError) {
            stats.get(name)!.errorCount++;
          } else {
            stats.get(name)!.successCount++;
          }
        }
      }
    }
  }

  return [...stats.values()].sort((a, b) => b.count - a.count);
}

const RESPONSE_TRUNCATE_CHARS = 2000;
// Tools whose responses must be kept intact for JSON parsing in the insights UI.
const NO_TRUNCATE_TOOLS = new Set(['mcp__agentos-memory__memory_search']);

function computeToolInvocations(threadId: string): ToolCallInvocation[] {
  const messages = getCachedMessages(threadId);
  const toolUseById = new Map<string, { name: string; input: unknown; calledAt: number }>();
  const invocations: ToolCallInvocation[] = [];

  for (const msg of messages) {
    for (const block of msg.normalized?.blocks ?? []) {
      if (block.type === 'tool_use') {
        toolUseById.set(block.id, { name: block.name, input: block.input, calledAt: msg.timestamp });
      } else if (block.type === 'tool_result') {
        const use = toolUseById.get(block.toolUseId);
        if (use) {
          const shouldTruncate = !NO_TRUNCATE_TOOLS.has(use.name);
          invocations.push({
            id: block.toolUseId,
            name: use.name,
            input: use.input,
            response:
              shouldTruncate && block.content.length > RESPONSE_TRUNCATE_CHARS
                ? block.content.slice(0, RESPONSE_TRUNCATE_CHARS) + '…'
                : block.content,
            isError: block.isError ?? false,
            calledAt: use.calledAt,
          });
        }
      }
    }
  }

  return invocations;
}

function computeTurnMetrics(threadId: string): TurnMetric[] {
  const messages = getCachedMessages(threadId);
  const sessionStartedAt = analyticsService.getSessionMetrics(threadId)?.startedAt ?? null;
  const result: TurnMetric[] = [];
  let turn = 0;
  let lastUserTs: number | null = null;
  for (const msg of messages) {
    if (msg.role !== 'assistant') {
      lastUserTs = msg.timestamp;
      continue;
    }
    turn++;
    const toolCallCount = (msg.normalized?.blocks ?? []).filter((b) => b.type === 'tool_use').length;
    const startedAt = lastUserTs ?? sessionStartedAt ?? msg.timestamp;
    result.push({ turn, toolCallCount, startedAt, timestamp: msg.timestamp, firstChunkAt: msg.firstChunkAt });
  }
  return result;
}

function aggregateToolStats(stats: ToolCallStats[][]): ToolCallStats[] {
  const agg = new Map<string, ToolCallStats>();
  for (const breakdown of stats) {
    for (const stat of breakdown) {
      const existing = agg.get(stat.name);
      if (existing) {
        existing.count += stat.count;
        existing.successCount += stat.successCount;
        existing.errorCount += stat.errorCount;
      } else {
        agg.set(stat.name, { ...stat });
      }
    }
  }
  return [...agg.values()].sort((a, b) => b.count - a.count);
}

function computeToolBreakdownForIds(threadIds: string[]): ToolCallStats[] {
  return aggregateToolStats(threadIds.map((id) => computeToolBreakdown(id)));
}

function loadProjectThreadIds(projectId: string): string[] {
  return threadStore.getThreadsByProject(projectId).map((t) => t.id);
}

export function computeProjectToolBreakdown(projectId: string): ToolCallStats[] {
  return _projectBreakdownCache.get(projectId, () => {
    let data = analyticsService.getProjectToolBreakdown(projectId);
    if (data.length === 0) {
      const ids = loadProjectThreadIds(projectId);
      data = computeToolBreakdownForIds(ids);
      analyticsService.replaceProjectToolBreakdown(projectId, data);
    }
    return data;
  });
}

function computeGlobalToolBreakdown(): ToolCallStats[] {
  return _globalBreakdownCache.get('_', () => {
    const threads = threadStore.getAllThreads();
    const projectIds = new Set<string>();
    for (const t of threads) projectIds.add(t.projectId);
    for (const projectId of projectIds) {
      if (_projectBreakdownCache.has(projectId)) continue;
      computeProjectToolBreakdown(projectId);
    }
    return analyticsService.getGlobalToolBreakdown();
  });
}

export function registerAnalyticsHandlers(): void {
  defineHandler(IPC_CHANNELS.ANALYTICS_GET_SESSION, ThreadIdSchema, ({ threadId: id }) =>
    analyticsService.getSessionMetrics(id)
  );

  defineHandler(IPC_CHANNELS.ANALYTICS_GET_RUNS, JobIdReq, ({ jobId, limit, since }) =>
    analyticsService.getAutomationRuns(jobId, limit, since)
  );

  defineHandler(IPC_CHANNELS.ANALYTICS_GET_TOP_THREADS, ProjectIdLimitReq, ({ projectId, limit }) =>
    analyticsService.getTopCostThreads(projectId, limit)
  );

  defineHandler(
    IPC_CHANNELS.ANALYTICS_GET_TOOL_BREAKDOWN,
    ThreadIdSchema.extend({ since: z.number().int().min(0).optional() }),
    ({ threadId: id, since }) => computeToolBreakdown(id, since)
  );

  defineHandler(IPC_CHANNELS.ANALYTICS_GET_TOOL_INVOCATIONS, ThreadIdSchema, ({ threadId: id }) =>
    computeToolInvocations(id)
  );

  defineHandler(IPC_CHANNELS.ANALYTICS_GET_TURN_METRICS, ThreadIdSchema, ({ threadId: id }) => computeTurnMetrics(id));

  defineHandler(IPC_CHANNELS.ANALYTICS_GET_PROJECT_OVERVIEW, ProjectIdSchema, ({ projectId }) =>
    analyticsService.getProjectOverview(projectId)
  );

  defineHandler(IPC_CHANNELS.ANALYTICS_GET_GLOBAL_OVERVIEW, z.undefined(), () => analyticsService.getGlobalOverview());

  defineHandler(IPC_CHANNELS.ANALYTICS_GET_PROJECT_TOOL_BREAKDOWN, ProjectIdSchema, ({ projectId }) =>
    computeProjectToolBreakdown(projectId)
  );

  defineHandler(IPC_CHANNELS.ANALYTICS_GET_GLOBAL_TOOL_BREAKDOWN, z.undefined(), () => computeGlobalToolBreakdown());

  defineHandler(IPC_CHANNELS.ANALYTICS_GET_GLOBAL_MEMORY_GET_COUNT, z.undefined(), () =>
    analyticsService.getGlobalMemoryGetCount()
  );

  defineHandler(IPC_CHANNELS.ANALYTICS_GET_PROVIDER_RATE_LIMITS, z.undefined(), () => {
    void refreshProviderRateLimits();
    return getProviderRateLimits();
  });
}

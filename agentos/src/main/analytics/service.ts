import { internalBus } from '../events';
import { eventLogger } from '../utils/eventLog';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import { runStartupMaintenance } from './analyticsStartup';
import { safeDb } from './analyticsHelpers';
import { AnalyticsTracker, type RecordAutomationRunInput } from './analyticsTracker';
import { AnalyticsQueries } from './analyticsQueries';
import type { Disposable } from '../lifecycle';
import type {
  SessionMetrics,
  AnalyticsRunRecord,
  ProjectInsightsOverview,
  GlobalInsightsOverview,
  ToolCallStats,
} from '../../shared/types';
import type { TokenUsageEvent, ThreadIdleEvent } from '../events';

export type { RecordAutomationRunInput } from './analyticsTracker';

// ── AnalyticsService ───────────────────────────────────────────────────────────

class AnalyticsService implements Disposable {
  private readonly queries = new AnalyticsQueries();
  private readonly tracker = new AnalyticsTracker(() => this.queries.invalidateCaches());
  private readonly onTokenUsage = (event: TokenUsageEvent): void => this.tracker.onTokenUsage(event);
  private readonly onThreadIdle = (event: ThreadIdleEvent): void => this.tracker.onThreadIdle(event);
  private _initialized = false;

  init(): void {
    if (this._initialized) return;
    this._initialized = true;
    internalBus.on('token:usage', this.onTokenUsage);
    internalBus.on('thread:idle', this.onThreadIdle);
    runStartupMaintenance();
  }

  dispose(): void {
    this._initialized = false;
    internalBus.off('token:usage', this.onTokenUsage);
    internalBus.off('thread:idle', this.onThreadIdle);
  }

  recordAutomationRun(record: RecordAutomationRunInput): void {
    this.tracker.recordAutomationRun(record);
  }

  onAssistantMessage(
    threadId: string,
    turnCountDelta: number,
    toolStats: ToolCallStats[],
    memoryGetCallCount: number
  ): void {
    this.tracker.onAssistantMessage(threadId, turnCountDelta, toolStats, memoryGetCallCount);
  }

  getProjectMemoryGetCount(projectId: string): number {
    return this.queries.getProjectMemoryGetCount(projectId);
  }

  getGlobalMemoryGetCount(): number {
    return this.queries.getGlobalMemoryGetCount();
  }

  getProjectToolBreakdown(projectId: string): ToolCallStats[] {
    return this.queries.getProjectToolBreakdown(projectId);
  }

  replaceProjectToolBreakdown(projectId: string, stats: ToolCallStats[]): void {
    return this.queries.replaceProjectToolBreakdown(projectId, stats);
  }

  getGlobalToolBreakdown(): ToolCallStats[] {
    return this.queries.getGlobalToolBreakdown();
  }

  getSessionMetrics(threadId: string): SessionMetrics | null {
    return this.queries.getSessionMetrics(threadId);
  }

  getAutomationRuns(jobId: string, limit?: number, since?: number): AnalyticsRunRecord[] {
    return this.queries.getAutomationRuns(jobId, limit, since);
  }

  getTopCostThreads(projectId: string, limit?: number): SessionMetrics[] {
    return this.queries.getTopCostThreads(projectId, limit);
  }

  getProjectOverview(projectId: string): ProjectInsightsOverview {
    return this.queries.getProjectOverview(projectId);
  }

  getGlobalOverview(): GlobalInsightsOverview {
    return this.queries.getGlobalOverview();
  }

  deleteThreadAnalytics(threadId: string): void {
    const db = safeDb();
    if (!db) return;
    try {
      db.transaction(() => {
        db.prepare('DELETE FROM session_metrics WHERE thread_id = ?').run(threadId);
        db.prepare('DELETE FROM automation_runs WHERE thread_id = ?').run(threadId);
      })();
      this.queries.invalidateCaches();
    } catch (err) {
      eventLogger.warn('analytics', 'Failed to delete thread analytics', { threadId, error: getErrorMessage(err) });
    }
  }

  deleteProjectAnalytics(projectId: string): void {
    const db = safeDb();
    if (!db) return;
    try {
      db.transaction(() => {
        db.prepare('DELETE FROM project_daily_stats WHERE project_id = ?').run(projectId);
        db.prepare('DELETE FROM project_totals WHERE project_id = ?').run(projectId);
        db.prepare('DELETE FROM project_tool_stats WHERE project_id = ?').run(projectId);
        db.prepare('DELETE FROM session_metrics WHERE project_id = ?').run(projectId);
        db.prepare('DELETE FROM automation_runs WHERE project_id = ?').run(projectId);
      })();
      this.queries.invalidateCaches();
    } catch (err) {
      eventLogger.warn('analytics', 'Failed to delete project analytics', { projectId, error: getErrorMessage(err) });
    }
  }
}

export const analyticsService = new AnalyticsService();

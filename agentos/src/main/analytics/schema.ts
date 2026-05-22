import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const analyticsMeta = sqliteTable('analytics_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull().default(''),
});

export const sessionMetrics = sqliteTable('session_metrics', {
  threadId: text('thread_id').primaryKey(),
  projectId: text('project_id').notNull(),
  provider: text('provider').notNull(),
  model: text('model'),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  turnCount: integer('turn_count').notNull().default(0),
  toolCallCount: integer('tool_call_count').notNull().default(0),
  costUsdMicro: integer('cost_usd_micro').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
  memoryGetCount: integer('memory_get_count').notNull().default(0),
});

export const automationRuns = sqliteTable('automation_runs', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull(),
  threadId: text('thread_id').notNull(),
  projectId: text('project_id').notNull(),
  startedAt: integer('started_at').notNull(),
  completedAt: integer('completed_at'),
  status: text('status').notNull(),
  errorMessage: text('error_message'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  turnCount: integer('turn_count').notNull().default(0),
  toolCallCount: integer('tool_call_count').notNull().default(0),
  costUsdMicro: integer('cost_usd_micro').notNull().default(0),
});

export const projectDailyStats = sqliteTable(
  'project_daily_stats',
  {
    date: text('date').notNull(),
    projectId: text('project_id').notNull(),
    model: text('model').notNull().default(''),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsdMicro: integer('cost_usd_micro').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
    sessionCount: integer('session_count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.date, t.projectId, t.model] })]
);

export const projectTotals = sqliteTable('project_totals', {
  projectId: text('project_id').primaryKey(),
  memoryGetCount: integer('memory_get_count').notNull().default(0),
});

export const projectToolStats = sqliteTable(
  'project_tool_stats',
  {
    projectId: text('project_id').notNull(),
    toolName: text('tool_name').notNull(),
    count: integer('count').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.toolName] })]
);

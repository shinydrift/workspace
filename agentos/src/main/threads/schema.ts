import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    path: text('path').notNull(),
    subdir: text('subdir'),
    createdAt: integer('created_at').notNull(),
    lastUsedAt: integer('last_used_at').notNull(),
    dockerfileHash: text('dockerfile_hash'),
  },
  (table) => [index('idx_projects_path').on(table.path)]
);

export const threads = sqliteTable(
  'threads',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    workingDirectory: text('working_directory').notNull(),
    projectPath: text('project_path'),
    subdir: text('subdir'),
    usingWorktree: integer('using_worktree'),
    provider: text('provider'),
    model: text('model'),
    effort: text('effort'),
    reasoning: text('reasoning'),
    status: text('status').notNull(),
    createdAt: integer('created_at').notNull(),
    lastActiveAt: integer('last_active_at').notNull(),
    exitCode: integer('exit_code'),
    queueDepth: integer('queue_depth'),
    autopilotEnabled: integer('autopilot_enabled'),
    autopilotState: text('autopilot_state'),
    autopilotLastReason: text('autopilot_last_reason'),
    autopilotConsecutiveTurns: integer('autopilot_consecutive_turns'),
    currentReaction: text('current_reaction'),
    claudeSessionId: text('claude_session_id'),
    codexSessionId: text('codex_session_id'),
    geminiSessionId: text('gemini_session_id'),
    piSessionId: text('pi_session_id'),
    archivedAt: integer('archived_at'),
    agentRole: text('agent_role'),
    taskId: text('task_id'),
    skillTags: text('skill_tags'),
    parentThreadId: text('parent_thread_id').references((): AnySQLiteColumn => threads.id, { onDelete: 'set null' }),
    councilRunId: text('council_run_id'),
    recordingId: text('recording_id').references((): AnySQLiteColumn => recordings.id, { onDelete: 'set null' }),
  },
  (table) => [
    index('idx_threads_project').on(table.projectId),
    index('idx_threads_status').on(table.status),
    index('idx_threads_last_active').on(table.lastActiveAt),
    index('idx_threads_parent').on(table.parentThreadId),
  ]
);

export const threadPromptHistory = sqliteTable(
  'thread_prompt_history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    prompt: text('prompt').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [
    uniqueIndex('thread_prompt_history_thread_position').on(table.threadId, table.position),
    index('idx_tph_thread').on(table.threadId),
  ]
);

export const automationJobs = sqliteTable(
  'automation_jobs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    trigger: text('trigger').notNull(),
    instructions: text('instructions').notNull(),
    kanbanTaskTemplate: text('kanban_task_template'),
    isSystem: integer('is_system').notNull().default(0),
    provider: text('provider'),
    model: text('model'),
    effort: text('effort'),
    reasoning: text('reasoning'),
    notification: text('notification'),
    enabled: integer('enabled').notNull().default(1),
    deleteAfterRun: integer('delete_after_run').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    lastRunAt: integer('last_run_at'),
    lastRunStatus: text('last_run_status'),
    lastRunError: text('last_run_error'),
    runCountOk: integer('run_count_ok').notNull().default(0),
    runCountError: integer('run_count_error').notNull().default(0),
    runHistory: text('run_history'),
  },
  (table) => [index('idx_automation_jobs_enabled').on(table.projectId, table.enabled)]
);

export const slackThreadBindings = sqliteTable(
  'slack_thread_bindings',
  {
    key: text('key').primaryKey(),
    medium: text('medium').notNull().default('slack'),
    threadId: text('thread_id').references(() => threads.id, { onDelete: 'set null' }),
    channelId: text('channel_id').notNull(),
    // Nullable: a channel-scoped binding (no reply anchor) echoes as new top-level messages.
    threadTs: text('thread_ts'),
    createdAt: integer('created_at').notNull(),
    lastInboundTs: text('last_inbound_ts'),
  },
  (table) => [index('idx_stb_channel').on(table.channelId), index('idx_stb_thread_id').on(table.threadId)]
);

export const slackChannelCursors = sqliteTable('slack_channel_cursors', {
  channelId: text('channel_id').primaryKey(),
  cursorTs: text('cursor_ts').notNull(),
});

export const recordings = sqliteTable(
  'recordings',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id').references((): AnySQLiteColumn => threads.id, { onDelete: 'set null' }),
    title: text('title'),
    audioPath: text('audio_path').notNull(),
    transcriptPath: text('transcript_path').notNull(),
    durationSeconds: real('duration_seconds').notNull(),
    createdAt: integer('created_at').notNull(),
    // null → a manual meeting recording (default). 'segment' → a rolling 5-minute
    // clip from continuous capture: excluded from the recordings list, time-slot
    // queryable, and auto-pruned after the retention window.
    kind: text('kind'),
  },
  (table) => [
    index('idx_recordings_thread_id').on(table.threadId),
    index('idx_recordings_created_at').on(table.createdAt),
    index('idx_recordings_kind_created').on(table.kind, table.createdAt),
  ]
);

export const webhookEvents = sqliteTable(
  'webhook_events',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => automationJobs.id, { onDelete: 'cascade' }),
    source: text('source'),
    payloadPath: text('payload_path').notNull(),
    headers: text('headers').notNull(),
    // CHECK (status IN ('pending','processing','processed','failed')) — enforced in raw DDL.
    status: text('status').notNull().default('pending'),
    error: text('error'),
    receivedAt: integer('received_at').notNull(),
    processedAt: integer('processed_at'),
  },
  (table) => [
    index('idx_webhook_events_job_id').on(table.jobId),
    index('idx_webhook_events_status').on(table.status),
    index('idx_webhook_events_cleanup').on(table.status, table.receivedAt),
  ]
);

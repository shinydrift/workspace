import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core';

export const councilMeta = sqliteTable('council_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull().default(''),
});

export const councilConfigs = sqliteTable('council_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  members: text('members').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const councilRuns = sqliteTable('council_runs', {
  id: text('id').primaryKey(),
  configId: text('config_id').notNull(),
  parentThreadId: text('parent_thread_id').notNull(),
  prompt: text('prompt').notNull(),
  childThreadIds: text('child_thread_ids').notNull().default('[]'),
  status: text('status').notNull().default('running'),
  createdAt: integer('created_at').notNull(),
  completedAt: integer('completed_at'),
  expiresAt: integer('expires_at'),
});

export const councilOutcomes = sqliteTable(
  'council_outcomes',
  {
    runId: text('run_id')
      .notNull()
      .references(() => councilRuns.id, { onDelete: 'cascade' }),
    childThreadId: text('child_thread_id').notNull(),
    memberProvider: text('member_provider').notNull(),
    memberModel: text('member_model').notNull().default(''),
    status: text('status').notNull(),
    summary: text('summary'),
    answer: text('answer'),
    confidence: real('confidence'),
    caveats: text('caveats'),
    raw: text('raw'),
    error: text('error'),
    submittedAt: integer('submitted_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.childThreadId] })]
);

export const councilChildMembers = sqliteTable(
  'council_child_members',
  {
    runId: text('run_id')
      .notNull()
      .references(() => councilRuns.id, { onDelete: 'cascade' }),
    childThreadId: text('child_thread_id').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull().default(''),
  },
  (t) => [primaryKey({ columns: [t.runId, t.childThreadId] })]
);

export const councilRunMembers = sqliteTable(
  'council_run_members',
  {
    runId: text('run_id')
      .notNull()
      .references(() => councilRuns.id, { onDelete: 'cascade' }),
    memberIdx: integer('member_idx').notNull(),
    childThreadId: text('child_thread_id'),
    provider: text('provider').notNull(),
    model: text('model').notNull().default(''),
    status: text('status').notNull().default('pending'),
  },
  (t) => [primaryKey({ columns: [t.runId, t.memberIdx] })]
);

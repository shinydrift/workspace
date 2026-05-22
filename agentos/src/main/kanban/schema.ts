import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const kanbanTasks = sqliteTable('kanban_tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').notNull().default('researching'),
  priority: text('priority').notNull().default('medium'),
  progress: integer('progress').notNull().default(0),
  assignedThreadId: text('assigned_thread_id'),
  mainThreadId: text('main_thread_id'),
  skillTags: text('skill_tags').notNull().default('[]'),
  branch: text('branch'),
  worktreePath: text('worktree_path'),
  classOfService: text('class_of_service').notNull().default('standard'),
  parentTaskId: text('parent_task_id'),
  dueAt: integer('due_at'),
  slackChannelId: text('slack_channel_id'),
  slackThreadTs: text('slack_thread_ts'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  completedAt: integer('completed_at'),
  metadata: text('metadata').notNull().default('{}'),
});

export const kanbanTaskNotes = sqliteTable('kanban_task_notes', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  threadId: text('thread_id'),
  content: text('content').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const kanbanWipLimits = sqliteTable(
  'kanban_wip_limits',
  {
    projectId: text('project_id').notNull(),
    status: text('status').notNull(),
    maxTasks: integer('max_tasks').notNull().default(3),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.status] })]
);

export const kanbanTaskEvents = sqliteTable('kanban_task_events', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  taskId: text('task_id').notNull(),
  threadId: text('thread_id'),
  kind: text('kind').notNull(),
  data: text('data').notNull().default('{}'),
  createdAt: integer('created_at').notNull(),
});

export const kanbanStages = sqliteTable(
  'kanban_stages',
  {
    projectId: text('project_id').notNull(),
    stageOrder: integer('stage_order').notNull().default(0),
    id: text('id').notNull(),
    label: text('label').notNull(),
    prompt: text('prompt').notNull().default(''),
    provider: text('provider'),
    model: text('model'),
    effort: text('effort'),
    reasoning: text('reasoning'),
    saveToMemory: integer('save_to_memory', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.id] })]
);

export const kanbanTaskDeps = sqliteTable(
  'kanban_task_deps',
  {
    projectId: text('project_id').notNull(),
    taskId: text('task_id').notNull(),
    blocksId: text('blocks_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.taskId, t.blocksId] })]
);

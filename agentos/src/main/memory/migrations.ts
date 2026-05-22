import type { MigrationDef } from '../db/drizzleMigrate';

// Migration name that maps to the old integer schema_version system.
// When upgrading from any schema_version, this baseline is pre-seeded as applied
// (the baseline uses CREATE TABLE IF NOT EXISTS, so re-running on existing DBs is safe,
// but we skip it anyway for clarity and to avoid re-running FTS virtual table DDL).
export const MEMORY_MIGRATION_NAMES = [
  '0001_baseline',
  '0002_stage_effort_reasoning',
  '0003_kanban_hardening',
  '0004_drop_stage_description',
  '0005_drop_task_type_add_stage_save_to_memory',
] as const;

export const MEMORY_MIGRATIONS: MigrationDef[] = [
  {
    name: '0001_baseline',
    sql: `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  path   TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'memory',
  hash   TEXT NOT NULL,
  mtime  INTEGER NOT NULL,
  size   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id                TEXT    PRIMARY KEY,
  path              TEXT    NOT NULL,
  source            TEXT    NOT NULL DEFAULT 'memory',
  start_line        INTEGER NOT NULL,
  end_line          INTEGER NOT NULL,
  hash              TEXT    NOT NULL,
  model             TEXT    NOT NULL,
  text              TEXT    NOT NULL,
  summary           TEXT    NOT NULL DEFAULT '',
  embedding         TEXT    NOT NULL DEFAULT '[]',
  updated_at        INTEGER NOT NULL,
  pinned            INTEGER NOT NULL DEFAULT 0,
  user_edited       INTEGER NOT NULL DEFAULT 0,
  context_header    TEXT    NOT NULL DEFAULT '',
  llm_graph_indexed INTEGER NOT NULL DEFAULT 0,
  project_ids       TEXT    NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_chunks_path         ON chunks(path);
CREATE INDEX IF NOT EXISTS idx_chunks_source_path  ON chunks(source, path, start_line);
CREATE INDEX IF NOT EXISTS idx_chunks_updated_at   ON chunks(updated_at);

CREATE TABLE IF NOT EXISTS embedding_cache (
  provider     TEXT    NOT NULL,
  model        TEXT    NOT NULL,
  provider_key TEXT    NOT NULL,
  hash         TEXT    NOT NULL,
  embedding    TEXT    NOT NULL,
  dims         INTEGER,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (provider, model, provider_key, hash)
);
CREATE INDEX IF NOT EXISTS idx_embedding_cache_updated_at ON embedding_cache(updated_at);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text, id UNINDEXED, path UNINDEXED, source UNINDEXED,
  model UNINDEXED, start_line UNINDEXED, end_line UNINDEXED
);

CREATE TABLE IF NOT EXISTS entities (
  id           TEXT    PRIMARY KEY,
  project_id   TEXT    NOT NULL,
  name         TEXT    NOT NULL,
  type         TEXT    NOT NULL,
  aliases      TEXT    NOT NULL DEFAULT '[]',
  chunk_ids    TEXT    NOT NULL DEFAULT '[]',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  content_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_entities_project_name    ON entities(project_id, name);
CREATE INDEX IF NOT EXISTS idx_entities_type            ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_project_updated ON entities(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS edges (
  id         TEXT    PRIMARY KEY,
  project_id TEXT    NOT NULL,
  from_id    TEXT    NOT NULL,
  to_id      TEXT    NOT NULL,
  relation   TEXT    NOT NULL,
  weight     REAL    NOT NULL DEFAULT 1.0,
  source     TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(project_id, from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to   ON edges(project_id, to_id);

CREATE TABLE IF NOT EXISTS observations (
  id              TEXT    PRIMARY KEY,
  entity_id       TEXT    NOT NULL,
  project_id      TEXT    NOT NULL,
  text            TEXT    NOT NULL,
  source_chunk_id TEXT,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id)
);
CREATE INDEX IF NOT EXISTS idx_obs_entity ON observations(project_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_obs_chunk  ON observations(source_chunk_id);

CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
  text, id UNINDEXED, entity_id UNINDEXED, project_id UNINDEXED
);

CREATE TABLE IF NOT EXISTS session_chunk_jobs (
  id         TEXT    PRIMARY KEY,
  thread_id  TEXT    NOT NULL,
  turn_index INTEGER NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_thread_status ON session_chunk_jobs(thread_id, status);

CREATE TABLE IF NOT EXISTS kanban_tasks (
  id                 TEXT    PRIMARY KEY,
  project_id         TEXT    NOT NULL,
  title              TEXT    NOT NULL,
  description        TEXT    NOT NULL DEFAULT '',
  status             TEXT    NOT NULL DEFAULT 'refinement',
  priority           TEXT    NOT NULL DEFAULT 'medium',
  progress           INTEGER NOT NULL DEFAULT 0,
  assigned_thread_id TEXT,
  main_thread_id     TEXT,
  skill_tags         TEXT    NOT NULL DEFAULT '[]',
  branch             TEXT,
  worktree_path      TEXT,
  task_type          TEXT    NOT NULL DEFAULT 'dev',
  class_of_service   TEXT    NOT NULL DEFAULT 'standard',
  parent_task_id     TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  completed_at       INTEGER,
  due_at             INTEGER,
  slack_channel_id   TEXT,
  slack_thread_ts    TEXT,
  metadata           TEXT    NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_kanban_tasks_project_status ON kanban_tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_kanban_tasks_assigned       ON kanban_tasks(assigned_thread_id);
CREATE INDEX IF NOT EXISTS idx_kanban_tasks_main_thread    ON kanban_tasks(main_thread_id);

CREATE TABLE IF NOT EXISTS kanban_task_notes (
  id         TEXT    PRIMARY KEY,
  task_id    TEXT    NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
  thread_id  TEXT,
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kanban_notes_task ON kanban_task_notes(task_id);

CREATE TABLE IF NOT EXISTS kanban_task_events (
  id         TEXT    PRIMARY KEY,
  project_id TEXT    NOT NULL,
  task_id    TEXT    NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
  thread_id  TEXT,
  kind       TEXT    NOT NULL,
  data       TEXT    NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kanban_events_task_created ON kanban_task_events(task_id, created_at);

CREATE TABLE IF NOT EXISTS kanban_wip_limits (
  project_id TEXT    NOT NULL,
  status     TEXT    NOT NULL,
  max_tasks  INTEGER NOT NULL DEFAULT 3,
  PRIMARY KEY (project_id, status)
);

CREATE TABLE IF NOT EXISTS chunk_expansions (
  chunk_id    TEXT    NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  expanded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunk_expansions_chunk_id    ON chunk_expansions(chunk_id);
CREATE INDEX IF NOT EXISTS idx_chunk_expansions_expanded_at ON chunk_expansions(expanded_at);

CREATE TABLE IF NOT EXISTS entity_chunks (
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  chunk_id  TEXT NOT NULL,
  PRIMARY KEY (entity_id, chunk_id)
);
CREATE INDEX IF NOT EXISTS idx_entity_chunks_chunk ON entity_chunks(chunk_id);

CREATE TABLE IF NOT EXISTS kanban_stages (
  project_id  TEXT    NOT NULL,
  stage_order INTEGER NOT NULL DEFAULT 0,
  id          TEXT    NOT NULL,
  label       TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  prompt      TEXT    NOT NULL DEFAULT '',
  provider    TEXT,
  model       TEXT,
  PRIMARY KEY (project_id, id)
);
CREATE INDEX IF NOT EXISTS idx_kanban_stages_project ON kanban_stages(project_id, stage_order);

CREATE TABLE IF NOT EXISTS kanban_task_deps (
  project_id TEXT NOT NULL,
  task_id    TEXT NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
  blocks_id  TEXT NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, task_id, blocks_id)
);
CREATE INDEX IF NOT EXISTS idx_kanban_task_deps_task   ON kanban_task_deps(project_id, task_id);
CREATE INDEX IF NOT EXISTS idx_kanban_task_deps_blocks ON kanban_task_deps(project_id, blocks_id);
`,
  },
  {
    name: '0002_stage_effort_reasoning',
    sql: `
ALTER TABLE kanban_stages ADD COLUMN effort TEXT;
ALTER TABLE kanban_stages ADD COLUMN reasoning TEXT;
`,
  },
  {
    name: '0003_kanban_hardening',
    sql: `
CREATE INDEX IF NOT EXISTS idx_kanban_tasks_parent  ON kanban_tasks(project_id, parent_task_id);
CREATE INDEX IF NOT EXISTS idx_kanban_tasks_due     ON kanban_tasks(project_id, due_at);
CREATE INDEX IF NOT EXISTS idx_kanban_events_kind   ON kanban_task_events(project_id, kind, created_at);
`,
  },
  {
    name: '0004_drop_stage_description',
    sql: `ALTER TABLE kanban_stages DROP COLUMN description;`,
  },
  {
    name: '0005_drop_task_type_add_stage_save_to_memory',
    sql: `
ALTER TABLE kanban_tasks DROP COLUMN task_type;
ALTER TABLE kanban_stages ADD COLUMN save_to_memory INTEGER NOT NULL DEFAULT 0;
`,
  },
];

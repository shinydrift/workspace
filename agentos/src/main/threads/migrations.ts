import type { MigrationDef } from '../db/drizzleMigrate';
import { eventLogger } from '../utils/eventLog';

export const THREADS_MIGRATIONS: MigrationDef[] = [
  {
    name: '0001_baseline',
    sql: `
CREATE TABLE IF NOT EXISTS threads_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  path            TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  last_used_at    INTEGER NOT NULL,
  dockerfile_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path);

CREATE TABLE IF NOT EXISTS threads (
  id                          TEXT PRIMARY KEY,
  name                        TEXT NOT NULL,
  project_id                  TEXT NOT NULL,
  working_directory           TEXT NOT NULL,
  project_path                TEXT,
  using_worktree              INTEGER,
  provider                    TEXT,
  model                       TEXT,
  effort                      TEXT,
  reasoning                   TEXT,
  status                      TEXT NOT NULL,
  created_at                  INTEGER NOT NULL,
  last_active_at              INTEGER NOT NULL,
  exit_code                   INTEGER,
  queue_depth                 INTEGER,
  autopilot_enabled           INTEGER,
  autopilot_state             TEXT,
  autopilot_last_reason       TEXT,
  autopilot_consecutive_turns INTEGER,
  claude_session_id           TEXT,
  codex_session_id            TEXT,
  gemini_session_id           TEXT,
  archived_at                 INTEGER,
  agent_role                  TEXT,
  task_id                     TEXT,
  skill_tags                  TEXT,
  parent_thread_id            TEXT,
  council_run_id              TEXT,
  recording_id                TEXT
);
CREATE INDEX IF NOT EXISTS idx_threads_project     ON threads(project_id);
CREATE INDEX IF NOT EXISTS idx_threads_status      ON threads(status);
CREATE INDEX IF NOT EXISTS idx_threads_last_active ON threads(last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_parent      ON threads(parent_thread_id);

CREATE TABLE IF NOT EXISTS thread_prompt_history (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT    NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  prompt    TEXT    NOT NULL,
  position  INTEGER NOT NULL,
  UNIQUE (thread_id, position)
);
CREATE INDEX IF NOT EXISTS idx_tph_thread ON thread_prompt_history(thread_id);

CREATE TABLE IF NOT EXISTS automation_jobs (
  id                   TEXT PRIMARY KEY,
  project_id           TEXT NOT NULL,
  name                 TEXT NOT NULL,
  description          TEXT,
  trigger              TEXT NOT NULL,
  instructions         TEXT NOT NULL,
  kanban_task_template TEXT,
  personality_refresh  INTEGER,
  notification         TEXT,
  enabled              INTEGER NOT NULL DEFAULT 1,
  delete_after_run     INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  last_run_at          INTEGER,
  last_run_status      TEXT,
  last_run_error       TEXT,
  run_count_ok         INTEGER NOT NULL DEFAULT 0,
  run_count_error      INTEGER NOT NULL DEFAULT 0,
  run_history          TEXT
);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_project_id ON automation_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_enabled    ON automation_jobs(project_id, enabled);

CREATE TABLE IF NOT EXISTS slack_thread_bindings (
  key             TEXT PRIMARY KEY,
  thread_id       TEXT,
  channel_id      TEXT NOT NULL,
  thread_ts       TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  last_inbound_ts TEXT,
  workspace_path  TEXT
);
CREATE INDEX IF NOT EXISTS idx_stb_channel   ON slack_thread_bindings(channel_id);
CREATE INDEX IF NOT EXISTS idx_stb_thread_id ON slack_thread_bindings(thread_id);

CREATE TABLE IF NOT EXISTS slack_channel_cursors (
  channel_id TEXT PRIMARY KEY,
  cursor_ts  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recordings (
  id               TEXT PRIMARY KEY,
  thread_id        TEXT,
  title            TEXT,
  audio_path       TEXT NOT NULL,
  transcript_path  TEXT NOT NULL,
  duration_seconds REAL NOT NULL,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recordings_thread_id ON recordings(thread_id);

CREATE TABLE IF NOT EXISTS webhook_events (
  id           TEXT PRIMARY KEY,
  job_id       TEXT NOT NULL,
  source       TEXT,
  payload_path TEXT NOT NULL,
  headers      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  error        TEXT,
  received_at  INTEGER NOT NULL,
  processed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_webhook_events_job_id ON webhook_events(job_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(status);
`,
  },
  {
    name: '0002_drop_kanban_coordinators',
    sql: `DROP TABLE IF EXISTS kanban_coordinators;`,
  },
  {
    name: '0003_add_pi_session_id',
    run: (db) => {
      const cols = db.prepare(`PRAGMA table_info(threads)`).all() as { name: string }[];
      if (!cols.some((c) => c.name === 'pi_session_id')) {
        db.exec(`ALTER TABLE threads ADD COLUMN pi_session_id TEXT`);
      }
    },
  },
  {
    // Closes drizzle/raw SQL drift, tightens constraints, and rebuilds tables to add the
    // FK relationships and CHECK on webhook_events.status. defer_foreign_keys lets the
    // rebuilds run inside the per-migration transaction; orphan rows are pruned first so
    // commit-time FK checks don't roll back the whole migration.
    //
    // Rebuild order is recordings → slack_thread_bindings → automation_jobs → threads.
    // threads ↔ recordings is a circular FK (recordings.thread_id → threads.id and
    // threads.recording_id → recordings.id). It commits cleanly because the orphan
    // cleanup above leaves every value either NULL or pointing at a row that the
    // INSERT … SELECT * preserves; defer_foreign_keys delays the check until the
    // whole rename dance is done.
    name: '0004_fks_checks_and_cleanup',
    run: (db) => {
      db.exec(`PRAGMA defer_foreign_keys = ON`);

      db.exec(`
DROP TABLE IF EXISTS threads_meta;
CREATE INDEX IF NOT EXISTS idx_recordings_created_at ON recordings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_cleanup ON webhook_events(status, received_at);
`);

      // Orphan cleanup before FKs activate. Counts surfaced via eventLogger so destructive
      // deletes are observable; a developer DB with stale rows from a deleted-project bug
      // would otherwise lose data silently.
      const cleanups: { label: string; countSql: string; runSql: string }[] = [
        {
          label: 'threads with missing project_id',
          countSql: `SELECT COUNT(*) AS n FROM threads WHERE project_id NOT IN (SELECT id FROM projects)`,
          runSql: `DELETE FROM threads WHERE project_id NOT IN (SELECT id FROM projects)`,
        },
        {
          label: 'threads.parent_thread_id pointing nowhere → set NULL',
          countSql: `SELECT COUNT(*) AS n FROM threads
                     WHERE parent_thread_id IS NOT NULL AND parent_thread_id NOT IN (SELECT id FROM threads)`,
          runSql: `UPDATE threads SET parent_thread_id = NULL
                   WHERE parent_thread_id IS NOT NULL AND parent_thread_id NOT IN (SELECT id FROM threads)`,
        },
        {
          label: 'threads.recording_id pointing nowhere → set NULL',
          countSql: `SELECT COUNT(*) AS n FROM threads
                     WHERE recording_id IS NOT NULL AND recording_id NOT IN (SELECT id FROM recordings)`,
          runSql: `UPDATE threads SET recording_id = NULL
                   WHERE recording_id IS NOT NULL AND recording_id NOT IN (SELECT id FROM recordings)`,
        },
        {
          label: 'automation_jobs with missing project_id',
          countSql: `SELECT COUNT(*) AS n FROM automation_jobs WHERE project_id NOT IN (SELECT id FROM projects)`,
          runSql: `DELETE FROM automation_jobs WHERE project_id NOT IN (SELECT id FROM projects)`,
        },
        {
          label: 'slack_thread_bindings.thread_id pointing nowhere → set NULL',
          countSql: `SELECT COUNT(*) AS n FROM slack_thread_bindings
                     WHERE thread_id IS NOT NULL AND thread_id NOT IN (SELECT id FROM threads)`,
          runSql: `UPDATE slack_thread_bindings SET thread_id = NULL
                   WHERE thread_id IS NOT NULL AND thread_id NOT IN (SELECT id FROM threads)`,
        },
        {
          label: 'recordings.thread_id pointing nowhere → set NULL',
          countSql: `SELECT COUNT(*) AS n FROM recordings
                     WHERE thread_id IS NOT NULL AND thread_id NOT IN (SELECT id FROM threads)`,
          runSql: `UPDATE recordings SET thread_id = NULL
                   WHERE thread_id IS NOT NULL AND thread_id NOT IN (SELECT id FROM threads)`,
        },
        {
          label: 'webhook_events with missing job_id',
          countSql: `SELECT COUNT(*) AS n FROM webhook_events WHERE job_id NOT IN (SELECT id FROM automation_jobs)`,
          runSql: `DELETE FROM webhook_events WHERE job_id NOT IN (SELECT id FROM automation_jobs)`,
        },
      ];
      for (const { label, countSql, runSql } of cleanups) {
        const { n } = db.prepare(countSql).get() as { n: number };
        if (n > 0) eventLogger.warn('db', `migration 0004 cleanup: ${label}`, { count: n });
        db.exec(runSql);
      }

      db.exec(`
-- Normalise personality_refresh to a real boolean column.
UPDATE automation_jobs SET personality_refresh = 0 WHERE personality_refresh IS NULL;

-- Rebuild webhook_events: CHECK on status + FK to automation_jobs.
CREATE TABLE webhook_events_new (
  id           TEXT PRIMARY KEY,
  job_id       TEXT NOT NULL REFERENCES automation_jobs(id) ON DELETE CASCADE,
  source       TEXT,
  payload_path TEXT NOT NULL,
  headers      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','processing','processed','failed')),
  error        TEXT,
  received_at  INTEGER NOT NULL,
  processed_at INTEGER
);
INSERT INTO webhook_events_new
  (id, job_id, source, payload_path, headers, status, error, received_at, processed_at)
  SELECT id, job_id, source, payload_path, headers, status, error, received_at, processed_at
  FROM webhook_events;
DROP TABLE webhook_events;
ALTER TABLE webhook_events_new RENAME TO webhook_events;
CREATE INDEX idx_webhook_events_job_id   ON webhook_events(job_id);
CREATE INDEX idx_webhook_events_status   ON webhook_events(status);
CREATE INDEX idx_webhook_events_cleanup  ON webhook_events(status, received_at);

-- Rebuild recordings: FK thread_id → threads(id) ON DELETE SET NULL.
CREATE TABLE recordings_new (
  id               TEXT PRIMARY KEY,
  thread_id        TEXT REFERENCES threads(id) ON DELETE SET NULL,
  title            TEXT,
  audio_path       TEXT NOT NULL,
  transcript_path  TEXT NOT NULL,
  duration_seconds REAL NOT NULL,
  created_at       INTEGER NOT NULL
);
INSERT INTO recordings_new
  (id, thread_id, title, audio_path, transcript_path, duration_seconds, created_at)
  SELECT id, thread_id, title, audio_path, transcript_path, duration_seconds, created_at
  FROM recordings;
DROP TABLE recordings;
ALTER TABLE recordings_new RENAME TO recordings;
CREATE INDEX idx_recordings_thread_id  ON recordings(thread_id);
CREATE INDEX idx_recordings_created_at ON recordings(created_at DESC);

-- Rebuild slack_thread_bindings: FK thread_id → threads(id) ON DELETE SET NULL.
CREATE TABLE slack_thread_bindings_new (
  key             TEXT PRIMARY KEY,
  thread_id       TEXT REFERENCES threads(id) ON DELETE SET NULL,
  channel_id      TEXT NOT NULL,
  thread_ts       TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  last_inbound_ts TEXT,
  workspace_path  TEXT
);
INSERT INTO slack_thread_bindings_new
  (key, thread_id, channel_id, thread_ts, created_at, last_inbound_ts, workspace_path)
  SELECT key, thread_id, channel_id, thread_ts, created_at, last_inbound_ts, workspace_path
  FROM slack_thread_bindings;
DROP TABLE slack_thread_bindings;
ALTER TABLE slack_thread_bindings_new RENAME TO slack_thread_bindings;
CREATE INDEX idx_stb_channel   ON slack_thread_bindings(channel_id);
CREATE INDEX idx_stb_thread_id ON slack_thread_bindings(thread_id);

-- Rebuild automation_jobs: FK project_id → projects(id), tighten personality_refresh.
CREATE TABLE automation_jobs_new (
  id                   TEXT PRIMARY KEY,
  project_id           TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  description          TEXT,
  trigger              TEXT NOT NULL,
  instructions         TEXT NOT NULL,
  kanban_task_template TEXT,
  personality_refresh  INTEGER NOT NULL DEFAULT 0,
  notification         TEXT,
  enabled              INTEGER NOT NULL DEFAULT 1,
  delete_after_run     INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  last_run_at          INTEGER,
  last_run_status      TEXT,
  last_run_error       TEXT,
  run_count_ok         INTEGER NOT NULL DEFAULT 0,
  run_count_error      INTEGER NOT NULL DEFAULT 0,
  run_history          TEXT
);
INSERT INTO automation_jobs_new
  (id, project_id, name, description, trigger, instructions, kanban_task_template,
   personality_refresh, notification, enabled, delete_after_run, created_at, updated_at,
   last_run_at, last_run_status, last_run_error, run_count_ok, run_count_error, run_history)
  SELECT id, project_id, name, description, trigger, instructions, kanban_task_template,
         COALESCE(personality_refresh, 0), notification, enabled, delete_after_run,
         created_at, updated_at, last_run_at, last_run_status, last_run_error,
         run_count_ok, run_count_error, run_history
  FROM automation_jobs;
DROP TABLE automation_jobs;
ALTER TABLE automation_jobs_new RENAME TO automation_jobs;
CREATE INDEX idx_automation_jobs_enabled ON automation_jobs(project_id, enabled);

-- Rebuild threads: FKs on project_id, parent_thread_id, recording_id.
-- Explicit column list so the rebuild is independent of legacy ALTER TABLE order.
CREATE TABLE threads_new (
  id                          TEXT PRIMARY KEY,
  name                        TEXT NOT NULL,
  project_id                  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  working_directory           TEXT NOT NULL,
  project_path                TEXT,
  using_worktree              INTEGER,
  provider                    TEXT,
  model                       TEXT,
  effort                      TEXT,
  reasoning                   TEXT,
  status                      TEXT NOT NULL,
  created_at                  INTEGER NOT NULL,
  last_active_at              INTEGER NOT NULL,
  exit_code                   INTEGER,
  queue_depth                 INTEGER,
  autopilot_enabled           INTEGER,
  autopilot_state             TEXT,
  autopilot_last_reason       TEXT,
  autopilot_consecutive_turns INTEGER,
  claude_session_id           TEXT,
  codex_session_id            TEXT,
  gemini_session_id           TEXT,
  pi_session_id               TEXT,
  archived_at                 INTEGER,
  agent_role                  TEXT,
  task_id                     TEXT,
  skill_tags                  TEXT,
  parent_thread_id            TEXT REFERENCES threads(id) ON DELETE SET NULL,
  council_run_id              TEXT,
  recording_id                TEXT REFERENCES recordings(id) ON DELETE SET NULL
);
INSERT INTO threads_new
  (id, name, project_id, working_directory, project_path, using_worktree, provider, model,
   effort, reasoning, status, created_at, last_active_at, exit_code, queue_depth,
   autopilot_enabled, autopilot_state, autopilot_last_reason, autopilot_consecutive_turns,
   claude_session_id, codex_session_id, gemini_session_id, pi_session_id, archived_at,
   agent_role, task_id, skill_tags, parent_thread_id, council_run_id, recording_id)
  SELECT id, name, project_id, working_directory, project_path, using_worktree, provider, model,
         effort, reasoning, status, created_at, last_active_at, exit_code, queue_depth,
         autopilot_enabled, autopilot_state, autopilot_last_reason, autopilot_consecutive_turns,
         claude_session_id, codex_session_id, gemini_session_id, pi_session_id, archived_at,
         agent_role, task_id, skill_tags, parent_thread_id, council_run_id, recording_id
  FROM threads;
DROP TABLE threads;
ALTER TABLE threads_new RENAME TO threads;
CREATE INDEX idx_threads_project     ON threads(project_id);
CREATE INDEX idx_threads_status      ON threads(status);
CREATE INDEX idx_threads_last_active ON threads(last_active_at DESC);
CREATE INDEX idx_threads_parent      ON threads(parent_thread_id);
`);
    },
  },
  {
    name: '0005_rename_personality_refresh_to_system',
    sql: `ALTER TABLE automation_jobs RENAME COLUMN personality_refresh TO is_system;`,
  },
  {
    name: '0006_drop_slack_binding_workspace_path',
    // workspace_path overlapped with threads.working_directory and went stale when worktrees
    // diverged. The MCP upload_file resolver now reads thread.workingDirectory directly, and
    // slackRoutingService seeds new threads from the channel mapping — so the column has no
    // remaining reader. Rebuild the table to drop it (SQLite < 3.35 has no DROP COLUMN).
    sql: `
CREATE TABLE slack_thread_bindings_new (
  key             TEXT PRIMARY KEY,
  thread_id       TEXT REFERENCES threads(id) ON DELETE SET NULL,
  channel_id      TEXT NOT NULL,
  thread_ts       TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  last_inbound_ts TEXT
);
INSERT INTO slack_thread_bindings_new
  (key, thread_id, channel_id, thread_ts, created_at, last_inbound_ts)
  SELECT key, thread_id, channel_id, thread_ts, created_at, last_inbound_ts
  FROM slack_thread_bindings;
DROP TABLE slack_thread_bindings;
ALTER TABLE slack_thread_bindings_new RENAME TO slack_thread_bindings;
CREATE INDEX idx_stb_channel   ON slack_thread_bindings(channel_id);
CREATE INDEX idx_stb_thread_id ON slack_thread_bindings(thread_id);
`,
  },
  {
    // Monorepo support: a project (and the threads it spawns) may run in a subdirectory of
    // the repo root. The root stays the mount source; `subdir` shifts the working directory
    // within it. Nullable — existing rows default to NULL (whole-repo, unchanged behaviour).
    name: '0007_add_subdir',
    run: (db) => {
      const projectCols = db.prepare(`PRAGMA table_info(projects)`).all() as { name: string }[];
      if (!projectCols.some((c) => c.name === 'subdir')) {
        db.exec(`ALTER TABLE projects ADD COLUMN subdir TEXT`);
      }
      const threadCols = db.prepare(`PRAGMA table_info(threads)`).all() as { name: string }[];
      if (!threadCols.some((c) => c.name === 'subdir')) {
        db.exec(`ALTER TABLE threads ADD COLUMN subdir TEXT`);
      }
    },
  },
  {
    // Generalize the binding from a Slack-thread tuple to a channel binding on any medium:
    //   - add `medium` (the echo-target discriminator; existing rows are Slack),
    //   - make `thread_ts` nullable so a binding can be channel-scoped (no reply anchor →
    //     echoes post as new top-level messages, e.g. automation summaries),
    //   - re-key with the medium prefix to stay unique across future mediums.
    // SQLite < 3.35 has no DROP/ALTER COLUMN, so rebuild the table (same pattern as 0006).
    name: '0008_channel_binding_medium',
    sql: `
CREATE TABLE slack_thread_bindings_new (
  key             TEXT PRIMARY KEY,
  medium          TEXT NOT NULL DEFAULT 'slack',
  thread_id       TEXT REFERENCES threads(id) ON DELETE SET NULL,
  channel_id      TEXT NOT NULL,
  thread_ts       TEXT,
  created_at      INTEGER NOT NULL,
  last_inbound_ts TEXT
);
INSERT INTO slack_thread_bindings_new
  (key, medium, thread_id, channel_id, thread_ts, created_at, last_inbound_ts)
  SELECT 'slack:' || channel_id || ':' || thread_ts, 'slack', thread_id, channel_id, thread_ts, created_at, last_inbound_ts
  FROM slack_thread_bindings;
DROP TABLE slack_thread_bindings;
ALTER TABLE slack_thread_bindings_new RENAME TO slack_thread_bindings;
CREATE INDEX idx_stb_channel   ON slack_thread_bindings(channel_id);
CREATE INDEX idx_stb_thread_id ON slack_thread_bindings(thread_id);
`,
  },
  {
    // Continuous capture: rolling 5-minute segments live in the recordings table
    // alongside manual meetings, discriminated by `kind` ('segment' vs NULL). The
    // (kind, created_at) index backs time-slot range scans and retention pruning.
    name: '0009_add_recording_kind',
    run: (db) => {
      const cols = db.prepare(`PRAGMA table_info(recordings)`).all() as { name: string }[];
      if (!cols.some((c) => c.name === 'kind')) {
        db.exec(`ALTER TABLE recordings ADD COLUMN kind TEXT`);
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_recordings_kind_created ON recordings(kind, created_at)`);
    },
  },
  {
    // The thread's current lifecycle indicator (👀/🤖/🏛️/✅/❌), written on every status broadcast so
    // the reaction survives an app restart instead of living only in in-memory projection state.
    name: '0010_add_thread_current_reaction',
    run: (db) => {
      const cols = db.prepare(`PRAGMA table_info(threads)`).all() as { name: string }[];
      if (!cols.some((c) => c.name === 'current_reaction')) {
        db.exec(`ALTER TABLE threads ADD COLUMN current_reaction TEXT`);
      }
    },
  },
  {
    // Per-automation agent settings: pin the provider/model/effort/reasoning an automation run
    // uses instead of resolving the project/app defaults at run time. All nullable — a NULL
    // column means "inherit the effective default", preserving prior behavior.
    name: '0011_add_automation_provider_model',
    run: (db) => {
      const cols = db.prepare(`PRAGMA table_info(automation_jobs)`).all() as { name: string }[];
      for (const col of ['provider', 'model', 'effort', 'reasoning']) {
        if (!cols.some((c) => c.name === col)) {
          db.exec(`ALTER TABLE automation_jobs ADD COLUMN ${col} TEXT`);
        }
      }
    },
  },
  {
    // In-app notifications: track unseen notify-worthy events (✅/❌/attention) per thread so the
    // list badge + dock count survive a restart. unread_count is the tally; unread_kind is the
    // highest-priority pending reason (colors the badge). Both reset to 0/NULL when the thread is viewed.
    name: '0012_add_thread_unread',
    run: (db) => {
      const cols = db.prepare(`PRAGMA table_info(threads)`).all() as { name: string }[];
      if (!cols.some((c) => c.name === 'unread_count')) {
        db.exec(`ALTER TABLE threads ADD COLUMN unread_count INTEGER NOT NULL DEFAULT 0`);
      }
      if (!cols.some((c) => c.name === 'unread_kind')) {
        db.exec(`ALTER TABLE threads ADD COLUMN unread_kind TEXT`);
      }
    },
  },
];

// Derived from THREADS_MIGRATIONS so the seeding branch never goes stale.
export const THREADS_MIGRATION_NAMES = THREADS_MIGRATIONS.map((m) => m.name);

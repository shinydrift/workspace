/**
 * Behavioural assertions on the threads-backend schema produced by
 * src/main/threads/migrations.ts. Pinned here so changes to one source
 * of truth (raw migration SQL vs. drizzle schema) can't drift silently.
 *
 * Inlines the migration SQL because the test runner is plain .mjs and
 * cannot import TypeScript directly. When migrations.ts changes, this
 * test must be updated in lockstep — that lockstep is the point.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

// ── Migration SQL ─────────────────────────────────────────────────────────────
// Mirror of THREADS_MIGRATIONS as a single applied script. The 0003 column-add
// is inlined into the baseline here (idempotent in production via PRAGMA guard).

const MIGRATION_SQL = `
CREATE TABLE projects (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  path            TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  last_used_at    INTEGER NOT NULL,
  dockerfile_hash TEXT
);
CREATE INDEX idx_projects_path ON projects(path);

CREATE TABLE threads (
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
CREATE INDEX idx_threads_project     ON threads(project_id);
CREATE INDEX idx_threads_status      ON threads(status);
CREATE INDEX idx_threads_last_active ON threads(last_active_at DESC);
CREATE INDEX idx_threads_parent      ON threads(parent_thread_id);

CREATE TABLE thread_prompt_history (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT    NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  prompt    TEXT    NOT NULL,
  position  INTEGER NOT NULL,
  UNIQUE (thread_id, position)
);
CREATE INDEX idx_tph_thread ON thread_prompt_history(thread_id);

CREATE TABLE automation_jobs (
  id                   TEXT PRIMARY KEY,
  project_id           TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  description          TEXT,
  trigger              TEXT NOT NULL,
  instructions         TEXT NOT NULL,
  kanban_task_template TEXT,
  is_system            INTEGER NOT NULL DEFAULT 0,
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
CREATE INDEX idx_automation_jobs_enabled ON automation_jobs(project_id, enabled);

CREATE TABLE recordings (
  id               TEXT PRIMARY KEY,
  thread_id        TEXT REFERENCES threads(id) ON DELETE SET NULL,
  title            TEXT,
  audio_path       TEXT NOT NULL,
  transcript_path  TEXT NOT NULL,
  duration_seconds REAL NOT NULL,
  created_at       INTEGER NOT NULL
);
CREATE INDEX idx_recordings_thread_id  ON recordings(thread_id);
CREATE INDEX idx_recordings_created_at ON recordings(created_at DESC);

CREATE TABLE slack_thread_bindings (
  key             TEXT PRIMARY KEY,
  thread_id       TEXT REFERENCES threads(id) ON DELETE SET NULL,
  channel_id      TEXT NOT NULL,
  thread_ts       TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  last_inbound_ts TEXT,
  workspace_path  TEXT
);
CREATE INDEX idx_stb_channel   ON slack_thread_bindings(channel_id);
CREATE INDEX idx_stb_thread_id ON slack_thread_bindings(thread_id);

CREATE TABLE webhook_events (
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
CREATE INDEX idx_webhook_events_job_id   ON webhook_events(job_id);
CREATE INDEX idx_webhook_events_status   ON webhook_events(status);
CREATE INDEX idx_webhook_events_cleanup  ON webhook_events(status, received_at);
`;

function openDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(MIGRATION_SQL);
  return db;
}

function seedProject(db, id = 'p1') {
  db.prepare('INSERT INTO projects (id, name, path, created_at, last_used_at) VALUES (?, ?, ?, 0, 0)').run(
    id,
    'p',
    `/tmp/${id}`
  );
}

function seedThread(db, id, projectId = 'p1', extra = {}) {
  db.prepare(
    `INSERT INTO threads (id, name, project_id, working_directory, status, created_at, last_active_at, parent_thread_id, recording_id)
     VALUES (?, 'n', ?, '/tmp', 'idle', 0, 0, ?, ?)`
  ).run(id, projectId, extra.parentThreadId ?? null, extra.recordingId ?? null);
}

// ── Tables present ────────────────────────────────────────────────────────────

test('schema exposes the expected tables', () => {
  const db = openDb();
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  assert.deepEqual(names, [
    'automation_jobs',
    'projects',
    'recordings',
    'slack_thread_bindings',
    'thread_prompt_history',
    'threads',
    'webhook_events',
  ]);
  // threads_meta was removed in 0004.
  assert.ok(!names.includes('threads_meta'));
});

// ── Foreign keys ──────────────────────────────────────────────────────────────

test('threads.project_id cascades on project delete', () => {
  const db = openDb();
  seedProject(db, 'p1');
  seedThread(db, 't1');
  db.prepare('DELETE FROM projects WHERE id = ?').run('p1');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM threads').get().n, 0);
});

test('thread_prompt_history cascades on thread delete', () => {
  const db = openDb();
  seedProject(db);
  seedThread(db, 't1');
  db.prepare('INSERT INTO thread_prompt_history (thread_id, prompt, position) VALUES (?, ?, ?)').run('t1', 'hi', 0);
  db.prepare('DELETE FROM threads WHERE id = ?').run('t1');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM thread_prompt_history').get().n, 0);
});

test('threads.parent_thread_id nulls on parent delete', () => {
  const db = openDb();
  seedProject(db);
  seedThread(db, 'parent');
  seedThread(db, 'child', 'p1', { parentThreadId: 'parent' });
  db.prepare('DELETE FROM threads WHERE id = ?').run('parent');
  assert.equal(db.prepare('SELECT parent_thread_id FROM threads WHERE id = ?').get('child').parent_thread_id, null);
});

test('recordings.thread_id nulls on thread delete', () => {
  const db = openDb();
  seedProject(db);
  seedThread(db, 't1');
  db.prepare(
    `INSERT INTO recordings (id, thread_id, audio_path, transcript_path, duration_seconds, created_at)
     VALUES ('r1', 't1', '/a', '/t', 1, 0)`
  ).run();
  db.prepare('DELETE FROM threads WHERE id = ?').run('t1');
  assert.equal(db.prepare('SELECT thread_id FROM recordings WHERE id = ?').get('r1').thread_id, null);
});

test('webhook_events.job_id cascades on automation_job delete', () => {
  const db = openDb();
  seedProject(db);
  db.prepare(
    `INSERT INTO automation_jobs (id, project_id, name, trigger, instructions, created_at, updated_at)
     VALUES ('j1', 'p1', 'job', '{}', '', 0, 0)`
  ).run();
  db.prepare(
    `INSERT INTO webhook_events (id, job_id, payload_path, headers, received_at)
     VALUES ('e1', 'j1', '/p', '{}', 0)`
  ).run();
  db.prepare('DELETE FROM automation_jobs WHERE id = ?').run('j1');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM webhook_events').get().n, 0);
});

test('inserting a thread with unknown project_id is rejected', () => {
  const db = openDb();
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO threads (id, name, project_id, working_directory, status, created_at, last_active_at)
           VALUES ('t1', 'n', 'missing-project', '/tmp', 'idle', 0, 0)`
        )
        .run(),
    /FOREIGN KEY/i
  );
});

// ── CHECK constraint ──────────────────────────────────────────────────────────

test('webhook_events.status rejects values outside the allowed set', () => {
  const db = openDb();
  seedProject(db);
  db.prepare(
    `INSERT INTO automation_jobs (id, project_id, name, trigger, instructions, created_at, updated_at)
     VALUES ('j1', 'p1', 'job', '{}', '', 0, 0)`
  ).run();
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO webhook_events (id, job_id, payload_path, headers, status, received_at)
           VALUES ('e1', 'j1', '/p', '{}', 'bogus', 0)`
        )
        .run(),
    /CHECK constraint/i
  );
});

// ── UNIQUE constraint ─────────────────────────────────────────────────────────

test('thread_prompt_history rejects duplicate (thread_id, position)', () => {
  const db = openDb();
  seedProject(db);
  seedThread(db, 't1');
  db.prepare('INSERT INTO thread_prompt_history (thread_id, prompt, position) VALUES (?, ?, ?)').run('t1', 'a', 0);
  assert.throws(
    () =>
      db.prepare('INSERT INTO thread_prompt_history (thread_id, prompt, position) VALUES (?, ?, ?)').run('t1', 'b', 0),
    /UNIQUE constraint/i
  );
});

// ── 0003 idempotency guard ────────────────────────────────────────────────────
// 0003_add_pi_session_id runs `ALTER TABLE threads ADD COLUMN pi_session_id TEXT`
// only when the column is missing. Without the guard, legacy DBs that already
// reached the column via the integer schema_version system would throw on every
// startup. Asserts the unguarded form fails and the guarded form is a no-op.

test('0003 ADD COLUMN guard prevents duplicate-column-name errors', () => {
  const db = openDb(); // baseline already has pi_session_id
  assert.throws(
    () => db.exec('ALTER TABLE threads ADD COLUMN pi_session_id TEXT'),
    /duplicate column name: pi_session_id/i
  );
  // Production guard: PRAGMA table_info check.
  const cols = db
    .prepare(`PRAGMA table_info(threads)`)
    .all()
    .map((c) => c.name);
  if (!cols.includes('pi_session_id')) {
    db.exec('ALTER TABLE threads ADD COLUMN pi_session_id TEXT');
  }
  // Still works — the guard short-circuited.
  assert.ok(cols.includes('pi_session_id'));
});

// ── Indexes present ───────────────────────────────────────────────────────────

test('expected indexes exist and the redundant idx_automation_jobs_project_id is gone', () => {
  const db = openDb();
  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  for (const expected of [
    'idx_projects_path',
    'idx_threads_project',
    'idx_threads_status',
    'idx_threads_last_active',
    'idx_threads_parent',
    'idx_tph_thread',
    'idx_automation_jobs_enabled',
    'idx_stb_channel',
    'idx_stb_thread_id',
    'idx_recordings_thread_id',
    'idx_recordings_created_at',
    'idx_webhook_events_job_id',
    'idx_webhook_events_status',
    'idx_webhook_events_cleanup',
  ]) {
    assert.ok(indexes.includes(expected), `missing index: ${expected}`);
  }
  assert.ok(!indexes.includes('idx_automation_jobs_project_id'), 'redundant prefix index should be dropped');
});

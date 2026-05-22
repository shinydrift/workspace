import type { MigrationDef } from '../db/drizzleMigrate';

export const COUNCIL_MIGRATION_NAMES = ['0001_baseline', '0002_fk_cascade', '0003_expires_at'] as const;

export const COUNCIL_MIGRATIONS: MigrationDef[] = [
  {
    name: '0001_baseline',
    sql: `
CREATE TABLE IF NOT EXISTS council_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS council_configs (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  members    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS council_runs (
  id               TEXT    PRIMARY KEY,
  config_id        TEXT    NOT NULL,
  parent_thread_id TEXT    NOT NULL,
  prompt           TEXT    NOT NULL,
  child_thread_ids TEXT    NOT NULL DEFAULT '[]',
  status           TEXT    NOT NULL DEFAULT 'running',
  created_at       INTEGER NOT NULL,
  completed_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_council_runs_parent  ON council_runs(parent_thread_id);
CREATE INDEX IF NOT EXISTS idx_council_runs_created ON council_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS council_outcomes (
  run_id          TEXT    NOT NULL REFERENCES council_runs(id),
  child_thread_id TEXT    NOT NULL,
  member_provider TEXT    NOT NULL,
  member_model    TEXT    NOT NULL DEFAULT '',
  status          TEXT    NOT NULL,
  summary         TEXT,
  answer          TEXT,
  confidence      REAL,
  caveats         TEXT,
  raw             TEXT,
  error           TEXT,
  submitted_at    INTEGER NOT NULL,
  PRIMARY KEY (run_id, child_thread_id)
);

CREATE TABLE IF NOT EXISTS council_child_members (
  run_id          TEXT NOT NULL REFERENCES council_runs(id),
  child_thread_id TEXT NOT NULL,
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (run_id, child_thread_id)
);

CREATE TABLE IF NOT EXISTS council_run_members (
  run_id          TEXT    NOT NULL REFERENCES council_runs(id),
  member_idx      INTEGER NOT NULL,
  child_thread_id TEXT,
  provider        TEXT    NOT NULL,
  model           TEXT    NOT NULL DEFAULT '',
  status          TEXT    NOT NULL DEFAULT 'pending',
  PRIMARY KEY (run_id, member_idx)
);
CREATE INDEX IF NOT EXISTS idx_council_run_members_child ON council_run_members(run_id, child_thread_id);
`,
  },
  {
    // Recreate outcome/member tables with ON DELETE CASCADE.
    // PRAGMA foreign_keys cannot run inside a transaction, so cascade is
    // enforced at runtime via PRAGMA foreign_keys = ON in councilDb.ts.
    // Table recreation is the only way to add FK constraints in SQLite.
    name: '0002_fk_cascade',
    sql: `
CREATE TABLE council_outcomes_new (
  run_id          TEXT    NOT NULL REFERENCES council_runs(id) ON DELETE CASCADE,
  child_thread_id TEXT    NOT NULL,
  member_provider TEXT    NOT NULL,
  member_model    TEXT    NOT NULL DEFAULT '',
  status          TEXT    NOT NULL,
  summary         TEXT,
  answer          TEXT,
  confidence      REAL,
  caveats         TEXT,
  raw             TEXT,
  error           TEXT,
  submitted_at    INTEGER NOT NULL,
  PRIMARY KEY (run_id, child_thread_id)
);
INSERT INTO council_outcomes_new SELECT * FROM council_outcomes;
DROP TABLE council_outcomes;
ALTER TABLE council_outcomes_new RENAME TO council_outcomes;

CREATE TABLE council_child_members_new (
  run_id          TEXT NOT NULL REFERENCES council_runs(id) ON DELETE CASCADE,
  child_thread_id TEXT NOT NULL,
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (run_id, child_thread_id)
);
INSERT INTO council_child_members_new SELECT * FROM council_child_members;
DROP TABLE council_child_members;
ALTER TABLE council_child_members_new RENAME TO council_child_members;

CREATE TABLE council_run_members_new (
  run_id          TEXT    NOT NULL REFERENCES council_runs(id) ON DELETE CASCADE,
  member_idx      INTEGER NOT NULL,
  child_thread_id TEXT,
  provider        TEXT    NOT NULL,
  model           TEXT    NOT NULL DEFAULT '',
  status          TEXT    NOT NULL DEFAULT 'pending',
  PRIMARY KEY (run_id, member_idx)
);
INSERT INTO council_run_members_new SELECT * FROM council_run_members;
DROP TABLE council_run_members;
ALTER TABLE council_run_members_new RENAME TO council_run_members;
CREATE INDEX IF NOT EXISTS idx_council_run_members_child ON council_run_members(run_id, child_thread_id);
`,
  },
  {
    name: '0003_expires_at',
    sql: `ALTER TABLE council_runs ADD COLUMN expires_at INTEGER;`,
  },
];

import path from 'path';
import fs from 'fs';
import { runtimeLogger as eventLogger } from './runtime';
// eslint-disable-next-line import/no-named-as-default
import type Database from 'better-sqlite3';
import { openDb } from '../db/openDb';
import { applyMigrations, seedAppliedMigrations } from '../db/drizzleMigrate';
import { MEMORY_MIGRATIONS, MEMORY_MIGRATION_NAMES } from './migrations';

const dbCache = new Map<string, Database.Database>();
let memoryDbDir: string | null = null;

export function initDbDir(homeDir: string): void {
  memoryDbDir = path.join(homeDir, '.agentos', 'memory', 'projects');
}

function ensureMemoryDbDir(): void {
  if (!memoryDbDir) return;
  fs.mkdirSync(memoryDbDir, { recursive: true });
}

function assertSafePath(projectId: string, dbPath: string): void {
  if (!memoryDbDir) throw new Error('Memory DB dir not initialized. Call initDbDir() first.');
  const resolved = path.resolve(dbPath);
  const base = path.resolve(memoryDbDir) + path.sep;
  if (!resolved.startsWith(base)) {
    eventLogger.error('memory', 'Path traversal attempt blocked', { projectId });
    throw new Error(`Invalid project ID: ${projectId}`);
  }
}

export function getProjectDb(projectId: string): Database.Database {
  if (dbCache.has(projectId)) return dbCache.get(projectId)!;
  if (!memoryDbDir) throw new Error('Memory DB dir not initialized. Call initDbDir() first.');
  ensureMemoryDbDir();
  const dbPath = path.join(memoryDbDir, `${projectId}.sqlite`);
  assertSafePath(projectId, dbPath);
  const db = openDb(dbPath, undefined, { foreignKeys: true });
  // On first open after upgrading to drizzle-managed migrations: detect old
  // integer schema_version tracking, seed the baseline as already applied,
  // and remove the version key so future opens skip this branch.
  // Assumption: any existing DB is at the current version (memory v20).
  // A DB at an intermediate version would have the baseline seeded as applied
  // but still be missing columns — those incremental migrations no longer exist.
  // This is intentional: the app was not in production use when this migration
  // system was introduced.
  const hasMigrationsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'")
    .get();
  if (!hasMigrationsTable) {
    const hasMetaTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").get();
    if (hasMetaTable) {
      seedAppliedMigrations(db, [...MEMORY_MIGRATION_NAMES]);
      db.exec("DELETE FROM meta WHERE key = 'schema_version'");
    }
  }
  applyMigrations(db, MEMORY_MIGRATIONS);
  // Backfill project_ids for existing rows that have the empty default.
  // This can't be a static migration because it's parameterized on projectId.
  // It's idempotent: a no-op for fresh DBs and for rows already backfilled.
  db.prepare("UPDATE chunks SET project_ids = json_array(?) WHERE project_ids = '[]'").run(projectId);
  dbCache.set(projectId, db);
  return db;
}

export function closeProjectDb(projectId: string): void {
  const db = dbCache.get(projectId);
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    dbCache.delete(projectId);
  }
}

export function closeAllDbs(): void {
  for (const id of [...dbCache.keys()]) closeProjectDb(id);
}

export function deleteProjectDb(projectId: string): void {
  closeProjectDb(projectId);
  if (!memoryDbDir) return;
  const dbPath = path.join(memoryDbDir, `${projectId}.sqlite`);
  assertSafePath(projectId, dbPath);
  try {
    fs.unlinkSync(dbPath);
  } catch {
    /* ignore — file may not exist */
  }
}

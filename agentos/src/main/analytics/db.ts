import path from 'path';
import fs from 'fs';
// eslint-disable-next-line import/no-named-as-default
import type Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { openDb } from '../db/openDb';
import { applyMigrations, seedAppliedMigrations } from '../db/drizzleMigrate';
import { ANALYTICS_MIGRATIONS, ANALYTICS_MIGRATION_NAMES } from './migrations';
import * as schema from './schema';

let _analyticsDb: Database.Database | null = null;
let _drizzle: BetterSQLite3Database<typeof schema> | null = null;
export let analyticsDbDir: string | null = null;

export function initAnalyticsDbDir(homeDir: string): void {
  analyticsDbDir = path.join(homeDir, '.agentos', 'analytics');
  fs.mkdirSync(analyticsDbDir, { recursive: true });
}

export function getAnalyticsDb(): Database.Database {
  if (_analyticsDb) return _analyticsDb;
  if (!analyticsDbDir) throw new Error('Analytics DB dir not initialized. Call initAnalyticsDbDir() first.');
  const dbPath = path.join(analyticsDbDir, 'analytics.sqlite');
  _analyticsDb = openDb(dbPath);
  // Upgrade from old integer schema_version system.
  const hasMigrationsTable = _analyticsDb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'")
    .get();
  if (!hasMigrationsTable) {
    const hasMetaTable = _analyticsDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='analytics_meta'")
      .get();
    if (hasMetaTable) {
      seedAppliedMigrations(_analyticsDb, [...ANALYTICS_MIGRATION_NAMES]);
      _analyticsDb.exec("DELETE FROM analytics_meta WHERE key = 'schema_version'");
    }
  }
  applyMigrations(_analyticsDb, ANALYTICS_MIGRATIONS);
  return _analyticsDb;
}

export function getAnalyticsDrizzle(): BetterSQLite3Database<typeof schema> {
  if (!_drizzle) _drizzle = drizzle(getAnalyticsDb(), { schema });
  return _drizzle;
}

export function closeAnalyticsDb(): void {
  if (_analyticsDb) {
    try {
      _analyticsDb.close();
    } catch {
      /* ignore */
    }
    _analyticsDb = null;
    _drizzle = null;
  }
}

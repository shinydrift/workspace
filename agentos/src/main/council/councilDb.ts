import path from 'path';
import fs from 'fs';
// eslint-disable-next-line import/no-named-as-default
import type Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, asc } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { CouncilConfig } from '../../shared/types/council';
import { openDb } from '../db/openDb';
import { applyMigrations, seedAppliedMigrations } from '../db/drizzleMigrate';
import { COUNCIL_MIGRATIONS, COUNCIL_MIGRATION_NAMES } from './migrations';
import * as schema from './schema';
import { councilConfigs } from './schema';

let _councilDb: Database.Database | null = null;
let _drizzle: BetterSQLite3Database<typeof schema> | null = null;
let councilDbDir: string | null = null;

export function initCouncilDbDir(homeDir: string): void {
  if (_councilDb) throw new Error('Council DB already initialized; call closeCouncilDb() first');
  councilDbDir = path.join(homeDir, '.agentos', 'council');
  fs.mkdirSync(councilDbDir, { recursive: true });
}

function getCouncilRawDb(): Database.Database {
  if (_councilDb) return _councilDb;
  if (!councilDbDir) throw new Error('Council DB dir not initialized. Call initCouncilDbDir() first.');
  const dbPath = path.join(councilDbDir, 'council.sqlite');
  _councilDb = openDb(dbPath);
  _councilDb.pragma('foreign_keys = ON');
  // Upgrade from old integer schema_version system.
  const hasMigrationsTable = _councilDb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'")
    .get();
  if (!hasMigrationsTable) {
    const hasMetaTable = _councilDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='council_meta'")
      .get();
    if (hasMetaTable) {
      seedAppliedMigrations(_councilDb, [...COUNCIL_MIGRATION_NAMES]);
      _councilDb.exec("DELETE FROM council_meta WHERE key = 'schema_version'");
    }
  }
  applyMigrations(_councilDb, COUNCIL_MIGRATIONS);
  return _councilDb;
}

export function getCouncilDrizzle(): BetterSQLite3Database<typeof schema> {
  if (!_drizzle) _drizzle = drizzle(getCouncilRawDb(), { schema });
  return _drizzle;
}

// Kept for callers that need the raw Database (close, backup).
export function getCouncilDb(): Database.Database {
  return getCouncilRawDb();
}

export function closeCouncilDb(): void {
  if (_councilDb) {
    try {
      _councilDb.close();
    } catch {
      /* ignore */
    }
    _councilDb = null;
    _drizzle = null;
  }
}

// ---------------------------------------------------------------------------
// Config CRUD
// ---------------------------------------------------------------------------

type ConfigRow = typeof councilConfigs.$inferSelect;

function rowToConfig(row: ConfigRow): CouncilConfig {
  return {
    id: row.id,
    name: row.name,
    members: JSON.parse(row.members) as CouncilConfig['members'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listConfigs(): CouncilConfig[] {
  return getCouncilDrizzle()
    .select()
    .from(councilConfigs)
    .orderBy(asc(councilConfigs.createdAt))
    .all()
    .map(rowToConfig);
}

export function getConfig(id: string): CouncilConfig | null {
  const row = getCouncilDrizzle().select().from(councilConfigs).where(eq(councilConfigs.id, id)).get();
  return row ? rowToConfig(row) : null;
}

export function upsertConfig(config: CouncilConfig): void {
  getCouncilDrizzle()
    .insert(councilConfigs)
    .values({
      id: config.id,
      name: config.name,
      members: JSON.stringify(config.members),
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    })
    .onConflictDoUpdate({
      target: councilConfigs.id,
      set: { name: config.name, members: JSON.stringify(config.members), updatedAt: config.updatedAt },
    })
    .run();
}

export function deleteConfig(id: string): void {
  getCouncilDrizzle().delete(councilConfigs).where(eq(councilConfigs.id, id)).run();
}

// eslint-disable-next-line import/no-named-as-default
import type Database from 'better-sqlite3';
import { eventLogger } from '../utils/eventLog';

export type MigrationDef = { name: string; sql: string } | { name: string; run: (db: Database.Database) => void };

export function applyMigrations(db: Database.Database, migrations: MigrationDef[]): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      name       TEXT    PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const isApplied = db.prepare('SELECT 1 FROM __drizzle_migrations WHERE name = ?');
  const insert = db.prepare('INSERT OR IGNORE INTO __drizzle_migrations (name, applied_at) VALUES (?, ?)');

  for (const migration of migrations) {
    // Re-check inside the transaction so a concurrent open (e.g. double-launch race)
    // cannot run the same migration twice — INSERT OR IGNORE makes it idempotent.
    let ran = false;
    db.transaction(() => {
      if (isApplied.get(migration.name)) return;
      if ('sql' in migration) db.exec(migration.sql);
      else migration.run(db);
      insert.run(migration.name, Date.now());
      ran = true;
    })();
    if (ran) eventLogger.debug('db', `Migration applied: ${migration.name}`);
  }
}

/**
 * Seeds the migrations table with already-applied migration names, used when
 * transitioning from the old integer schema_version tracking system.
 */
export function seedAppliedMigrations(db: Database.Database, names: string[]): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      name       TEXT    PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
  const insert = db.prepare('INSERT OR IGNORE INTO __drizzle_migrations (name, applied_at) VALUES (?, ?)');
  const now = Date.now();
  for (const name of names) {
    insert.run(name, now);
  }
}

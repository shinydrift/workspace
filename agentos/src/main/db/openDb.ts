// eslint-disable-next-line import/no-named-as-default
import type Database from 'better-sqlite3';
import { eventLogger } from '../utils/eventLog';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const BetterSQLite3 = require('better-sqlite3') as typeof import('better-sqlite3');

/**
 * Opens a SQLite database, sets WAL journal mode, synchronous=NORMAL, and applies the schema.
 * Pass foreignKeys=true if the schema uses REFERENCES constraints.
 */
export function openDb(dbPath: string, schemaSql?: string, opts?: { foreignKeys?: boolean }): Database.Database {
  const db = new BetterSQLite3(dbPath);
  db.pragma('busy_timeout = 5000');
  const journalMode = db.pragma('journal_mode = WAL', { simple: true }) as string;
  if (journalMode !== 'wal') {
    eventLogger.warn('db', `WAL not enabled for ${dbPath}: got ${journalMode}`);
  }
  db.pragma('synchronous = NORMAL');
  if (opts?.foreignKeys) db.pragma('foreign_keys = ON');
  if (schemaSql) db.exec(schemaSql);
  return db;
}

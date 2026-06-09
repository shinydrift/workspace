// eslint-disable-next-line import/no-named-as-default
import type Database from 'better-sqlite3';

const vecLoadCache = new WeakMap<Database.Database, boolean>();
// Skip the meta SELECT + CREATE VIRTUAL TABLE IF NOT EXISTS round-trip on every
// ensureVecTable call. Once we've ensured a (db, dims) pair, the table exists
// and the dims are recorded — subsequent calls with the same dims are no-ops.
const ensureVecCache = new WeakMap<Database.Database, number>();
const ensureObsVecCache = new WeakMap<Database.Database, number>();

function tryLoadSqliteVec(db: Database.Database): boolean {
  if (vecLoadCache.has(db)) return vecLoadCache.get(db)!;
  let ok = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqliteVec = require('sqlite-vec') as { load: (db: Database.Database) => void };
    sqliteVec.load(db);
    ok = true;
  } catch {
    /* extension unavailable */
  }
  vecLoadCache.set(db, ok);
  return ok;
}

export function checkVecTable(db: Database.Database): boolean {
  return (
    !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_vec'").get() &&
    tryLoadSqliteVec(db)
  );
}

export function checkObsVecTable(db: Database.Database): boolean {
  return (
    !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_vec'").get() &&
    tryLoadSqliteVec(db)
  );
}

export function ensureObsVecTable(db: Database.Database, dims: number): boolean {
  if (ensureObsVecCache.get(db) === dims) return true;
  if (!tryLoadSqliteVec(db)) return false;
  const storedDims = (
    db.prepare('SELECT value FROM meta WHERE key = ?').get('obs_vec_dims') as { value: string } | undefined
  )?.value;
  if (storedDims && Number(storedDims) !== dims) {
    db.exec('DROP TABLE IF EXISTS observations_vec');
    db.prepare('INSERT OR REPLACE INTO meta VALUES (?, ?)').run('obs_vec_dims', String(dims));
  }
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS observations_vec USING vec0(id TEXT, embedding FLOAT[${dims}])`);
  if (!storedDims) {
    db.prepare('INSERT OR REPLACE INTO meta VALUES (?, ?)').run('obs_vec_dims', String(dims));
  }
  ensureObsVecCache.set(db, dims);
  return true;
}

export function ensureVecTable(db: Database.Database, dims: number): boolean {
  if (ensureVecCache.get(db) === dims) return true;
  if (!tryLoadSqliteVec(db)) return false;
  const storedDims = (
    db.prepare('SELECT value FROM meta WHERE key = ?').get('vec_dims') as { value: string } | undefined
  )?.value;
  if (storedDims && Number(storedDims) !== dims) {
    db.exec('DROP TABLE IF EXISTS chunks_vec');
    db.prepare('INSERT OR REPLACE INTO meta VALUES (?, ?)').run('vec_dims', String(dims));
  }
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(id TEXT, embedding FLOAT[${dims}])`);
  if (!storedDims) {
    db.prepare('INSERT OR REPLACE INTO meta VALUES (?, ?)').run('vec_dims', String(dims));
  }
  ensureVecCache.set(db, dims);
  return true;
}

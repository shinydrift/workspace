import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

// ── Inlined from src/main/db/migrations.ts ────────────────────────────────────

const ALREADY_APPLIED_PATTERNS = [/duplicate column name/i, /table .* already exists/i];

function isAlreadyApplied(err) {
  if (!(err instanceof Error)) return false;
  return ALREADY_APPLIED_PATTERNS.some((p) => p.test(err.message));
}

function makeLogger() {
  const calls = [];
  return {
    debug: (sub, msg) => calls.push({ level: 'debug', sub, msg }),
    error: (sub, msg, meta) => calls.push({ level: 'error', sub, msg, ...meta }),
    calls,
  };
}

function makeRunMigration(logger) {
  return function runMigration(db, name, fn) {
    try {
      fn(db);
      logger.debug('db', `Migration applied: ${name}`);
    } catch (err) {
      if (isAlreadyApplied(err)) {
        logger.debug('db', `Migration skipped (already applied): ${name}`);
        return;
      }
      logger.error('db', `Migration failed: ${name}`, { error: String(err) });
      throw err;
    }
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function openDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
  return db;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('applies migration and logs success', () => {
  const logger = makeLogger();
  const runMigration = makeRunMigration(logger);
  const db = openDb();

  runMigration(db, 'add col', (d) => d.exec('ALTER TABLE t ADD COLUMN name TEXT'));

  const row = db.prepare("SELECT name FROM pragma_table_info('t') WHERE name='name'").get();
  assert.ok(row, 'column should exist');
  assert.equal(logger.calls.length, 1);
  assert.equal(logger.calls[0].level, 'debug');
  assert.match(logger.calls[0].msg, /Migration applied: add col/);
});

test('suppresses duplicate column name and logs skip', () => {
  const logger = makeLogger();
  const runMigration = makeRunMigration(logger);
  const db = openDb();
  db.exec('ALTER TABLE t ADD COLUMN name TEXT');

  assert.doesNotThrow(() =>
    runMigration(db, 'add col again', (d) => d.exec('ALTER TABLE t ADD COLUMN name TEXT')),
  );
  assert.equal(logger.calls.length, 1);
  assert.equal(logger.calls[0].level, 'debug');
  assert.match(logger.calls[0].msg, /Migration skipped \(already applied\): add col again/);
});

test('suppresses table already exists and logs skip', () => {
  const logger = makeLogger();
  const runMigration = makeRunMigration(logger);
  const db = openDb();

  assert.doesNotThrow(() =>
    runMigration(db, 'create t again', (d) => d.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)')),
  );
  assert.equal(logger.calls.length, 1);
  assert.match(logger.calls[0].msg, /Migration skipped \(already applied\): create t again/);
});

test('rethrows unexpected errors and logs error', () => {
  const logger = makeLogger();
  const runMigration = makeRunMigration(logger);
  const db = openDb();

  assert.throws(
    () => runMigration(db, 'bad sql', (d) => d.exec('NOT VALID SQL')),
    /syntax error/i,
  );
  assert.equal(logger.calls.length, 1);
  assert.equal(logger.calls[0].level, 'error');
  assert.match(logger.calls[0].msg, /Migration failed: bad sql/);
});

test('rethrows non-Error throws unchanged', () => {
  const logger = makeLogger();
  const runMigration = makeRunMigration(logger);
  const db = openDb();
  const sentinel = { custom: true };

  assert.throws(
    () => runMigration(db, 'throws object', () => { throw sentinel; }),
    (err) => err === sentinel,
  );
  assert.equal(logger.calls[0].level, 'error');
});

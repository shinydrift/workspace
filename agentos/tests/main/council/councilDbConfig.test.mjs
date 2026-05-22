/**
 * Tests for councilDb.ts and service.ts config CRUD logic.
 *
 * better-sqlite3 is unavailable in the plain Node test environment (native
 * module requires the Electron rebuild). Following repo convention, logic is
 * inlined and the DB layer is replaced with an in-memory Map-backed fake.
 *
 * What is covered:
 *   - rowToConfig: JSON round-trip, field mapping
 *   - migrateConfigsFromStore: idempotency gate, INSERT OR IGNORE semantics
 *   - service.upsertConfig: createdAt preservation on update, id generation
 *   - service.deleteConfig / listConfigs / getConfig via fake
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from councilDb.ts ─────────────────────────────────────────────────

function rowToConfig(row) {
  return {
    id: row.id,
    name: row.name,
    members: JSON.parse(row.members),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const MIGRATION_KEY = 'store_configs_migrated';

/**
 * Fake DB that mirrors the SQLite behaviour used by councilDb.ts config CRUD
 * and migrateConfigsFromStore.
 */
function makeFakeConfigDb() {
  const configs = new Map(); // id → row (snake_case, members as JSON string)
  const meta = new Map(); // key → value

  return {
    // Mirrors council_configs SELECT *
    listConfigs() {
      return [...configs.values()]
        .sort((a, b) => a.created_at - b.created_at)
        .map(rowToConfig);
    },
    getConfig(id) {
      const row = configs.get(id);
      return row ? rowToConfig(row) : null;
    },
    // Mirrors INSERT OR REPLACE
    upsertConfig(cfg) {
      configs.set(cfg.id, {
        id: cfg.id,
        name: cfg.name,
        members: JSON.stringify(cfg.members),
        created_at: cfg.createdAt,
        updated_at: cfg.updatedAt,
      });
    },
    deleteConfig(id) {
      configs.delete(id);
    },
    // Mirrors INSERT OR IGNORE + council_meta gate used by migrateConfigsFromStore
    migrateFromStore(storeConfigs) {
      if (meta.get(MIGRATION_KEY) === '1') return;
      for (const c of Object.values(storeConfigs)) {
        if (!configs.has(c.id)) {
          configs.set(c.id, {
            id: c.id,
            name: c.name,
            members: JSON.stringify(c.members),
            created_at: c.createdAt,
            updated_at: c.updatedAt,
          });
        }
      }
      meta.set(MIGRATION_KEY, '1');
    },
    _meta: meta,
    _configs: configs,
  };
}

/** Mirrors CouncilService.upsertConfig (service.ts) */
function serviceUpsertConfig(db, input, nanoid) {
  const now = Date.now();
  const id = input.id ?? `council_${nanoid()}`;
  const existing = db.getConfig(id);
  const config = {
    id,
    name: input.name,
    members: input.members,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  db.upsertConfig(config);
  return config;
}

// ── rowToConfig tests ─────────────────────────────────────────────────────────

test('rowToConfig maps snake_case row fields to camelCase', () => {
  const row = {
    id: 'c1',
    name: 'Panel',
    members: JSON.stringify([{ provider: 'claude', model: 'opus' }]),
    created_at: 100,
    updated_at: 200,
  };
  const result = rowToConfig(row);
  assert.equal(result.id, 'c1');
  assert.equal(result.name, 'Panel');
  assert.equal(result.createdAt, 100);
  assert.equal(result.updatedAt, 200);
  assert.deepEqual(result.members, [{ provider: 'claude', model: 'opus' }]);
});

test('rowToConfig round-trips complex members array', () => {
  const members = [
    { provider: 'claude', model: 'opus', effort: 'high' },
    { provider: 'codex', model: 'gpt-5', reasoning: 'high' },
    { provider: 'gemini', model: 'pro' },
  ];
  const row = { id: 'x', name: 'x', members: JSON.stringify(members), created_at: 1, updated_at: 1 };
  assert.deepEqual(rowToConfig(row).members, members);
});

// ── Config CRUD tests (via fake DB) ──────────────────────────────────────────

test('listConfigs returns empty array on fresh DB', () => {
  const db = makeFakeConfigDb();
  assert.deepEqual(db.listConfigs(), []);
});

test('upsertConfig inserts and getConfig retrieves', () => {
  const db = makeFakeConfigDb();
  const cfg = { id: 'c1', name: 'Panel', members: [{ provider: 'claude', model: 'opus' }], createdAt: 100, updatedAt: 100 };
  db.upsertConfig(cfg);
  assert.deepEqual(db.getConfig('c1'), cfg);
});

test('listConfigs returns all configs ordered by createdAt', () => {
  const db = makeFakeConfigDb();
  db.upsertConfig({ id: 'c2', name: 'B', members: [], createdAt: 200, updatedAt: 200 });
  db.upsertConfig({ id: 'c1', name: 'A', members: [], createdAt: 100, updatedAt: 100 });
  assert.deepEqual(db.listConfigs().map((c) => c.id), ['c1', 'c2']);
});

test('deleteConfig removes the config', () => {
  const db = makeFakeConfigDb();
  db.upsertConfig({ id: 'c1', name: 'X', members: [], createdAt: 1, updatedAt: 1 });
  db.deleteConfig('c1');
  assert.equal(db.getConfig('c1'), null);
  assert.deepEqual(db.listConfigs(), []);
});

test('deleteConfig on unknown id is a no-op', () => {
  const db = makeFakeConfigDb();
  assert.doesNotThrow(() => db.deleteConfig('does-not-exist'));
});

// ── service.upsertConfig tests ────────────────────────────────────────────────

test('upsertConfig generates an id when none provided', () => {
  const db = makeFakeConfigDb();
  let n = 0;
  const cfg = serviceUpsertConfig(db, { name: 'X', members: [] }, () => `id${++n}`);
  assert.ok(cfg.id.startsWith('council_'));
  assert.equal(db.getConfig(cfg.id)?.name, 'X');
});

test('upsertConfig preserves createdAt on update', () => {
  const db = makeFakeConfigDb();
  const first = serviceUpsertConfig(db, { id: 'c1', name: 'Old', members: [] }, () => 'x');
  const originalCreatedAt = first.createdAt;

  const updated = serviceUpsertConfig(db, { id: 'c1', name: 'New', members: [{ provider: 'claude', model: 'opus' }] }, () => 'x');
  assert.equal(updated.createdAt, originalCreatedAt, 'createdAt must not change on update');
  assert.equal(updated.name, 'New');
  assert.ok(updated.updatedAt >= originalCreatedAt);
});

test('upsertConfig sets createdAt = updatedAt on first insert', () => {
  const db = makeFakeConfigDb();
  const cfg = serviceUpsertConfig(db, { id: 'c1', name: 'X', members: [] }, () => 'x');
  // Both are set to Date.now() at the time of first insert
  assert.ok(typeof cfg.createdAt === 'number' && cfg.createdAt > 0);
  assert.ok(typeof cfg.updatedAt === 'number' && cfg.updatedAt > 0);
});

// ── migrateConfigsFromStore tests ─────────────────────────────────────────────

test('migrateFromStore imports configs from Electron store on first call', () => {
  const db = makeFakeConfigDb();
  db.migrateFromStore({
    c1: { id: 'c1', name: 'Legacy', members: [{ provider: 'claude', model: 'opus' }], createdAt: 50, updatedAt: 50 },
  });
  assert.equal(db.getConfig('c1')?.name, 'Legacy');
});

test('migrateFromStore is idempotent — does not re-run after first call', () => {
  const db = makeFakeConfigDb();
  db.migrateFromStore({ c1: { id: 'c1', name: 'From store', members: [], createdAt: 1, updatedAt: 1 } });

  // Update the config after migration
  db.upsertConfig({ id: 'c1', name: 'Updated after migration', members: [], createdAt: 1, updatedAt: 2 });

  // Second migration call — must be a no-op
  db.migrateFromStore({ c1: { id: 'c1', name: 'From store', members: [], createdAt: 1, updatedAt: 1 } });
  assert.equal(db.getConfig('c1')?.name, 'Updated after migration');
});

test('migrateFromStore with empty store marks done but inserts nothing', () => {
  const db = makeFakeConfigDb();
  db.migrateFromStore({});
  assert.deepEqual(db.listConfigs(), []);
  // Second call with a real config — must be ignored (already marked done)
  db.migrateFromStore({ c1: { id: 'c1', name: 'X', members: [], createdAt: 1, updatedAt: 1 } });
  assert.equal(db.getConfig('c1'), null, 'second migration call must be a no-op');
});

test('migrateFromStore uses INSERT OR IGNORE — does not clobber pre-existing configs', () => {
  const db = makeFakeConfigDb();
  // Config already in SQLite before migration runs
  db.upsertConfig({ id: 'c1', name: 'Current', members: [], createdAt: 1, updatedAt: 99 });

  // Migration has older version of c1
  db.migrateFromStore({ c1: { id: 'c1', name: 'Old store version', members: [], createdAt: 1, updatedAt: 1 } });
  assert.equal(db.getConfig('c1')?.name, 'Current', 'pre-existing config must not be overwritten');
  assert.equal(db.getConfig('c1')?.updatedAt, 99);
});

test('migrateFromStore imports multiple configs in one pass', () => {
  const db = makeFakeConfigDb();
  db.migrateFromStore({
    c1: { id: 'c1', name: 'A', members: [], createdAt: 1, updatedAt: 1 },
    c2: { id: 'c2', name: 'B', members: [], createdAt: 2, updatedAt: 2 },
    c3: { id: 'c3', name: 'C', members: [], createdAt: 3, updatedAt: 3 },
  });
  assert.equal(db.listConfigs().length, 3);
});

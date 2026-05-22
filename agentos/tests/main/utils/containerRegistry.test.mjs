/**
 * Tests for utils/containerRegistry.ts — registry read/write/mutate logic (inlined).
 * Uses a temp directory so no real ~/.agentos/state is touched.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// ── Inlined registry logic from containerRegistry.ts ─────────────────────────

const DEFAULT_REGISTRY = { version: 1, entries: [] };

function resolveStateDir(baseDir) {
  return path.join(baseDir, '.agentos', 'state');
}

function registryPath(baseDir) {
  return path.join(resolveStateDir(baseDir), 'container-registry.json');
}

function lockPath(targetPath) {
  return `${targetPath}.lock`;
}

async function withRegistryLock(targetPath, fn) {
  const lockFile = lockPath(targetPath);
  const retryDelayMs = 25;
  const maxAttempts = 200;

  await fs.mkdir(path.dirname(lockFile), { recursive: true });

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const handle = await fs.open(lockFile, 'wx');
      try {
        return await fn();
      } finally {
        await handle.close().catch(() => {});
        await fs.rm(lockFile, { force: true }).catch(() => {});
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }

  // Stale lock fallback
  await fs.rm(lockFile, { force: true }).catch(() => {});
  const handle = await fs.open(lockFile, 'wx');
  try {
    return await fn();
  } finally {
    await handle.close().catch(() => {});
    await fs.rm(lockFile, { force: true }).catch(() => {});
  }
}

async function readRegistryStrict(targetPath) {
  const raw = await fs.readFile(targetPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid registry format');
  if (parsed.version !== 1 || !Array.isArray(parsed.entries)) throw new Error('Invalid registry format');
  return { version: 1, entries: parsed.entries };
}

async function readContainerRegistry(baseDir) {
  const targetPath = registryPath(baseDir);
  try {
    return await readRegistryStrict(targetPath);
  } catch {
    return { ...DEFAULT_REGISTRY };
  }
}

async function writeRegistry(targetPath, next) {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  const payload = `${JSON.stringify(next, null, 2)}\n`;
  const tempPath = path.join(dir, `${path.basename(targetPath)}.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(tempPath, payload, 'utf8');
  try {
    await fs.rename(tempPath, targetPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function mutateRegistry(baseDir, mutate) {
  const targetPath = registryPath(baseDir);
  await withRegistryLock(targetPath, async () => {
    const current = await readContainerRegistry(baseDir);
    const nextEntries = mutate(current.entries);
    if (nextEntries === null) return;
    await writeRegistry(targetPath, { version: 1, entries: nextEntries });
  });
}

async function upsertContainerRegistryEntry(baseDir, entry) {
  await mutateRegistry(baseDir, (entries) => {
    const existing = entries.find((item) => item.containerName === entry.containerName);
    const next = entries.filter((item) => item.containerName !== entry.containerName);
    next.push({
      ...entry,
      createdAtMs: existing?.createdAtMs ?? entry.createdAtMs,
      image: existing?.image ?? entry.image,
      configHash: entry.configHash ?? existing?.configHash,
    });
    return next;
  });
}

async function touchContainerRegistryEntry(baseDir, containerName, timestampMs = Date.now()) {
  await mutateRegistry(baseDir, (entries) => {
    const idx = entries.findIndex((e) => e.containerName === containerName);
    if (idx < 0) return null;
    const next = [...entries];
    next[idx] = { ...next[idx], lastUsedAtMs: timestampMs };
    return next;
  });
}

async function removeContainerRegistryEntry(baseDir, containerName) {
  await mutateRegistry(baseDir, (entries) => {
    const next = entries.filter((e) => e.containerName !== containerName);
    if (next.length === entries.length) return null;
    return next;
  });
}

async function removeContainerRegistryEntriesForThread(baseDir, threadId) {
  await mutateRegistry(baseDir, (entries) => {
    const next = entries.filter((e) => e.threadId !== threadId);
    if (next.length === entries.length) return null;
    return next;
  });
}

async function findContainerRegistryEntry(baseDir, containerName) {
  const registry = await readContainerRegistry(baseDir);
  return registry.entries.find((e) => e.containerName === containerName) ?? null;
}

// ── test helpers ──────────────────────────────────────────────────────────────

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-registry-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function makeEntry(overrides = {}) {
  return {
    containerName: 'agentos-session-thread1',
    threadId: 'thread1',
    createdAtMs: 1000,
    lastUsedAtMs: 2000,
    image: 'agentos-sandbox:latest',
    ...overrides,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

test('readContainerRegistry returns empty registry when file does not exist', async () => {
  await withTempDir(async (dir) => {
    const reg = await readContainerRegistry(dir);
    assert.deepEqual(reg, { version: 1, entries: [] });
  });
});

test('upsertContainerRegistryEntry adds a new entry', async () => {
  await withTempDir(async (dir) => {
    const entry = makeEntry();
    await upsertContainerRegistryEntry(dir, entry);
    const reg = await readContainerRegistry(dir);
    assert.equal(reg.entries.length, 1);
    assert.equal(reg.entries[0].containerName, 'agentos-session-thread1');
  });
});

test('upsertContainerRegistryEntry updates existing entry but preserves createdAtMs and image', async () => {
  await withTempDir(async (dir) => {
    const original = makeEntry({ createdAtMs: 1000, image: 'original-image:v1' });
    await upsertContainerRegistryEntry(dir, original);

    const updated = makeEntry({ createdAtMs: 9999, image: 'new-image:v2', lastUsedAtMs: 3000, configHash: 'abc' });
    await upsertContainerRegistryEntry(dir, updated);

    const reg = await readContainerRegistry(dir);
    assert.equal(reg.entries.length, 1);
    // createdAtMs and image preserved from original
    assert.equal(reg.entries[0].createdAtMs, 1000);
    assert.equal(reg.entries[0].image, 'original-image:v1');
    // lastUsedAtMs and configHash updated
    assert.equal(reg.entries[0].lastUsedAtMs, 3000);
    assert.equal(reg.entries[0].configHash, 'abc');
  });
});

test('upsertContainerRegistryEntry can store multiple entries', async () => {
  await withTempDir(async (dir) => {
    await upsertContainerRegistryEntry(dir, makeEntry({ containerName: 'c1', threadId: 't1' }));
    await upsertContainerRegistryEntry(dir, makeEntry({ containerName: 'c2', threadId: 't2' }));
    const reg = await readContainerRegistry(dir);
    assert.equal(reg.entries.length, 2);
  });
});

test('touchContainerRegistryEntry updates lastUsedAtMs', async () => {
  await withTempDir(async (dir) => {
    await upsertContainerRegistryEntry(dir, makeEntry({ lastUsedAtMs: 1000 }));
    await touchContainerRegistryEntry(dir, 'agentos-session-thread1', 9999);
    const entry = await findContainerRegistryEntry(dir, 'agentos-session-thread1');
    assert.equal(entry.lastUsedAtMs, 9999);
  });
});

test('touchContainerRegistryEntry does nothing for unknown container', async () => {
  await withTempDir(async (dir) => {
    await upsertContainerRegistryEntry(dir, makeEntry());
    await touchContainerRegistryEntry(dir, 'unknown-container', 9999);
    const reg = await readContainerRegistry(dir);
    assert.equal(reg.entries[0].lastUsedAtMs, 2000); // unchanged
  });
});

test('removeContainerRegistryEntry removes the entry', async () => {
  await withTempDir(async (dir) => {
    await upsertContainerRegistryEntry(dir, makeEntry({ containerName: 'c1', threadId: 't1' }));
    await upsertContainerRegistryEntry(dir, makeEntry({ containerName: 'c2', threadId: 't2' }));
    await removeContainerRegistryEntry(dir, 'c1');
    const reg = await readContainerRegistry(dir);
    assert.equal(reg.entries.length, 1);
    assert.equal(reg.entries[0].containerName, 'c2');
  });
});

test('removeContainerRegistryEntry does nothing for unknown container', async () => {
  await withTempDir(async (dir) => {
    await upsertContainerRegistryEntry(dir, makeEntry());
    await removeContainerRegistryEntry(dir, 'nonexistent');
    const reg = await readContainerRegistry(dir);
    assert.equal(reg.entries.length, 1); // still there
  });
});

test('removeContainerRegistryEntriesForThread removes all entries for that thread', async () => {
  await withTempDir(async (dir) => {
    await upsertContainerRegistryEntry(dir, makeEntry({ containerName: 'c1', threadId: 't1' }));
    await upsertContainerRegistryEntry(dir, makeEntry({ containerName: 'c2', threadId: 't1' }));
    await upsertContainerRegistryEntry(dir, makeEntry({ containerName: 'c3', threadId: 't2' }));
    await removeContainerRegistryEntriesForThread(dir, 't1');
    const reg = await readContainerRegistry(dir);
    assert.equal(reg.entries.length, 1);
    assert.equal(reg.entries[0].containerName, 'c3');
  });
});

test('removeContainerRegistryEntriesForThread does nothing for unknown thread', async () => {
  await withTempDir(async (dir) => {
    await upsertContainerRegistryEntry(dir, makeEntry());
    await removeContainerRegistryEntriesForThread(dir, 'unknown-thread');
    const reg = await readContainerRegistry(dir);
    assert.equal(reg.entries.length, 1);
  });
});

test('findContainerRegistryEntry returns null for unknown container', async () => {
  await withTempDir(async (dir) => {
    const found = await findContainerRegistryEntry(dir, 'nonexistent');
    assert.equal(found, null);
  });
});

test('findContainerRegistryEntry returns the matching entry', async () => {
  await withTempDir(async (dir) => {
    await upsertContainerRegistryEntry(dir, makeEntry({ containerName: 'c1', threadId: 't1' }));
    await upsertContainerRegistryEntry(dir, makeEntry({ containerName: 'c2', threadId: 't2' }));
    const entry = await findContainerRegistryEntry(dir, 'c2');
    assert.equal(entry?.threadId, 't2');
  });
});

test('readRegistryStrict: invalid JSON in file returns empty registry', async () => {
  await withTempDir(async (dir) => {
    const rPath = registryPath(dir);
    await fs.mkdir(path.dirname(rPath), { recursive: true });
    await fs.writeFile(rPath, 'not-json', 'utf8');
    const reg = await readContainerRegistry(dir);
    assert.deepEqual(reg, { version: 1, entries: [] });
  });
});

test('readRegistry: version mismatch returns empty registry', async () => {
  await withTempDir(async (dir) => {
    const rPath = registryPath(dir);
    await fs.mkdir(path.dirname(rPath), { recursive: true });
    await fs.writeFile(rPath, JSON.stringify({ version: 2, entries: [] }), 'utf8');
    const reg = await readContainerRegistry(dir);
    assert.deepEqual(reg, { version: 1, entries: [] });
  });
});

test('concurrent upserts on the same container do not corrupt the registry', async () => {
  await withTempDir(async (dir) => {
    // Same container upserted 5 times concurrently — stresses the lock mechanism
    const entry = makeEntry({ containerName: 'shared-container', threadId: 't1' });
    await Promise.all(Array.from({ length: 5 }, () => upsertContainerRegistryEntry(dir, entry)));
    const reg = await readContainerRegistry(dir);
    assert.equal(reg.entries.length, 1);
    assert.equal(reg.entries[0].containerName, 'shared-container');
  });
});

test('concurrent upserts of distinct containers all land in the registry', async () => {
  await withTempDir(async (dir) => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ containerName: `c${i}`, threadId: `t${i}` })
    );
    await Promise.all(entries.map((e) => upsertContainerRegistryEntry(dir, e)));
    const reg = await readContainerRegistry(dir);
    assert.equal(reg.entries.length, 5);
  });
});

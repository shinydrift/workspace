import fs from 'fs';
import path from 'path';
// eslint-disable-next-line import/no-named-as-default
import type Database from 'better-sqlite3';
import type { MemoryDoctorResult, MemoryIndexStatus, MemoryHealthReport } from '../../shared/types';
import type { EmbeddingProvider } from './embedding/provider';
import type { SyncScope } from './sync/core';
import { checkVecTable } from './db';
import { verifyIntegrity } from './integrity';

export function memoryStatus(
  scope: SyncScope,
  db: Database.Database,
  provider: EmbeddingProvider | null,
  homeDir: string
): MemoryIndexStatus {
  const chunkCount = (db.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }).n;
  const memCount = (
    db.prepare("SELECT COUNT(DISTINCT path) AS n FROM chunks WHERE source = 'memory'").get() as { n: number }
  ).n;
  const sessCount = (
    db.prepare("SELECT COUNT(DISTINCT path) AS n FROM chunks WHERE source = 'sessions'").get() as { n: number }
  ).n;
  const latest = (db.prepare('SELECT MAX(updated_at) AS t FROM chunks').get() as { t: number | null }).t;
  const sources: Array<'memory' | 'sessions'> = [];
  if (memCount > 0) sources.push('memory');
  if (sessCount > 0) sources.push('sessions');

  const storedRoot =
    (
      db.prepare("SELECT value FROM meta WHERE key = 'merkle_root_' || ?").get(scope.projectId) as
        | { value: string }
        | undefined
    )?.value ?? null;
  const integrity = verifyIntegrity(db, scope.projectId);

  return {
    projectId: scope.projectId,
    cachePath: path.join(homeDir, '.agentos', 'memory', 'projects', `${scope.projectId}.sqlite`),
    builtAt: latest,
    hasMemoryFiles: memCount > 0,
    hasSessionHistory: sessCount > 0,
    memoryFileCount: memCount,
    sessionFileCount: sessCount,
    entryCount: chunkCount,
    sources,
    embeddingProvider: provider?.id ?? null,
    embeddingModel: provider?.model ?? null,
    embeddingDimensions: provider?.dims ?? null,
    merkle_root: storedRoot,
    integrity,
  };
}

export function memoryDoctor(
  scope: SyncScope,
  db: Database.Database,
  provider: EmbeddingProvider | null,
  providerError?: string
): MemoryDoctorResult {
  const checks: MemoryDoctorResult['checks'] = [];
  const issues: string[] = [];

  const projectMemoryPath = scope.memoryRootPath ? path.join(scope.memoryRootPath, scope.projectId) : null;
  const memDirOk = !!(projectMemoryPath && fs.existsSync(projectMemoryPath));
  checks.push({ name: 'memory_dir', ok: memDirOk, detail: projectMemoryPath ?? 'not configured' });
  if (!memDirOk) issues.push(`Memory directory not found: ${projectMemoryPath ?? 'not configured'}`);

  if (providerError) issues.push(`Embedding error: ${providerError}`);
  checks.push({
    name: 'embedding_provider',
    ok: !!provider,
    detail: provider ? `${provider.id}/${provider.model}` : 'none (FTS-only)',
  });

  try {
    const n = (db.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }).n;
    checks.push({ name: 'db_chunks', ok: true, detail: `${n} chunks indexed` });
  } catch (err) {
    checks.push({ name: 'db_chunks', ok: false, detail: String(err) });
    issues.push('Database read failed');
  }

  const hasVecTable = checkVecTable(db);
  checks.push({ name: 'sqlite_vec', ok: hasVecTable, detail: hasVecTable ? 'loaded' : 'unavailable (FTS-only)' });

  return { ok: issues.length === 0, issues, checks };
}

export function memoryHealthCheck(
  scope: SyncScope,
  db: Database.Database,
  provider: EmbeddingProvider | null
): MemoryHealthReport {
  const projectMemoryPath = scope.memoryRootPath ? path.join(scope.memoryRootPath, scope.projectId) : null;

  // ── Stale file detector ───────────────────────────────────────────────────
  const fileRows = db.prepare('SELECT path, mtime, size FROM files WHERE source = ?').all('memory') as Array<{
    path: string;
    mtime: number;
    size: number;
  }>;
  const staleFiles: MemoryHealthReport['staleFiles'] = [];
  for (const row of fileRows) {
    const absPath = row.path.startsWith('extra:')
      ? row.path.slice(6)
      : projectMemoryPath
        ? path.join(projectMemoryPath, row.path)
        : null;
    if (!absPath) continue;
    try {
      const stat = fs.statSync(absPath);
      if (Math.floor(stat.mtimeMs) > row.mtime || stat.size !== row.size) {
        staleFiles.push({ path: row.path, indexedAt: row.mtime, modifiedAt: Math.floor(stat.mtimeMs) });
      }
    } catch {
      /* file deleted — not reported here */
    }
  }

  // ── Embedding coverage gaps ───────────────────────────────────────────────
  const unembeddedChunks: MemoryHealthReport['unembeddedChunks'] = [];
  if (checkVecTable(db)) {
    const rows = db
      .prepare(
        `SELECT c.id, c.path, c.start_line, c.end_line, c.text
         FROM chunks c
         LEFT JOIN chunks_vec v ON c.id = v.id
         WHERE v.id IS NULL AND c.source = 'memory'`
      )
      .all() as Array<{ id: string; path: string; start_line: number; end_line: number; text: string }>;
    for (const r of rows) {
      unembeddedChunks.push({
        id: r.id,
        path: r.path,
        startLine: r.start_line,
        endLine: r.end_line,
        preview: r.text.slice(0, 120),
      });
    }
  }

  // ── Duplicate chunk detector ──────────────────────────────────────────────
  const dupRows = db
    .prepare(
      `SELECT hash, COUNT(*) AS n, GROUP_CONCAT(id, '|') AS ids, MIN(path) AS sample_path
       FROM chunks
       WHERE source = 'memory'
       GROUP BY hash
       HAVING n > 1`
    )
    .all() as Array<{ hash: string; n: number; ids: string; sample_path: string }>;
  const duplicateGroups: MemoryHealthReport['duplicateGroups'] = dupRows.map((r) => ({
    hash: r.hash,
    count: r.n,
    ids: r.ids.split('|'),
    samplePath: r.sample_path,
  }));

  // ── Model mismatch detector ───────────────────────────────────────────────
  let staleModelChunks = 0;
  if (provider) {
    const row = db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE model IS NULL OR model != ?').get(provider.model) as
      | { n: number }
      | undefined;
    staleModelChunks = row?.n ?? 0;
  }

  return { staleFiles, unembeddedChunks, duplicateGroups, staleModelChunks };
}

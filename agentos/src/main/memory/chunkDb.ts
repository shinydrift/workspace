import type { Database } from 'better-sqlite3';
import type { ChunkRow, MemoryListResult } from '../../shared/types';
import { checkVecTable } from './db';

export function deleteChunk(db: Database, chunkId: string): void {
  const hasVecTable = checkVecTable(db);
  db.transaction(() => {
    if (hasVecTable) db.prepare('DELETE FROM chunks_vec WHERE id = ?').run(chunkId);
    db.prepare('DELETE FROM chunks_fts WHERE id = ?').run(chunkId);
    db.prepare('DELETE FROM chunks WHERE id = ?').run(chunkId);
  })();
}

export function deleteFile(db: Database, filePath: string): void {
  const hasVecTable = checkVecTable(db);
  db.transaction(() => {
    if (hasVecTable) {
      db.prepare('DELETE FROM chunks_vec WHERE id IN (SELECT id FROM chunks WHERE path = ?)').run(filePath);
    }
    db.prepare('DELETE FROM chunks_fts WHERE path = ?').run(filePath);
    db.prepare('DELETE FROM chunks WHERE path = ?').run(filePath);
    db.prepare('DELETE FROM files WHERE path = ?').run(filePath);
  })();
}

export function updateChunk(db: Database, chunkId: string, text: string): void {
  db.transaction(() => {
    db.prepare('UPDATE chunks SET text = ?, user_edited = 1 WHERE id = ?').run(text, chunkId);
    db.prepare('UPDATE chunks_fts SET text = ? WHERE id = ?').run(text, chunkId);
  })();
}

export function pinChunk(db: Database, chunkId: string, pinned: boolean): void {
  db.prepare('UPDATE chunks SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, chunkId);
}

export function listChunks(
  db: Database,
  params: { source?: 'all' | 'memory' | 'sessions' | 'code'; page: number; pageSize: number }
): MemoryListResult {
  const filterSource = params.source && params.source !== 'all' ? params.source : null;
  const total = filterSource
    ? (db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE source = ?').get(filterSource) as { n: number }).n
    : (db.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }).n;
  const offset = params.page * params.pageSize;
  const selectSql =
    'SELECT id, path, source, start_line, end_line, model, text, updated_at, pinned, user_edited FROM chunks';
  const rows = (
    filterSource
      ? db
          .prepare(`${selectSql} WHERE source = ? ORDER BY path, start_line LIMIT ? OFFSET ?`)
          .all(filterSource, params.pageSize, offset)
      : db.prepare(`${selectSql} ORDER BY path, start_line LIMIT ? OFFSET ?`).all(params.pageSize, offset)
  ) as Array<{
    id: string;
    path: string;
    source: string;
    start_line: number;
    end_line: number;
    model: string;
    text: string;
    updated_at: number;
    pinned: number;
    user_edited: number;
  }>;
  const chunks: ChunkRow[] = rows.map((r) => ({
    id: r.id,
    path: r.path,
    source: r.source as 'memory' | 'sessions' | 'code',
    startLine: r.start_line,
    endLine: r.end_line,
    model: r.model,
    text: r.text,
    updatedAt: r.updated_at,
    pinned: r.pinned === 1,
    userEdited: r.user_edited === 1,
  }));
  return { chunks, total };
}

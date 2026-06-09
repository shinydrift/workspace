import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getStore } from '../store/index';
import { logNonFatal } from '../utils/errorReporting';
import { getProjectDb } from './projectDb';
import { ensureVecTable } from './vecSupport';
import {
  deleteChunk as dbDeleteChunk,
  deleteFile as dbDeleteFile,
  updateChunk as dbUpdateChunk,
  pinChunk as dbPinChunk,
  listChunks as dbListChunks,
  writeChunkEmbedding,
} from './chunkDb';
import { getProvider, embedChunks } from './embedding/cache';
import { enqueueEmbed } from './sync/embedQueue';
import { createSnippet } from './utils';
import { hashText } from './sync/core';
import { MEMORY_SECTION_MAX_CHARS } from './chunking';
import { markMerkleRootDirty } from './integrity';
import type { SyncScope } from './sync/core';
import type { MemoryEntryRecord, MemoryListResult } from '../../shared/types';
import type { MemoryStatsService } from './statsService';

type GetParams = {
  entryId?: string;
  path?: string;
  skipExpansion?: boolean;
};

function normalizeMemoryRelPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) throw new Error('Invalid memory path.');
  if (!normalized.includes('/') && normalized !== 'MEMORY.md') return `memory/${normalized}`;
  if (normalized !== 'MEMORY.md' && !normalized.startsWith('memory/')) {
    throw new Error('Memory paths must target MEMORY.md or memory/*.md.');
  }
  return normalized;
}

function rowToEntry(row: {
  id: string;
  source: string;
  path: string;
  text: string;
  start_line: number;
  end_line: number;
  updated_at: number;
}): MemoryEntryRecord {
  return {
    id: row.id,
    source: row.source as 'memory' | 'sessions' | 'code',
    path: row.path,
    title: row.path,
    text: row.text,
    snippet: createSnippet(row.text, ''),
    startLine: row.start_line,
    endLine: row.end_line,
    timestamp: row.updated_at,
  };
}

export class MemoryContentService {
  constructor(private stats: MemoryStatsService) {}

  async saveChunk(
    scope: SyncScope,
    params: { threadId: string; summary: string; text: string; chunkId?: string }
  ): Promise<{ chunkId: string }> {
    const db = getProjectDb(scope.projectId);
    const settings = getStore().get('settings');
    // Provider resolves from the cache after warmup, so this is a near-instant await
    // in steady state. We need the real model name here so the chunk passes the
    // `c.model = ?` filter in search/engine.ts immediately, even before the
    // background embed lands.
    const provider = await getProvider(settings);
    const hasVecTable = provider ? ensureVecTable(db, provider.dims) : false;
    const modelName = provider?.model ?? '__none__';
    const chunkId = params.chunkId ?? `session:${params.threadId}:${Date.now()}:${randomUUID().slice(0, 8)}`;
    const isUpsert = !!params.chunkId;
    const sessionPath = `sessions/${params.threadId}.jsonl`;
    const embedText = `${params.summary}\n\n${params.text}`;
    const hash = hashText(embedText);
    const now = Date.now();

    // Insert chunk + FTS rows synchronously so the chunk_id is findable via text
    // search immediately. Embedding + chunks_vec write run in the background queue
    // below, which lets the caller return without waiting on the HTTP/local-llama
    // embedding call (the dominant cost in saveChunk).
    //
    // The cost of this design is two transactions per saveChunk instead of one
    // (the original code bundled everything atomically). The extra COMMIT is
    // worth it: it removes the embedding round-trip from the caller's latency
    // and lets the chunk become FTS-searchable before the embedding lands.
    db.transaction(() => {
      if (isUpsert) {
        db.prepare('DELETE FROM chunks_fts WHERE id = ?').run(chunkId);
        if (hasVecTable) db.prepare('DELETE FROM chunks_vec WHERE id = ?').run(chunkId);
      }
      db.prepare(
        `INSERT ${isUpsert ? 'OR REPLACE ' : ''}INTO chunks
         (id, path, source, start_line, end_line, hash, model, text, summary, embedding, updated_at, project_ids)
         VALUES (?, ?, 'sessions', ?, ?, ?, ?, ?, ?, '[]', ?, ?)`
      ).run(
        chunkId,
        sessionPath,
        0,
        0,
        hash,
        modelName,
        params.text,
        params.summary,
        now,
        JSON.stringify([scope.projectId])
      );
      db.prepare(
        `INSERT INTO chunks_fts (id, path, source, model, start_line, end_line, text)
         VALUES (?, ?, 'sessions', ?, ?, ?, ?)`
      ).run(chunkId, sessionPath, modelName, 0, 0, params.text);
    })();
    this.stats.invalidate(scope.projectId);
    markMerkleRootDirty(db, scope.projectId);

    if (provider) {
      void enqueueEmbed(scope.projectId, async () => {
        // Re-resolve the provider so a settings change between the sync insert
        // and this bg run doesn't leave the chunk embedded by the old provider
        // (and thus filtered out of search by the `c.model = ?` clause).
        const liveSettings = getStore().get('settings');
        const liveProvider = await getProvider(liveSettings);
        if (!liveProvider) return;
        const liveHasVecTable = ensureVecTable(db, liveProvider.dims);
        const embedMap = await embedChunks(db, liveProvider, [{ id: chunkId, text: embedText, hash }]);
        const embedding = embedMap.get(hash) ?? [];
        if (embedding.length === 0) return;
        // writeChunkEmbedding gates the chunks_vec insert on the UPDATE actually
        // matching a row — protects against the race where deleteChunk fired
        // between the sync insert and this bg call (would otherwise orphan a
        // chunks_vec row pointing at a missing chunks.id).
        writeChunkEmbedding(db, chunkId, embedding, {
          hasVecTable: liveHasVecTable,
          model: liveProvider.model !== modelName ? liveProvider.model : undefined,
        });
      });
    }

    return { chunkId };
  }

  async save(
    scope: SyncScope,
    params: { path: string; content: string; mode?: 'overwrite' | 'append' }
  ): Promise<{ savedPath: string; bytesWritten: number }> {
    if (!scope.memoryRootPath) throw new Error('No memory root path is configured.');
    const relPath = normalizeMemoryRelPath(params.path);
    const fullPath = path.join(scope.memoryRootPath, scope.projectId, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    const existing = params.mode === 'append' && fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
    const separator = existing && !existing.endsWith('\n') ? '\n' : '';
    const nextContent = existing + separator + params.content;
    const sections = nextContent.split(/\n---\n/);
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]!.trim();
      if (section.length > MEMORY_SECTION_MAX_CHARS) {
        throw new Error(
          `Section ${i + 1} exceeds the ${MEMORY_SECTION_MAX_CHARS} character limit (got ${section.length}). Split it with --- before saving.`
        );
      }
    }
    fs.writeFileSync(fullPath, nextContent, 'utf8');
    try {
      // Invalidate the file index so the next search re-syncs this file.
      // Stats cache is intentionally not cleared here: file writes don't change
      // chunk counts until the file is re-indexed on the next search.
      getProjectDb(scope.projectId).prepare('DELETE FROM files WHERE path = ?').run(relPath);
    } catch (err) {
      logNonFatal('memory', 'invalidate-file-index', err);
    }
    return { savedPath: fullPath, bytesWritten: Buffer.byteLength(nextContent, 'utf8') };
  }

  async get(scope: SyncScope, params: GetParams): Promise<MemoryEntryRecord | null> {
    const db = getProjectDb(scope.projectId);

    if (params.entryId?.trim()) {
      const row = db.prepare('SELECT * FROM chunks WHERE id = ?').get(params.entryId.trim()) as
        | {
            id: string;
            source: string;
            path: string;
            text: string;
            start_line: number;
            end_line: number;
            updated_at: number;
          }
        | undefined;
      if (!row) return null;
      if (!params.skipExpansion) {
        try {
          db.prepare('INSERT INTO chunk_expansions (chunk_id, expanded_at) VALUES (?, ?)').run(row.id, Date.now());
          this.stats.invalidate(scope.projectId);
        } catch {
          /* non-critical — don't fail the get if tracking insert fails */
        }
      }
      return rowToEntry(row);
    }

    const relPath = params.path ? normalizeMemoryRelPath(params.path) : '';
    if (!relPath) return null;

    const fullPath = scope.memoryRootPath ? path.join(scope.memoryRootPath, scope.projectId, relPath) : null;
    if (!fullPath || !fs.existsSync(fullPath)) {
      const row = db.prepare("SELECT * FROM chunks WHERE path = ? AND source = 'memory' LIMIT 1").get(relPath) as
        | {
            id: string;
            source: string;
            path: string;
            text: string;
            start_line: number;
            end_line: number;
            updated_at: number;
          }
        | undefined;
      if (!row) return null;
      return rowToEntry(row);
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    const lineCount = content.split('\n').length;
    return {
      source: 'memory',
      path: relPath,
      title: relPath,
      text: content,
      snippet: createSnippet(content, ''),
      startLine: 1,
      endLine: lineCount,
    };
  }

  listChunks(
    scope: SyncScope,
    params: { source?: 'all' | 'memory' | 'sessions' | 'code'; page: number; pageSize: number }
  ): MemoryListResult {
    return dbListChunks(getProjectDb(scope.projectId), params);
  }

  deleteChunk(scope: SyncScope, chunkId: string): void {
    dbDeleteChunk(getProjectDb(scope.projectId), chunkId);
    this.stats.invalidate(scope.projectId);
  }

  deleteFile(scope: SyncScope, filePath: string): void {
    dbDeleteFile(getProjectDb(scope.projectId), filePath);
    this.stats.invalidate(scope.projectId);
  }

  updateChunk(scope: SyncScope, chunkId: string, text: string): void {
    dbUpdateChunk(getProjectDb(scope.projectId), chunkId, text);
    this.stats.invalidate(scope.projectId);
  }

  pinChunk(scope: SyncScope, chunkId: string, pinned: boolean): void {
    dbPinChunk(getProjectDb(scope.projectId), chunkId, pinned);
    this.stats.invalidate(scope.projectId);
  }
}

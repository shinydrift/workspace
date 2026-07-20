import fs from 'fs';
import path from 'path';
export { hashText, memoryChunkId } from '../utils';
import { hashText, memoryChunkId } from '../utils';
import type { Thread } from '../../../shared/types';
import { getProjectDb, ensureVecTable } from '../db';
import type { EmbeddingProvider } from '../embedding/provider';
import { splitMemoryByDelimiters, MEMORY_SAVE_SECTION_MAX_CHARS } from '../chunking';
import { listCodeFiles, splitCodeBySymbols } from '../codeChunking';
import { embedChunks } from '../embedding/cache';
import { runtimeLogger as eventLogger } from '../runtime';

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export type SyncScope = {
  projectId: string;
  // Absolute path to the project workspace directory (used for config + graph extraction).
  projectPath: string | null;
  memoryRootPath: string | null;
  threads: Array<Pick<Thread, 'id' | 'name' | 'projectId'>>;
  extraMemoryPaths?: string[];
};

type NewChunk = {
  id: string;
  text: string;
  contextHeader: string;
  embedText: string;
  hash: string;
  path: string;
  source: string;
  startLine: number;
  endLine: number;
};

async function flushChunks(
  db: ReturnType<typeof getProjectDb>,
  provider: EmbeddingProvider | null,
  hasVecTable: boolean,
  modelName: string,
  chunks: NewChunk[],
  projectId?: string
): Promise<void> {
  if (chunks.length === 0) return;

  // For content-addressed memory chunks, skip re-embedding if the chunk already exists
  // with the same hash. Non-memory chunks always go through INSERT OR REPLACE.
  const selectHash = db.prepare('SELECT hash FROM chunks WHERE id = ?');
  const selectEmbedding = db.prepare('SELECT embedding FROM chunks WHERE id = ?');
  const chunksNeedingEmbed = projectId
    ? chunks.filter((c) => {
        if (c.source !== 'memory') return true;
        const existing = selectHash.get(c.id) as { hash: string } | undefined;
        return !existing || existing.hash !== c.hash;
      })
    : chunks;

  const embedMap = provider
    ? await embedChunks(
        db,
        provider,
        chunksNeedingEmbed.map((c) => ({ id: c.id, text: c.embedText, hash: c.hash }))
      )
    : new Map<string, number[]>();

  // For memory chunks with existing embeddings, pull them from the DB
  if (projectId) {
    for (const chunk of chunks) {
      if (chunk.source === 'memory' && !embedMap.has(chunk.hash)) {
        const row = selectEmbedding.get(chunk.id) as { embedding: string } | undefined;
        if (row) {
          try {
            const existing = JSON.parse(row.embedding) as number[];
            if (Array.isArray(existing) && existing.length > 0) embedMap.set(chunk.hash, existing);
          } catch {
            /* ignore */
          }
        }
      }
    }
  }

  const insertMemoryChunk = db.prepare(
    `INSERT OR IGNORE INTO chunks
     (id, path, source, start_line, end_line, hash, model, text, summary, embedding, updated_at, context_header, pinned, user_edited, project_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateProjectIds = db.prepare(`
    UPDATE chunks
    SET project_ids = CASE
      WHEN EXISTS (SELECT 1 FROM json_each(project_ids) WHERE value = ?)
      THEN project_ids
      ELSE json_insert(project_ids, '$[#]', ?)
    END
    WHERE id = ?
  `);
  const insertChunk = db.prepare(
    `INSERT OR REPLACE INTO chunks
     (id, path, source, start_line, end_line, hash, model, text, summary, embedding, updated_at, context_header, pinned, user_edited, project_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertFts = db.prepare(
    'INSERT OR REPLACE INTO chunks_fts (id, path, source, model, start_line, end_line, text) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertVec =
    hasVecTable && provider
      ? db.prepare('INSERT OR REPLACE INTO chunks_vec (id, embedding) VALUES (?, vec_f32(?))')
      : null;

  // Smaller batches → smaller per-batch sync transactions → shorter event-loop
  // stalls between yields. better-sqlite3 transactions cannot themselves yield,
  // so this is the only lever for reducing main-thread blocking inside flushChunks.
  const FLUSH_BATCH_SIZE = 20;
  for (let i = 0; i < chunks.length; i += FLUSH_BATCH_SIZE) {
    const batch = chunks.slice(i, i + FLUSH_BATCH_SIZE);
    db.transaction(() => {
      const now = Date.now();
      for (const chunk of batch) {
        const embedding = embedMap.get(chunk.hash) ?? [];
        const projectIds = projectId ? JSON.stringify([projectId]) : '[]';

        if (chunk.source === 'memory' && projectId) {
          insertMemoryChunk.run(
            chunk.id,
            chunk.path,
            chunk.source,
            chunk.startLine,
            chunk.endLine,
            chunk.hash,
            modelName,
            chunk.text,
            '',
            JSON.stringify(embedding),
            now,
            chunk.contextHeader,
            0,
            0,
            projectIds
          );
          updateProjectIds.run(projectId, projectId, chunk.id);
        } else {
          insertChunk.run(
            chunk.id,
            chunk.path,
            chunk.source,
            chunk.startLine,
            chunk.endLine,
            chunk.hash,
            modelName,
            chunk.text,
            '',
            JSON.stringify(embedding),
            now,
            chunk.contextHeader,
            0,
            0,
            projectIds
          );
        }
        insertFts.run(chunk.id, chunk.path, chunk.source, modelName, chunk.startLine, chunk.endLine, chunk.text);
        if (insertVec && embedding.length > 0) {
          insertVec.run(chunk.id, Buffer.from(new Float32Array(embedding).buffer));
        }
      }
    })();
    if (i + FLUSH_BATCH_SIZE < chunks.length) await yieldToEventLoop();
  }
}

// P2-C: Patterns that suggest a markdown file may contain secrets.
// Note: \.env is excluded from the word-boundary group because a leading dot is non-word,
// so \b never fires at position 0. It is checked separately via startsWith.
const SENSITIVE_FILENAME_RE = /\b(secret|credential|password|passwd|private.?key|api.?key)\b/i;

export async function listMarkdownFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];
  const recurse = async (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const subdirPromises: Promise<void>[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        subdirPromises.push(recurse(full));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        if (SENSITIVE_FILENAME_RE.test(entry.name) || entry.name.toLowerCase().startsWith('.env')) {
          eventLogger.warn('memory', 'Skipping potentially sensitive file', { path: full });
        } else {
          results.push(full);
        }
      }
    }
    await Promise.all(subdirPromises);
  };
  await recurse(rootDir);
  return results;
}

export async function syncProject(scope: SyncScope, provider: EmbeddingProvider | null): Promise<void> {
  const db = getProjectDb(scope.projectId);
  if (provider) ensureVecTable(db, provider.dims);

  const hasVecTable = !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_vec'").get();

  const upsertFile = db.prepare(
    'INSERT OR REPLACE INTO files (path, source, hash, mtime, size) VALUES (?, ?, ?, ?, ?)'
  );
  const deleteChunksForFile = db.prepare('DELETE FROM chunks WHERE path = ?');
  const deleteFtsForFile = db.prepare('DELETE FROM chunks_fts WHERE path = ?');
  const deleteVecForFile = hasVecTable
    ? db.prepare('DELETE FROM chunks_vec WHERE id IN (SELECT id FROM chunks WHERE path = ?)')
    : null;
  const insertPreservedChunk = db.prepare(
    `INSERT OR REPLACE INTO chunks
     (id, path, source, start_line, end_line, hash, model, text, summary, embedding, updated_at, context_header, pinned, user_edited, project_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertFts = db.prepare(
    'INSERT OR REPLACE INTO chunks_fts (id, path, source, model, start_line, end_line, text) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const selectPreserved = db.prepare(
    'SELECT id, start_line, end_line, hash, model, text, summary, embedding, context_header, pinned, user_edited FROM chunks WHERE path = ? AND (pinned = 1 OR user_edited = 1)'
  );
  type PreservedChunk = {
    id: string;
    start_line: number;
    end_line: number;
    hash: string;
    model: string;
    text: string;
    summary: string;
    embedding: string;
    context_header: string;
    pinned: number;
    user_edited: number;
  };

  const existingFiles = new Map(
    (db.prepare('SELECT path, hash FROM files').all() as Array<{ path: string; hash: string }>).map((r) => [
      r.path,
      r.hash,
    ])
  );

  const modelName = provider?.model ?? '__none__';
  const allNewChunks: NewChunk[] = [];
  let changedFiles = 0;

  const collectChunks = (content: string, chunkPath: string) => {
    for (const chunk of splitMemoryByDelimiters(content, chunkPath)) {
      if (chunk.text.length > MEMORY_SAVE_SECTION_MAX_CHARS) {
        eventLogger.warn('memory', 'Oversized memory section — split with --- to enforce the limit', {
          path: chunkPath,
          line: chunk.startLine,
          chars: chunk.text.length,
          limit: MEMORY_SAVE_SECTION_MAX_CHARS,
        });
      }
      const contextHeader = chunk.contextHeader ?? '';
      const embedText = contextHeader ? contextHeader + '\n' + chunk.text : chunk.text;
      allNewChunks.push({
        id: memoryChunkId(embedText),
        text: chunk.text,
        contextHeader,
        embedText,
        hash: hashText(embedText),
        path: chunkPath,
        source: 'memory',
        startLine: chunk.startLine,
        endLine: chunk.endLine,
      });
    }
  };

  // ── Memory files ─────────────────────────────────────────────────────────
  const projectMemoryPath = scope.memoryRootPath ? path.join(scope.memoryRootPath, scope.projectId) : null;
  eventLogger.info('memory', 'Indexing memory', {
    paths: [projectMemoryPath, ...(scope.extraMemoryPaths ?? [])].filter(Boolean),
  });

  if (projectMemoryPath) {
    for (const absPath of await listMarkdownFiles(projectMemoryPath)) {
      const relPath = path.relative(projectMemoryPath, absPath).replace(/\\/g, '/');
      if (relPath === 'BOOT.md') continue;
      let stat: fs.Stats;
      let content: string;
      try {
        stat = await fs.promises.stat(absPath);
        content = (await fs.promises.readFile(absPath, 'utf8')).trim();
      } catch {
        continue;
      }
      if (!content) continue;
      const fileHash = hashText(content);
      if (existingFiles.get(relPath) === fileHash) continue;
      changedFiles++;

      const preserved = selectPreserved.all(relPath) as PreservedChunk[];

      db.transaction(() => {
        deleteVecForFile?.run(relPath);
        deleteChunksForFile.run(relPath);
        deleteFtsForFile.run(relPath);
        upsertFile.run(relPath, 'memory', fileHash, Math.floor(stat.mtimeMs), stat.size);
        for (const p of preserved) {
          insertPreservedChunk.run(
            p.id,
            relPath,
            'memory',
            p.start_line,
            p.end_line,
            p.hash,
            p.model,
            p.text,
            p.summary,
            p.embedding,
            Date.now(),
            p.context_header,
            p.pinned,
            p.user_edited,
            JSON.stringify([scope.projectId])
          );
          insertFts.run(p.id, relPath, 'memory', p.model, p.start_line, p.end_line, p.text);
        }
      })();

      collectChunks(content, relPath);
      await yieldToEventLoop();
    }
  }

  // ── Extra memory paths ────────────────────────────────────────────────────
  for (const extraPath of scope.extraMemoryPaths ?? []) {
    for (const absPath of await listMarkdownFiles(extraPath)) {
      const relPath = `extra:${absPath}`;
      let stat: fs.Stats;
      let content: string;
      try {
        stat = await fs.promises.stat(absPath);
        content = (await fs.promises.readFile(absPath, 'utf8')).trim();
      } catch {
        continue;
      }
      if (!content) continue;
      const fileHash = hashText(content);
      if (existingFiles.get(relPath) === fileHash) continue;
      changedFiles++;

      const preservedExtra = selectPreserved.all(relPath) as PreservedChunk[];

      db.transaction(() => {
        if (hasVecTable) deleteVecForFile?.run(relPath);
        deleteChunksForFile.run(relPath);
        deleteFtsForFile.run(relPath);
        upsertFile.run(relPath, 'memory', fileHash, Math.floor(stat.mtimeMs), stat.size);
        for (const p of preservedExtra) {
          insertPreservedChunk.run(
            p.id,
            relPath,
            'memory',
            p.start_line,
            p.end_line,
            p.hash,
            p.model,
            p.text,
            p.summary,
            p.embedding,
            Date.now(),
            p.context_header,
            p.pinned,
            p.user_edited,
            JSON.stringify([scope.projectId])
          );
          insertFts.run(p.id, relPath, 'memory', p.model, p.start_line, p.end_line, p.text);
        }
      })();

      collectChunks(content, relPath);
      await yieldToEventLoop();
    }
  }

  // Session chunks are written directly via saveChunk (auto-fork + MCP memory_save_chunk).
  // syncProject handles memory markdown files only.
  // Code files are indexed separately via syncCodeFiles (background, does not block search).

  await flushChunks(db, provider, hasVecTable, modelName, allNewChunks, scope.projectId);
  if (allNewChunks.length > 0) {
    eventLogger.info('memory', 'Indexed', { source: 'memory', files: changedFiles, chunks: allNewChunks.length });
  }
}

export async function syncCodeFiles(scope: SyncScope, provider: EmbeddingProvider | null): Promise<void> {
  if (!scope.projectPath) return;
  try {
    await fs.promises.access(scope.projectPath);
  } catch {
    return;
  }
  eventLogger.info('memory', 'Indexing code', { path: scope.projectPath });

  const db = getProjectDb(scope.projectId);
  if (provider) ensureVecTable(db, provider.dims);

  const hasVecTable = !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_vec'").get();

  const upsertFile = db.prepare(
    'INSERT OR REPLACE INTO files (path, source, hash, mtime, size) VALUES (?, ?, ?, ?, ?)'
  );
  const deleteChunksForFile = db.prepare('DELETE FROM chunks WHERE path = ?');
  const deleteFtsForFile = db.prepare('DELETE FROM chunks_fts WHERE path = ?');
  const deleteVecForFile = hasVecTable
    ? db.prepare('DELETE FROM chunks_vec WHERE id IN (SELECT id FROM chunks WHERE path = ?)')
    : null;

  const existingFiles = new Map(
    (
      db.prepare('SELECT path, hash FROM files WHERE source = ?').all('code') as Array<{
        path: string;
        hash: string;
      }>
    ).map((r) => [r.path, r.hash])
  );

  const modelName = provider?.model ?? '__none__';
  const allNewChunks: NewChunk[] = [];
  let changedFiles = 0;

  for (const absPath of await listCodeFiles(scope.projectPath)) {
    const chunkPath = `code:${absPath}`;
    let stat: fs.Stats;
    let content: string;
    try {
      stat = await fs.promises.stat(absPath);
      content = (await fs.promises.readFile(absPath, 'utf8')).trim();
    } catch {
      continue;
    }
    if (!content) continue;
    const fileHash = hashText(content);
    if (existingFiles.get(chunkPath) === fileHash) continue;
    changedFiles++;

    let codeChunks: Awaited<ReturnType<typeof splitCodeBySymbols>>;
    try {
      codeChunks = await splitCodeBySymbols(content, absPath);
    } catch (err) {
      eventLogger.warn('memory', 'Tree-sitter parse failed, skipping file', { path: absPath, err });
      continue;
    }

    db.transaction(() => {
      deleteVecForFile?.run(chunkPath);
      deleteChunksForFile.run(chunkPath);
      deleteFtsForFile.run(chunkPath);
      upsertFile.run(chunkPath, 'code', fileHash, Math.floor(stat.mtimeMs), stat.size);
    })();
    await yieldToEventLoop();

    for (const chunk of codeChunks) {
      const contextHeader = chunk.contextHeader ?? '';
      const embedText = contextHeader ? `${contextHeader}\n${chunk.text}` : chunk.text;
      allNewChunks.push({
        id: `code:${absPath}:${chunk.startLine}:${chunk.endLine}`,
        text: chunk.text,
        contextHeader,
        embedText,
        hash: hashText(embedText),
        path: chunkPath,
        source: 'code',
        startLine: chunk.startLine,
        endLine: chunk.endLine,
      });
    }
  }

  await flushChunks(db, provider, hasVecTable, modelName, allNewChunks, scope.projectId);
  if (allNewChunks.length > 0) {
    eventLogger.info('memory', 'Indexed', { source: 'code', files: changedFiles, chunks: allNewChunks.length });
  }
}

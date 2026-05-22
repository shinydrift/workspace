import { z } from 'zod';
import { IPC_CHANNELS } from '../../../shared/types';
import type {
  MemoryGetRequest,
  MemorySaveRequest,
  MemorySearchRequest,
  MemoryListRequest,
} from '../../../shared/types';
import { agentOSMemoryService } from '../../memory/service';
import { getProjectDb } from '../../memory/db';
import { type EdgeRelation } from '../../memory/graph';
import { getProject } from '../../threads/db';
import * as threadStore from '../../threads/threadStore';
import { analyticsService } from '../../analytics/service';
import { loadProjectConfig, updateProjectConfig } from '../../config/projectConfig';
import { threadId, filePath, chunkId, ThreadIdSchema } from './schemas';
import { defineHandler } from '../ipcResponse';

/** Resolve a threadId to its projectId (throws if thread not found). */
function getThreadProjectId(tid: string): string {
  const thread = threadStore.getThread(tid);
  if (!thread?.projectId) throw new Error('Thread not found');
  return thread.projectId;
}

/** Resolve a threadId to its projectId + project path (throws if either is missing). */
function getThreadProject(tid: string): { projectId: string; projectPath: string } {
  const projectId = getThreadProjectId(tid);
  const project = getProject(projectId);
  if (!project?.path) throw new Error('Project path not found');
  return { projectId, projectPath: project.path };
}

const MemoryGraphQuerySchema = z.object({
  threadId,
  entity: z.string().min(1).max(256),
  maxHops: z.number().int().min(1).max(4).optional(),
  relationTypes: z.array(z.enum(['related_to', 'fixes', 'modifies', 'depends_on'])).optional(),
  topK: z.number().int().min(1).max(200).optional(),
});

const MemoryGetEntityChunksSchema = z.object({
  threadId,
  entityId: z.string().min(1).max(128),
});

const MemoryGetDecayConfigSchema = z.object({ threadId });

const MemorySetDecayConfigSchema = z.object({
  threadId,
  config: z.object({
    decayEnabled: z.boolean().optional(),
    decayHalfLifeDays: z.number().positive().optional(),
    decayMinScore: z.number().min(0).max(1).optional(),
    graphEnabled: z.boolean().optional(),
    graphBoost: z.number().min(0).max(1).optional(),
  }),
});

const MemorySearchSchema: z.ZodType<MemorySearchRequest> = z.object({
  threadId,
  query: z.string().min(1).max(2048),
  maxResults: z.number().int().positive().max(100).optional(),
  minScore: z.number().min(0).max(1).optional(),
  source: z.enum(['all', 'memory', 'sessions']).optional(),
});

const MemoryGetSchema: z.ZodType<MemoryGetRequest> = z.object({
  threadId,
  entryId: z.string().min(1).max(256).optional(),
  path: filePath.optional(),
  skipExpansion: z.boolean().optional(),
});

const MemorySaveSchema: z.ZodType<MemorySaveRequest> = z.object({
  threadId,
  path: filePath,
  content: z.string().max(1_000_000),
  mode: z.enum(['overwrite', 'append']).optional(),
});

const MemoryListSchema: z.ZodType<MemoryListRequest> = z.object({
  threadId,
  source: z.enum(['all', 'memory', 'sessions', 'code']).optional(),
  page: z.number().int().min(0),
  pageSize: z.number().int().positive().max(500),
});

const ChunkIdSchema = z.object({ threadId, chunkId });

const MemoryUpdateChunkSchema = z.object({
  threadId,
  chunkId,
  text: z.string().max(1_000_000),
});

const MemoryPinChunkSchema = z.object({
  threadId,
  chunkId,
  pinned: z.boolean(),
});

const MemoryDeleteFileSchema = z.object({ threadId, path: filePath });

// Validated projectId for operations that reach the filesystem directly.
// The regex prevents path traversal via projectId (e.g. '../../etc/passwd').
const safeProjectId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid project ID');

export function registerMemoryHandlers(): void {
  defineHandler(IPC_CHANNELS.MEMORY_STATUS, ThreadIdSchema, ({ threadId: id }) =>
    agentOSMemoryService.status(undefined, id)
  );
  defineHandler(IPC_CHANNELS.MEMORY_REINDEX, ThreadIdSchema, ({ threadId: id }) =>
    agentOSMemoryService.reindex(undefined, id)
  );
  defineHandler(IPC_CHANNELS.MEMORY_DOCTOR, ThreadIdSchema, ({ threadId: id }) =>
    agentOSMemoryService.doctor(undefined, id)
  );

  defineHandler(IPC_CHANNELS.MEMORY_SEARCH, MemorySearchSchema, (req) => agentOSMemoryService.search(req));
  defineHandler(IPC_CHANNELS.MEMORY_GET, MemoryGetSchema, (req) => agentOSMemoryService.get(req));
  defineHandler(IPC_CHANNELS.MEMORY_SAVE, MemorySaveSchema, (req) => agentOSMemoryService.save(req));
  defineHandler(IPC_CHANNELS.MEMORY_LIST, MemoryListSchema, (req) => agentOSMemoryService.listChunks(req));

  defineHandler(IPC_CHANNELS.MEMORY_DELETE_CHUNK, ChunkIdSchema, ({ threadId: id, chunkId }) =>
    agentOSMemoryService.deleteChunk({ threadId: id, chunkId })
  );
  defineHandler(IPC_CHANNELS.MEMORY_DELETE_FILE, MemoryDeleteFileSchema, ({ threadId: id, path: p }) =>
    agentOSMemoryService.deleteFile({ threadId: id, path: p })
  );
  defineHandler(IPC_CHANNELS.MEMORY_UPDATE_CHUNK, MemoryUpdateChunkSchema, ({ threadId, chunkId, text }) =>
    agentOSMemoryService.updateChunk({ threadId, chunkId, text })
  );
  defineHandler(IPC_CHANNELS.MEMORY_PIN_CHUNK, MemoryPinChunkSchema, ({ threadId, chunkId, pinned }) =>
    agentOSMemoryService.pinChunk({ threadId, chunkId, pinned })
  );

  defineHandler(IPC_CHANNELS.MEMORY_GRAPH_QUERY, MemoryGraphQuerySchema, (req) =>
    agentOSMemoryService.graphQuery(undefined, req.threadId, req.entity, {
      maxHops: req.maxHops,
      relationTypes: req.relationTypes as EdgeRelation[] | undefined,
      topK: req.topK,
    })
  );

  defineHandler(
    IPC_CHANNELS.MEMORY_GRAPH_ALL,
    z.object({ threadId, topK: z.number().int().min(1).max(2000).optional() }),
    (req) => agentOSMemoryService.graphAll(undefined, req.threadId, req.topK)
  );

  defineHandler(
    IPC_CHANNELS.MEMORY_GRAPH_ALL_PAGE,
    z.object({
      threadId,
      offset: z.number().int().min(0),
      limit: z.number().int().min(1).max(500),
    }),
    (req) => agentOSMemoryService.graphAllPage(undefined, req.threadId, req.offset, req.limit)
  );

  defineHandler(IPC_CHANNELS.MEMORY_GET_ENTITY_CHUNKS, MemoryGetEntityChunksSchema, ({ threadId: tid, entityId }) => {
    const projectId = getThreadProjectId(tid);
    return { chunkIds: agentOSMemoryService.getEntityChunks(projectId, entityId) };
  });

  defineHandler(IPC_CHANNELS.MEMORY_REINDEX_GRAPH, ThreadIdSchema, ({ threadId: tid }) => {
    const projectId = getThreadProjectId(tid);
    const db = getProjectDb(projectId);
    db.transaction(() => {
      db.exec('DELETE FROM entities');
      db.exec('DELETE FROM edges');
    })();
    return { entityCount: 0, edgeCount: 0 };
  });

  defineHandler(IPC_CHANNELS.MEMORY_GET_DECAY_CONFIG, MemoryGetDecayConfigSchema, async ({ threadId: tid }) => {
    const { projectPath } = getThreadProject(tid);
    const result = await loadProjectConfig(projectPath);
    const mem = result.config?.memory ?? {};
    return {
      decayEnabled: mem.decayEnabled ?? true,
      decayHalfLifeDays: mem.decayHalfLifeDays ?? 45,
      decayMinScore: mem.decayMinScore ?? 0,
      graphEnabled: mem.graphEnabled ?? true,
      graphBoost: mem.graphBoost ?? 0.15,
    };
  });

  defineHandler(IPC_CHANNELS.MEMORY_SET_DECAY_CONFIG, MemorySetDecayConfigSchema, async ({ threadId: tid, config }) => {
    const { projectPath } = getThreadProject(tid);
    await updateProjectConfig(projectPath, 'memory', config);
    return { ok: true };
  });

  defineHandler(IPC_CHANNELS.MEMORY_HEALTH_CHECK, ThreadIdSchema, ({ threadId: id }) =>
    agentOSMemoryService.healthCheck(undefined, id)
  );

  defineHandler(
    IPC_CHANNELS.MEMORY_GET_THREAD_CHUNKS,
    z.object({ threadId, limit: z.number().int().positive().max(20).optional() }),
    ({ threadId: tid, limit }) => agentOSMemoryService.getThreadChunks(tid, limit)
  );

  defineHandler(IPC_CHANNELS.MEMORY_GET_PROJECT_STATS, z.object({ projectId: safeProjectId }), ({ projectId }) => {
    const stats = agentOSMemoryService.getProjectStats(projectId);
    const memoryGetCallCount = analyticsService.getProjectMemoryGetCount(projectId);
    return { ...stats, memoryGetCallCount };
  });

  defineHandler(IPC_CHANNELS.MEMORY_GET_GLOBAL_EXPANSION_COUNTS, z.object({}), () =>
    agentOSMemoryService.getGlobalExpansionCounts()
  );

  defineHandler(
    IPC_CHANNELS.MEMORY_RESET_EMBEDDINGS,
    z.object({ projectId: safeProjectId, target: z.enum(['memory', 'sessions', 'code', 'graph']) }),
    ({ projectId, target }) => agentOSMemoryService.resetEmbeddings(projectId, target)
  );

  defineHandler(
    IPC_CHANNELS.MEMORY_DELETE_DATA,
    z.object({ projectId: safeProjectId, target: z.enum(['memory', 'sessions', 'code', 'graph']) }),
    ({ projectId, target }) => agentOSMemoryService.deleteData(projectId, target)
  );
}

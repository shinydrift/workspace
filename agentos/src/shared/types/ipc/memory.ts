export interface MemoryIndexStatusEvent {
  projectId: string;
  phase: 'memory' | 'code';
  state: 'started' | 'done' | 'error';
}

export const MCP_MEMORY_GET_TOOL = 'mcp__agentos-memory__memory_get' as const;
export const MCP_MEMORY_SEARCH_TOOL = 'mcp__agentos-memory__memory_search' as const;

export const MEMORY_IPC_CHANNELS = {
  MEMORY_STATUS: 'memory:status',
  MEMORY_REINDEX: 'memory:reindex',
  MEMORY_DOCTOR: 'memory:doctor',
  MEMORY_SEARCH: 'memory:search',
  MEMORY_GET: 'memory:get',
  MEMORY_SAVE: 'memory:save',
  MEMORY_LIST: 'memory:list',
  MEMORY_DELETE_CHUNK: 'memory:deleteChunk',
  MEMORY_DELETE_FILE: 'memory:deleteFile',
  MEMORY_UPDATE_CHUNK: 'memory:updateChunk',
  MEMORY_PIN_CHUNK: 'memory:pinChunk',
  MEMORY_GRAPH_QUERY: 'memory:graphQuery',
  MEMORY_GRAPH_ALL: 'memory:graphAll',
  MEMORY_GRAPH_ALL_PAGE: 'memory:graphAllPage',
  MEMORY_GET_ENTITY_CHUNKS: 'memory:getEntityChunks',
  MEMORY_REINDEX_GRAPH: 'memory:reindexGraph',
  MEMORY_GET_DECAY_CONFIG: 'memory:getDecayConfig',
  MEMORY_SET_DECAY_CONFIG: 'memory:setDecayConfig',
  MEMORY_HEALTH_CHECK: 'memory:healthCheck',
  MEMORY_GET_THREAD_CHUNKS: 'memory:getThreadChunks',
  MEMORY_GET_PROJECT_STATS: 'memory:getProjectStats',
  MEMORY_GET_GLOBAL_EXPANSION_COUNTS: 'memory:getGlobalExpansionCounts',
  MEMORY_RESET_EMBEDDINGS: 'memory:resetEmbeddings',
  MEMORY_DELETE_DATA: 'memory:deleteData',
} as const;

export type MemorySourceFilter = 'all' | 'memory' | 'sessions' | 'code';

export interface MemorySearchHit {
  id: string;
  source: 'memory' | 'sessions';
  path: string;
  title: string;
  score: number;
  snippet: string;
  startLine?: number;
  endLine?: number;
  threadId?: string;
  timestamp?: number;
  entities?: Array<{ name: string; type: string; observations: string[] }>;
}

export interface CodeSearchHit {
  id: string;
  source: 'code';
  path: string;
  title: string;
  score: number;
  snippet: string;
  startLine?: number;
  endLine?: number;
  entities?: Array<{ name: string; type: string; observations: string[] }>;
}

export interface MemoryIndexStatus {
  projectId: string;
  cachePath: string;
  builtAt: number | null;
  hasMemoryFiles: boolean;
  hasSessionHistory: boolean;
  memoryFileCount: number;
  sessionFileCount: number;
  entryCount: number;
  sources: Array<'memory' | 'sessions'>;
  embeddingProvider?: string | null;
  embeddingModel?: string | null;
  embeddingDimensions?: number | null;
  merkle_root?: string | null;
  integrity?: boolean;
}

export interface MemoryDoctorResult {
  ok: boolean;
  issues: string[];
  checks: Array<{
    name: string;
    ok: boolean;
    detail: string;
  }>;
}

export interface MemoryEntryRecord {
  // Stable chunk id, present only for entries returned by memory_search or
  // backed by a row in the chunks table. Path-range reads omit this.
  id?: string;
  source: 'memory' | 'sessions';
  path: string;
  title: string;
  text: string;
  snippet: string;
  startLine?: number;
  endLine?: number;
  threadId?: string;
  timestamp?: number;
}

export interface MemorySearchRequest {
  threadId: string;
  query: string;
  maxResults?: number;
  minScore?: number;
  /** Restrict search to 'memory', 'sessions', or 'all' (both). 'code' is only valid for the list endpoint — code chunks are not included in search results. */
  source?: 'all' | 'memory' | 'sessions';
}

export interface MemoryGetRequest {
  threadId: string;
  entryId?: string;
  path?: string;
  skipExpansion?: boolean;
}

export interface MemorySaveRequest {
  threadId: string;
  path: string;
  content: string;
  mode?: 'overwrite' | 'append';
}

export interface ChunkRow {
  id: string;
  path: string;
  source: 'memory' | 'sessions' | 'code';
  startLine: number;
  endLine: number;
  model: string;
  text: string;
  updatedAt: number;
  pinned: boolean;
  userEdited: boolean;
}

export interface MemoryListRequest {
  threadId: string;
  source?: MemorySourceFilter;
  page: number;
  pageSize: number;
}

export interface MemoryListResult {
  chunks: ChunkRow[];
  total: number;
}

export interface MemoryGraphQueryRequest {
  threadId: string;
  entity: string;
  maxHops?: number;
  relationTypes?: Array<'related_to' | 'fixes' | 'modifies' | 'depends_on'>;
  topK?: number;
}

export interface MemoryGraphAllRequest {
  threadId: string;
  topK?: number;
}

export interface MemoryGraphAllPageRequest {
  threadId: string;
  offset: number;
  limit: number;
}

export interface MemoryGetEntityChunksRequest {
  threadId: string;
  entityId: string;
}

export interface MemoryDecayConfig {
  decayEnabled: boolean;
  decayHalfLifeDays: number;
  decayMinScore: number;
  graphEnabled: boolean;
  graphBoost: number;
}

export interface MemoryGetDecayConfigRequest {
  threadId: string;
}

export interface MemorySetDecayConfigRequest {
  threadId: string;
  config: Partial<MemoryDecayConfig>;
}

export interface MemoryHealthReport {
  staleFiles: Array<{ path: string; indexedAt: number; modifiedAt: number }>;
  unembeddedChunks: Array<{ id: string; path: string; startLine: number; endLine: number; preview: string }>;
  duplicateGroups: Array<{ hash: string; count: number; ids: string[]; samplePath: string }>;
  staleModelChunks: number;
}

export interface MemoryThreadChunk {
  chunkId: string;
  summary: string;
  updatedAt: number;
}

export interface MemoryProjectStats {
  totalChunks: number;
  memoryChunks: number;
  sessionChunks: number;
  totalExpansions: number;
  neverExpandedCount: number;
  topExpanded: Array<{ chunkId: string; label: string; path: string; expansionCount: number }>;
  recentSessionChunks: Array<{ chunkId: string; label: string; updatedAt: number }>;
  memoryGetCallCount: number;
}

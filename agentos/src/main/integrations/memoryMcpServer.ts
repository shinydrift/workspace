import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { agentOSMemoryService } from '../memory/service';
import { sanitizeToolResult } from '../mcp/sanitize';
import { BaseMcpServer } from '../mcp/BaseMcpServer';
import { getAllProjects } from '../threads/db';

class MemoryMcpServer extends BaseMcpServer {
  start(): void {
    this.startHttpServer('memory', 'AgentOS memory MCP sidecar');
  }

  stop(): void {
    this.stopHttpServer();
  }

  protected get mcpServerName(): string {
    return 'agentos-memory';
  }

  protected async registerTools(server: McpServer): Promise<void> {
    server.tool(
      'memory_search',
      'Search project memory files and persisted session history for the current AgentOS project. Does NOT search source code — call code_search in parallel for codebase context.',
      {
        query: z.string().describe('Search query.'),
        project_id: z
          .string()
          .optional()
          .describe('AgentOS project id. Prefer AGENTOS_PROJECT_ID for the current thread.'),
        thread_id: z
          .string()
          .optional()
          .describe('AgentOS thread id. Prefer AGENTOS_THREAD_ID for the current thread.'),
        max_results: z.number().int().min(1).max(25).optional().describe('Maximum number of hits to return.'),
        min_score: z.number().min(0).max(1).optional().describe('Minimum match score from 0 to 1.'),
      },
      async ({ query, project_id, thread_id, max_results, min_score }) => {
        const results = await agentOSMemoryService.search({
          query,
          projectId: project_id,
          threadId: thread_id,
          maxResults: max_results,
          minScore: min_score,
        });
        const base = sanitizeToolResult(JSON.stringify(results, null, 2));
        const text =
          results.length > 0
            ? `${base}\n\nIf any result looks relevant but the snippet is cut off, call memory_get(entry_id) to read the full chunk.`
            : base;
        return this.textResult(text);
      }
    );

    server.tool(
      'code_search',
      'Search indexed workspace source code for the current AgentOS project. Run in parallel with memory_search when both memory and codebase context are needed.',
      {
        query: z.string().describe('Search query.'),
        project_id: z
          .string()
          .optional()
          .describe('AgentOS project id. Prefer AGENTOS_PROJECT_ID for the current thread.'),
        thread_id: z
          .string()
          .optional()
          .describe('AgentOS thread id. Prefer AGENTOS_THREAD_ID for the current thread.'),
        max_results: z.number().int().min(1).max(25).optional().describe('Maximum number of hits to return.'),
        min_score: z.number().min(0).max(1).optional().describe('Minimum match score from 0 to 1.'),
      },
      async ({ query, project_id, thread_id, max_results, min_score }) => {
        const results = await agentOSMemoryService.searchCode({
          query,
          projectId: project_id,
          threadId: thread_id,
          maxResults: max_results,
          minScore: min_score,
        });
        const base = sanitizeToolResult(JSON.stringify(results, null, 2));
        const text =
          results.length > 0
            ? `${base}\n\nIf any result looks relevant but the snippet is cut off, call memory_get(entry_id) to read the full chunk.`
            : base;
        return this.textResult(text);
      }
    );

    server.tool(
      'memory_get',
      'Read a specific memory entry or project memory file from AgentOS memory.',
      {
        entry_id: z.string().optional().describe('Chunk id returned by memory_search.'),
        path: z.string().optional().describe('Project memory path such as MEMORY.md or memory/conventions.md.'),
        project_id: z
          .string()
          .optional()
          .describe('AgentOS project id. Prefer AGENTOS_PROJECT_ID for the current thread.'),
        thread_id: z
          .string()
          .optional()
          .describe('AgentOS thread id. Prefer AGENTOS_THREAD_ID for the current thread.'),
      },
      async ({ entry_id, path, project_id, thread_id }) => {
        const result = await agentOSMemoryService.get({
          entryId: entry_id,
          path,
          projectId: project_id,
          threadId: thread_id,
        });
        if (!result) {
          return this.errorResult('No matching memory entry found.');
        }
        return this.jsonResult(result);
      }
    );

    server.tool(
      'memory_status',
      'Inspect AgentOS memory coverage and cache status for the current project.',
      {
        project_id: z
          .string()
          .optional()
          .describe('AgentOS project id. Prefer AGENTOS_PROJECT_ID for the current thread.'),
        thread_id: z
          .string()
          .optional()
          .describe('AgentOS thread id. Prefer AGENTOS_THREAD_ID for the current thread.'),
        force_reindex: z.boolean().optional().describe('Rebuild the index before returning status.'),
      },
      async ({ project_id, thread_id, force_reindex }) => {
        const status = force_reindex
          ? await agentOSMemoryService.reindex(project_id, thread_id)
          : await agentOSMemoryService.status(project_id, thread_id);
        return this.jsonResult(status);
      }
    );

    server.tool(
      'memory_save',
      'Create or update persistent project memory files for the current AgentOS project.',
      {
        path: z
          .string()
          .describe(
            'Target path relative to the project memory namespace, for example MEMORY.md or memory/architecture.md.'
          ),
        content: z.string().describe('Content to save.'),
        mode: z.enum(['overwrite', 'append']).optional().describe('Overwrite the file or append a new note block.'),
        project_id: z
          .string()
          .optional()
          .describe('AgentOS project id. Prefer AGENTOS_PROJECT_ID for the current thread.'),
        thread_id: z
          .string()
          .optional()
          .describe('AgentOS thread id. Prefer AGENTOS_THREAD_ID for the current thread.'),
      },
      async ({ path, content, mode, project_id, thread_id }) => {
        const saved = await agentOSMemoryService.save({
          path,
          content,
          mode,
          projectId: project_id,
          threadId: thread_id,
        });
        return this.jsonResult(saved);
      }
    );

    server.tool(
      'memory_graph_query',
      'Traverse the knowledge graph for a named entity (file, symbol, issue, or decision) and return connected nodes and edges.',
      {
        entity: z.string().describe('Entity name to query (e.g. "auth.ts", "AgentOSMemoryService", "#123").'),
        project_id: z
          .string()
          .optional()
          .describe('AgentOS project id. Prefer AGENTOS_PROJECT_ID for the current thread.'),
        thread_id: z
          .string()
          .optional()
          .describe('AgentOS thread id. Prefer AGENTOS_THREAD_ID for the current thread.'),
        max_hops: z.number().int().min(1).max(4).optional().describe('Maximum graph traversal depth (default 2).'),
        relation_types: z
          .array(z.enum(['related_to', 'fixes', 'modifies', 'depends_on']))
          .optional()
          .describe('Filter edges by relation type.'),
        top_k: z.number().int().min(1).max(200).optional().describe('Maximum number of nodes to return.'),
      },
      async ({ entity, project_id, thread_id, max_hops, relation_types, top_k }) => {
        const result = await agentOSMemoryService.graphQuery(project_id, thread_id, entity, {
          maxHops: max_hops,
          relationTypes: relation_types as import('../memory/graph').EdgeRelation[] | undefined,
          topK: top_k,
        });
        return this.jsonResult(result);
      }
    );

    server.tool(
      'memory_save_chunk',
      'Save a distilled chunk from the current session directly to the memory index with embeddings. Use for decisions made, bugs fixed, code produced, user preferences. Pass chunk_id to upsert an existing chunk in place (prevents stale duplicates). Returns a chunk_id that can be passed to memory_delete if the chunk later becomes stale.',
      {
        summary: z.string().describe('One-sentence description of the chunk content.'),
        text: z.string().max(1400).describe('Distilled prose. No raw conversation or speaker labels.'),
        chunk_id: z
          .string()
          .optional()
          .describe(
            'Stable per-topic chunk id for upsert. When provided, the chunk is updated in place instead of creating a new one. Use session:{thread_id}:{topic-slug} (e.g. session:{thread_id}:decisions, session:{thread_id}:bugs-fixed). All chunks sharing the same {thread_id} prefix belong to the same session and can be queried together.'
          ),
        project_id: z
          .string()
          .optional()
          .describe('AgentOS project id. Prefer AGENTOS_PROJECT_ID for the current thread.'),
        thread_id: z
          .string()
          .optional()
          .describe('AgentOS thread id. Prefer AGENTOS_THREAD_ID for the current thread.'),
      },
      async ({ summary, text, chunk_id, project_id, thread_id }) => {
        const result = await agentOSMemoryService.saveChunk({
          summary,
          text,
          chunkId: chunk_id,
          projectId: project_id,
          threadId: thread_id,
        });
        const instruction = [
          `chunk_id: ${result.chunkId}`,
          ``,
          `Now call memory_link with entities and edges you can identify from this chunk.`,
          `Pass chunk_id="${result.chunkId}"${project_id ? ` and project_id="${project_id}"` : ''}.`,
          `Entity types: file (paths), symbol (function/class names), issue (#N or PR #N), decision (short phrase), person, concept.`,
          `Edge relations: fixes, modifies, depends_on, related_to.`,
          `For each entity, add an observation: one factual sentence (max 400 chars) describing what this chunk says about it.`,
          `Skip memory_link entirely if the chunk has no meaningful entities.`,
        ].join('\n');
        return this.textResult(instruction);
      }
    );

    server.tool(
      'memory_link',
      'Assert entities and relationships into the project knowledge graph. Call after memory_save_chunk to register which files, symbols, or issues were involved in the saved work.',
      {
        entities: z
          .array(
            z.object({
              name: z.string(),
              type: z.enum(['file', 'symbol', 'issue', 'decision', 'person', 'concept']),
              observation: z
                .string()
                .max(400)
                .optional()
                .describe('One factual sentence about this entity from the chunk (max 400 chars).'),
            })
          )
          .optional()
          .describe(
            'Entities to register. files: paths like auth.ts. symbols: function/class names. issues: #123. decisions: short phrase. Include observation when you can describe a concrete fact.'
          ),
        edges: z
          .array(
            z.object({
              from: z.string().describe('Entity name'),
              to: z.string().describe('Entity name'),
              relation: z.enum(['related_to', 'fixes', 'modifies', 'depends_on']),
            })
          )
          .optional()
          .describe('Directed relationships between entity names.'),
        chunk_id: z.string().optional().describe('chunk_id from memory_save_chunk to associate these entities with.'),
        project_id: z
          .string()
          .optional()
          .describe('AgentOS project id. Prefer AGENTOS_PROJECT_ID for the current thread.'),
        thread_id: z
          .string()
          .optional()
          .describe('AgentOS thread id. Prefer AGENTOS_THREAD_ID for the current thread.'),
      },
      async ({ entities, edges, chunk_id, project_id, thread_id }) => {
        agentOSMemoryService.linkEntities({
          entities,
          edges,
          chunkId: chunk_id,
          projectId: project_id,
          threadId: thread_id,
        });
        return this.jsonResult({ ok: true }, { sanitize: false });
      }
    );

    server.tool(
      'memory_add_observation',
      'Add a factual observation to an existing or new entity in the knowledge graph.',
      {
        entity_name: z.string().describe('Entity name (e.g. "auth.ts", "AgentOSMemoryService", "#123").'),
        entity_type: z.enum(['file', 'symbol', 'issue', 'decision', 'person', 'concept']).describe('Entity type.'),
        observation: z.string().max(400).describe('One factual sentence about this entity (max 400 chars).'),
        source_chunk_id: z.string().optional().describe('chunk_id that produced this observation.'),
        project_id: z
          .string()
          .optional()
          .describe('AgentOS project id. Prefer AGENTOS_PROJECT_ID for the current thread.'),
        thread_id: z
          .string()
          .optional()
          .describe('AgentOS thread id. Prefer AGENTOS_THREAD_ID for the current thread.'),
      },
      async ({ entity_name, entity_type, observation, source_chunk_id, project_id, thread_id }) => {
        agentOSMemoryService.addObservation({
          entityName: entity_name,
          entityType: entity_type,
          observation,
          sourceChunkId: source_chunk_id,
          projectId: project_id,
          threadId: thread_id,
        });
        return this.jsonResult({ ok: true }, { sanitize: false });
      }
    );

    server.tool(
      'memory_delete',
      'Delete a specific memory chunk by id. Use memory_search to find the id first.',
      {
        entry_id: z.string().describe('Chunk id returned by memory_search.'),
        project_id: z
          .string()
          .optional()
          .describe('AgentOS project id. Prefer AGENTOS_PROJECT_ID for the current thread.'),
        thread_id: z
          .string()
          .optional()
          .describe('AgentOS thread id. Prefer AGENTOS_THREAD_ID for the current thread.'),
      },
      async ({ entry_id, project_id, thread_id }) => {
        agentOSMemoryService.deleteChunk({ projectId: project_id, threadId: thread_id, chunkId: entry_id });
        return this.jsonResult({ deleted: entry_id }, { sanitize: false });
      }
    );

    server.tool(
      'memory_pin',
      'Pin or unpin a memory chunk so it ranks higher (or lower) in search results.',
      {
        entry_id: z.string().describe('Chunk id returned by memory_search.'),
        pinned: z.boolean().describe('true to pin, false to unpin.'),
        project_id: z
          .string()
          .optional()
          .describe('AgentOS project id. Prefer AGENTOS_PROJECT_ID for the current thread.'),
        thread_id: z
          .string()
          .optional()
          .describe('AgentOS thread id. Prefer AGENTOS_THREAD_ID for the current thread.'),
      },
      async ({ entry_id, pinned, project_id, thread_id }) => {
        agentOSMemoryService.pinChunk({ projectId: project_id, threadId: thread_id, chunkId: entry_id, pinned });
        return this.jsonResult({ pinned, chunkId: entry_id }, { sanitize: false });
      }
    );

    server.tool(
      'memory_list_projects',
      'List all AgentOS projects with their IDs, names, and workspace paths.',
      {},
      async () =>
        this.jsonResult(
          getAllProjects().map((p) => ({ id: p.id, name: p.name, path: p.path })),
          { sanitize: false }
        )
    );
  }
}

export const memoryMcpServer = new MemoryMcpServer();

import type { MemorySearchHit, ToolCallInvocation } from '../../../shared/types';
import { MCP_MEMORY_GET_TOOL, MCP_MEMORY_SEARCH_TOOL } from '../../../shared/types';

const MAX_SNIPPETS_PER_ENTRY = 5;

export interface RecallEntry {
  path: string;
  source: 'memory' | 'sessions' | null;
  maxScore: number;
  chunkCount: number;
  snippets: string[];
}

export interface SearchGroup {
  query: string;
  entries: RecallEntry[];
}

export interface GetCallEntry {
  target: string;
  hit: boolean;
}

export interface MemoryRecallResult {
  groups: SearchGroup[];
  searchCount: number;
  searchesWithResults: number;
  searchesWithoutResults: number;
  avgMaxScore: number | null;
  getCalls: GetCallEntry[];
}

export const EMPTY_MEMORY_RECALL: MemoryRecallResult = {
  groups: [],
  searchCount: 0,
  searchesWithResults: 0,
  searchesWithoutResults: 0,
  avgMaxScore: null,
  getCalls: [],
};

function extractLeadingJsonArray(text: string): unknown[] | null {
  const start = text.indexOf('[');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) {
      try {
        const parsed = JSON.parse(text.slice(start, i + 1));
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
  }

  return null;
}

function parseHits(response: string): MemorySearchHit[] {
  const parseTextBlock = (text: string): MemorySearchHit[] | null => {
    let inner: unknown;
    try {
      inner = JSON.parse(text);
    } catch {
      inner = extractLeadingJsonArray(text);
    }
    return Array.isArray(inner) ? (inner as MemorySearchHit[]) : null;
  };

  try {
    const parsed = JSON.parse(response);
    let contentArray: unknown;
    if (Array.isArray(parsed)) {
      contentArray = parsed;
    } else if (parsed && Array.isArray((parsed as Record<string, unknown>).content)) {
      contentArray = (parsed as Record<string, unknown>).content;
    } else {
      return [];
    }

    const items = contentArray as unknown[];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const block = item as Record<string, unknown>;
      if (typeof block.type !== 'string' || typeof block.text !== 'string') continue;
      const hits = parseTextBlock(block.text);
      if (hits) return hits;
    }

    return items as MemorySearchHit[];
  } catch {
    return [];
  }
}

function hitsToEntries(hits: MemorySearchHit[]): RecallEntry[] {
  const byPath = new Map<string, RecallEntry>();

  for (const hit of hits) {
    if (typeof hit.path !== 'string' || typeof hit.score !== 'number') continue;
    const existing = byPath.get(hit.path);
    if (existing) {
      existing.maxScore = Math.max(existing.maxScore, hit.score);
      existing.chunkCount += 1;
      if (hit.snippet && existing.snippets.length < MAX_SNIPPETS_PER_ENTRY) {
        existing.snippets.push(hit.snippet);
      }
      continue;
    }

    byPath.set(hit.path, {
      path: hit.path,
      source: hit.source === 'memory' || hit.source === 'sessions' ? hit.source : null,
      maxScore: hit.score,
      chunkCount: 1,
      snippets: hit.snippet ? [hit.snippet] : [],
    });
  }

  return Array.from(byPath.values()).sort((a, b) => b.maxScore - a.maxScore);
}

export function countMemoryRecall(invocations: ToolCallInvocation[]) {
  let searchCount = 0;
  let getCount = 0;

  for (const invocation of invocations) {
    if (invocation.name === MCP_MEMORY_SEARCH_TOOL) searchCount++;
    else if (invocation.name === MCP_MEMORY_GET_TOOL) getCount++;
  }

  return { getCount, searchCount };
}

export function parseMemoryRecall(toolInvocations: ToolCallInvocation[]): MemoryRecallResult {
  const groups: SearchGroup[] = [];
  const getCalls: GetCallEntry[] = [];

  for (const invocation of toolInvocations) {
    if (invocation.name === MCP_MEMORY_SEARCH_TOOL) {
      const input = invocation.input as Record<string, unknown> | null | undefined;
      const query = typeof input?.query === 'string' ? input.query : '(unknown query)';
      groups.push({ query, entries: hitsToEntries(parseHits(invocation.response)) });
      continue;
    }

    if (invocation.name === MCP_MEMORY_GET_TOOL) {
      const input = invocation.input as Record<string, unknown> | null | undefined;
      const target =
        typeof input?.entry_id === 'string'
          ? input.entry_id
          : typeof input?.path === 'string'
            ? input.path
            : '(unknown)';
      getCalls.push({
        target,
        hit: !invocation.isError && !invocation.response.includes('No matching memory entry found'),
      });
    }
  }

  let searchesWithResults = 0;
  let searchesWithoutResults = 0;
  let scoreSum = 0;
  let scoreCount = 0;

  for (const group of groups) {
    if (group.entries.length === 0) {
      searchesWithoutResults += 1;
      continue;
    }

    searchesWithResults += 1;
    for (const entry of group.entries) {
      scoreSum += entry.maxScore;
      scoreCount += 1;
    }
  }

  return {
    groups,
    searchCount: groups.length,
    searchesWithResults,
    searchesWithoutResults,
    avgMaxScore: scoreCount > 0 ? scoreSum / scoreCount : null,
    getCalls,
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';

function collectAssistantMetrics(results, memoryGetToolName) {
  const toolUseIdToName = new Map();
  const toolStats = new Map();
  let memoryGetCallCount = 0;
  let assistantResultCount = 0;

  for (const result of results) {
    if (!result.content && result.normalized.blocks.length === 0) continue;
    assistantResultCount++;
    for (const block of result.normalized.blocks) {
      if (block.type === 'tool_use') {
        toolUseIdToName.set(block.id, block.name);
        const existing = toolStats.get(block.name) ?? {
          name: block.name,
          count: 0,
          successCount: 0,
          errorCount: 0,
        };
        existing.count++;
        toolStats.set(block.name, existing);
        if (block.name === memoryGetToolName) memoryGetCallCount++;
      } else if (block.type === 'tool_result') {
        const toolName = toolUseIdToName.get(block.toolUseId);
        if (!toolName) continue;
        const existing = toolStats.get(toolName);
        if (!existing) continue;
        if (block.isError) existing.errorCount++;
        else existing.successCount++;
      }
    }
  }

  return {
    assistantResultCount,
    memoryGetCallCount,
    toolStats: [...toolStats.values()],
  };
}

test('collectAssistantMetrics pairs tool_use and tool_result across multiple normalized results', () => {
  const results = [
    {
      content: '',
      normalized: {
        blocks: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { path: '/tmp/a' } }],
      },
    },
    {
      content: '',
      normalized: {
        blocks: [{ type: 'tool_result', toolUseId: 'tool-1', content: 'ok', isError: false }],
      },
    },
  ];

  const metrics = collectAssistantMetrics(results, 'mcp__agentos-memory__memory_get');
  assert.equal(metrics.assistantResultCount, 2);
  assert.equal(metrics.memoryGetCallCount, 0);
  assert.deepEqual(metrics.toolStats, [{ name: 'Read', count: 1, successCount: 1, errorCount: 0 }]);
});

test('collectAssistantMetrics counts memory_get tool uses across multiple normalized results', () => {
  const results = [
    {
      content: '',
      normalized: {
        blocks: [{ type: 'tool_use', id: 'tool-1', name: 'mcp__agentos-memory__memory_get', input: {} }],
      },
    },
    {
      content: '',
      normalized: {
        blocks: [{ type: 'tool_result', toolUseId: 'tool-1', content: 'hit', isError: false }],
      },
    },
  ];

  const metrics = collectAssistantMetrics(results, 'mcp__agentos-memory__memory_get');
  assert.equal(metrics.assistantResultCount, 2);
  assert.equal(metrics.memoryGetCallCount, 1);
  assert.deepEqual(metrics.toolStats, [
    { name: 'mcp__agentos-memory__memory_get', count: 1, successCount: 1, errorCount: 0 },
  ]);
});

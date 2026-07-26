import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReasoningArgs } from '../../../src/main/utils/providerConfig';

test('Codex reasoning is passed through its config override', () => {
  assert.deepEqual(buildReasoningArgs('none'), ['-c', 'model_reasoning_effort="none"']);
  assert.deepEqual(buildReasoningArgs('xhigh'), ['-c', 'model_reasoning_effort="xhigh"']);
  assert.deepEqual(buildReasoningArgs('max'), ['-c', 'model_reasoning_effort="max"']);
  assert.deepEqual(buildReasoningArgs(undefined), []);
});

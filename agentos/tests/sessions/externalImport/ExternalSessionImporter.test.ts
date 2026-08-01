import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ExternalSessionImporter } from '../../../src/main/sessions/externalImport/ExternalSessionImporter';
import type { CreateThreadRequest, Thread } from '../../../src/shared/types';

test('reconcile re-checks ownership before adopting a scanned session', async (t) => {
  const claudeDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-external-import-'));
  t.after(() => fs.rmSync(claudeDataDir, { recursive: true, force: true }));

  const sessionId = '11111111-1111-4111-8111-111111111111';
  const projectDir = path.join(claudeDataDir, 'projects', '-workspace');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, `${sessionId}.jsonl`), '{}\n');

  let ownershipChecks = 0;
  let createCalls = 0;
  const importer = new ExternalSessionImporter({
    claudeDataDir,
    isEnabled: () => true,
    // The scan snapshot does not know the ID yet; AgentOS claims it before adoption.
    listKnownClaudeSessionIds: () => {
      ownershipChecks += 1;
      return ownershipChecks === 1 ? new Set() : new Set([sessionId]);
    },
    matchProjectPath: () => '/workspace',
    createThread: async (_req: CreateThreadRequest) => {
      createCalls += 1;
      return {} as Thread;
    },
    bindClaudeSession: () => undefined,
    appendImportedMessage: () => undefined,
    setImportOffset: () => undefined,
    getImportState: () => null,
    isThreadRunning: () => false,
    distill: async () => undefined,
    onTurnStarted: () => () => undefined,
    onTurnEnded: () => () => undefined,
  });

  await (
    importer as unknown as {
      reconcile: (maxAgeMs: number) => Promise<void>;
    }
  ).reconcile(60_000);

  assert.equal(ownershipChecks, 2);
  assert.equal(createCalls, 0);
});

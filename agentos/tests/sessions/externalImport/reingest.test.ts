import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ExternalSessionImporter } from '../../../src/main/sessions/externalImport/ExternalSessionImporter';
import type { CreateThreadRequest, Thread } from '../../../src/shared/types';

const USER = (text: string) => JSON.stringify({ type: 'user', message: { content: text }, cwd: '/workspace' });
const ASSISTANT = (id: string) =>
  JSON.stringify({
    type: 'assistant',
    message: {
      id,
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 5, output_tokens: 3 },
    },
  });

function makeHarness() {
  const claudeDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-reingest-'));
  const sessionId = '22222222-2222-4222-8222-222222222222';
  const jsonlPath = path.join(claudeDataDir, 'projects', '-workspace', `${sessionId}.jsonl`);
  fs.mkdirSync(path.dirname(jsonlPath), { recursive: true });
  fs.writeFileSync(jsonlPath, USER('first') + '\n' + ASSISTANT('m1') + '\n');

  const threadId = 'thread-1';
  const known = new Set<string>();
  const sessionToThread = new Map<string, string>();
  const offsets = new Map<string, number>();
  const appended: { role: string; text: string }[] = [];

  const importer = new ExternalSessionImporter({
    claudeDataDir,
    isEnabled: () => true,
    listKnownClaudeSessionIds: () => new Set(known),
    matchProjectPath: () => '/workspace',
    createThread: async (_req: CreateThreadRequest) => ({ id: threadId }) as Thread,
    bindClaudeSession: (tid, sid) => {
      known.add(sid);
      sessionToThread.set(sid, tid);
    },
    appendImportedMessage: (_tid, role, text) => appended.push({ role, text }),
    setImportOffset: (tid, offset) => offsets.set(tid, offset),
    getImportState: (sid) => {
      const tid = sessionToThread.get(sid);
      if (!tid || !offsets.has(tid)) return null;
      return { threadId: tid, offset: offsets.get(tid)! };
    },
    isThreadRunning: () => false,
    distill: async () => undefined,
    onTurnStarted: () => () => undefined,
    onTurnEnded: () => () => undefined,
  });

  return { importer, claudeDataDir, jsonlPath, threadId, offsets, appended };
}

const reconcile = (importer: ExternalSessionImporter) =>
  (importer as unknown as { reconcile: (maxAgeMs: number) => Promise<void> }).reconcile(60_000);
const stopMirror = (importer: ExternalSessionImporter, threadId: string) =>
  (importer as unknown as { stopMirror: (id: string) => void }).stopMirror(threadId);

test('re-ingests only the appended delta after an imported session grows', async (t) => {
  const h = makeHarness();
  t.after(() => {
    h.importer.dispose();
    fs.rmSync(h.claudeDataDir, { recursive: true, force: true });
  });

  // Initial adoption ingests the snapshot and records the offset at end-of-file.
  await reconcile(h.importer);
  const firstOffset = h.offsets.get(h.threadId)!;
  assert.equal(firstOffset, fs.statSync(h.jsonlPath).size);
  assert.ok(
    h.appended.some((m) => m.role === 'user' && m.text === 'first'),
    'initial user turn should be imported'
  );

  // The live mirror stays attached for 15s after adoption; simulate it settling so the re-ingest
  // path (not the still-open mirror) is what picks up the next append.
  stopMirror(h.importer, h.threadId);

  // The external session resumes and appends a new turn.
  fs.appendFileSync(h.jsonlPath, USER('second') + '\n' + ASSISTANT('m2') + '\n');

  const before = h.appended.length;
  await reconcile(h.importer);

  const delta = h.appended.slice(before);
  assert.ok(
    delta.some((m) => m.role === 'user' && m.text === 'second'),
    'the appended turn should be re-ingested'
  );
  assert.ok(!delta.some((m) => m.role === 'user' && m.text === 'first'), 'the original turn must not be re-imported');
  assert.equal(h.offsets.get(h.threadId), fs.statSync(h.jsonlPath).size);
});

test('does not re-ingest when the file has not grown', async (t) => {
  const h = makeHarness();
  t.after(() => {
    h.importer.dispose();
    fs.rmSync(h.claudeDataDir, { recursive: true, force: true });
  });

  await reconcile(h.importer);
  stopMirror(h.importer, h.threadId);

  const before = h.appended.length;
  await reconcile(h.importer);
  assert.equal(h.appended.length, before, 'nothing new to ingest');
});

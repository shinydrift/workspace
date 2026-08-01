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
  let running = false;

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
    getImportStates: () => {
      const map = new Map<string, { threadId: string; offset: number }>();
      for (const [sid, tid] of sessionToThread) {
        if (offsets.has(tid)) map.set(sid, { threadId: tid, offset: offsets.get(tid)! });
      }
      return map;
    },
    isThreadRunning: () => running,
    distill: async () => undefined,
    onTurnStarted: () => () => undefined,
    onTurnEnded: () => () => undefined,
  });

  return {
    importer,
    claudeDataDir,
    jsonlPath,
    threadId,
    offsets,
    appended,
    setRunning: (v: boolean) => (running = v),
  };
}

const reconcile = (importer: ExternalSessionImporter) =>
  (importer as unknown as { reconcile: (maxAgeMs: number) => Promise<void> }).reconcile(60_000);
const stopMirror = (importer: ExternalSessionImporter, threadId: string) =>
  (importer as unknown as { stopMirror: (id: string) => void }).stopMirror(threadId);
// start() wires onTurnEnded → markAgentWritesIngested; call the handler directly here.
const fireTurnEnded = (importer: ExternalSessionImporter, threadId: string) =>
  (importer as unknown as { markAgentWritesIngested: (id: string) => void }).markAgentWritesIngested(threadId);

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

test('does not re-ingest while an in-app turn is running on the thread', async (t) => {
  const h = makeHarness();
  t.after(() => {
    h.importer.dispose();
    fs.rmSync(h.claudeDataDir, { recursive: true, force: true });
  });

  await reconcile(h.importer);
  stopMirror(h.importer, h.threadId);
  fs.appendFileSync(h.jsonlPath, USER('during-turn') + '\n' + ASSISTANT('m2') + '\n');

  // While a turn runs, the in-app pipeline owns transcript writes — re-ingestion must stand down.
  h.setRunning(true);
  let before = h.appended.length;
  await reconcile(h.importer);
  assert.equal(h.appended.length, before, 'must not re-ingest while running');

  // Once the turn is done, the delta flows in again.
  h.setRunning(false);
  before = h.appended.length;
  await reconcile(h.importer);
  assert.ok(
    h.appended.slice(before).some((m) => m.text === 'during-turn'),
    'delta re-ingests after the turn ends'
  );
});

test('turn:ended advances the offset past agent-written bytes so they are not re-ingested', async (t) => {
  const h = makeHarness();
  t.after(() => {
    h.importer.dispose();
    fs.rmSync(h.claudeDataDir, { recursive: true, force: true });
  });

  await reconcile(h.importer);
  stopMirror(h.importer, h.threadId);

  // An in-app turn (a /save-session-chunk distill, or a user takeover) appends its own messages to
  // the same transcript. turn:ended must mark those bytes ingested so they are never re-imported.
  fs.appendFileSync(h.jsonlPath, USER('agent-write') + '\n' + ASSISTANT('m2') + '\n');
  fireTurnEnded(h.importer, h.threadId);
  assert.equal(h.offsets.get(h.threadId), fs.statSync(h.jsonlPath).size, 'offset jumps to end of file');

  const before = h.appended.length;
  await reconcile(h.importer);
  assert.equal(h.appended.length, before, 'agent-written bytes must not be re-ingested');
});

/**
 * Tests for src/main/audio/worker/whisperEngine.ts
 *
 * The engine owns the native WhisperContext (previously inline in audioService).
 * External dependencies are mocked via Module._load:
 *   - @fugood/whisper.node  (initWhisper → WhisperContext)
 *   - fs                    (existsSync stubbed so the model looks present on disk)
 *
 * Covers: transcribeBuffer (write WAV → transcribeFile → trim → cleanup),
 * whitespace-only handling, context reuse across calls, and model-switch reload.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import realFs from 'node:fs';

// ── @fugood/whisper.node mock ─────────────────────────────────────────────────

let transcribeResult = 'transcribed text';
let initWhisperCalls = 0;
let transcribeFileCalls = 0;
let releaseCalls = 0;

const mockCtx = {
  transcribeFile: (_file: string, opts: { onNewSegments?: (r: { result: string }) => void }) => {
    transcribeFileCalls++;
    opts.onNewSegments?.({ result: transcribeResult });
    return { promise: Promise.resolve({ result: transcribeResult }) };
  },
  release: () => {
    releaseCalls++;
  },
};

// ── fs mock — real fs, but existsSync stubbed so the model looks present ───────

const MODEL_PATH_MARKER = 'whisper-models';
const mockedFs = {
  ...realFs,
  existsSync: (p: string) => {
    if (typeof p === 'string' && p.includes(MODEL_PATH_MARKER)) return true;
    return realFs.existsSync(p);
  },
};

// ── Module._load intercept ────────────────────────────────────────────────────

const origLoad = Module._load as (req: string, parent: unknown, isMain: boolean) => unknown;
(Module._load as unknown) = function (request: string, parent: unknown, isMain: boolean) {
  if (request === '@fugood/whisper.node') {
    return {
      initWhisper: async (_opts: unknown) => {
        initWhisperCalls++;
        return mockCtx;
      },
    };
  }
  if (request === 'fs') return mockedFs;
  return origLoad.call(this, request, parent, isMain);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { WhisperEngine } = require('../../../src/main/audio/worker/whisperEngine') as {
  WhisperEngine: new (
    userDataPath: string,
    hooks: unknown
  ) => {
    transcribeBuffer: (audio: Buffer, model: string) => Promise<string>;
    transcribeFromFile: (filePath: string, model: string) => Promise<string>;
    release: () => void;
  };
};

(Module._load as unknown) = origLoad;

const noopHooks = {
  onDownloadProgress: () => {},
  onSegment: () => {},
  onLog: () => {},
};

function makeEngine() {
  return new WhisperEngine('/tmp/test-userdata-whisperengine', noopHooks);
}

// ── transcribeBuffer ──────────────────────────────────────────────────────────

test('transcribeBuffer: calls transcribeFile and returns trimmed result', async () => {
  transcribeResult = '  hello world  ';
  transcribeFileCalls = 0;
  const result = await makeEngine().transcribeBuffer(Buffer.from('fake-wav-data'), 'base.en');
  assert.ok(transcribeFileCalls >= 1, 'transcribeFile should have been called');
  assert.strictEqual(result, 'hello world');
});

test('transcribeBuffer: returns empty string when result is whitespace-only', async () => {
  transcribeResult = '   ';
  const result = await makeEngine().transcribeBuffer(Buffer.from('silence'), 'base.en');
  assert.strictEqual(result, '');
});

test('transcribeBuffer: reuses STT context across calls (persistent context)', async () => {
  const engine = makeEngine();
  initWhisperCalls = 0;
  transcribeResult = 'first';
  await engine.transcribeBuffer(Buffer.from('a'), 'base.en');
  transcribeResult = 'second';
  await engine.transcribeBuffer(Buffer.from('b'), 'base.en');
  assert.strictEqual(initWhisperCalls, 1, 'initWhisper should only be called once for two transcriptions');
});

test('transcribeBuffer: reloads context when the model changes', async () => {
  const engine = makeEngine();
  initWhisperCalls = 0;
  releaseCalls = 0;
  transcribeResult = 'a';
  await engine.transcribeBuffer(Buffer.from('a'), 'base.en');
  await engine.transcribeBuffer(Buffer.from('b'), 'small.en');
  assert.strictEqual(initWhisperCalls, 2, 'switching model should re-init the context');
  assert.strictEqual(releaseCalls, 1, 'previous context should be released on model switch');
});

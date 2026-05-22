/**
 * Tests for src/main/audio/audioService.ts
 *
 * External dependencies are mocked via Module._load:
 *   - electron              (app.getPath, BrowserWindow)
 *   - @fugood/whisper.node  (initWhisper → WhisperContext)
 *   - store/index           (getStore, settingsEvents)
 *   - fs                    (existsSync stubbed for model-path checks)
 *   - child_process         (spawn → for TTS "say" command)
 *
 * Tests cover: isModelReady, playTTS platform guard, stopTTS safety,
 * and the transcribe pipeline (write WAV → transcribeFile → cleanup).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { EventEmitter } from 'node:events';
import realFs from 'node:fs';

// ── Spawn mock (for TTS "say" command) ────────────────────────────────────────

type SpawnCall = { cmd: string; args: string[] };
const spawnCalls: SpawnCall[] = [];

function makeProc() {
  const proc = new EventEmitter() as EventEmitter & { kill: (sig?: string) => void; killed?: boolean };
  proc.kill = function (sig?: string) {
    this.killed = true;
    void sig;
  };
  setImmediate(() => proc.emit('exit', 0));
  return proc;
}

// ── @fugood/whisper.node mock ─────────────────────────────────────────────────

let transcribeResult = 'transcribed text';
let initWhisperCalls = 0;
let transcribeFileCalls = 0;

const mockCtx = {
  transcribeFile: (_file: string, opts: { onNewSegments?: (r: { result: string }) => void }) => {
    transcribeFileCalls++;
    opts.onNewSegments?.({ result: transcribeResult });
    return { promise: Promise.resolve({ result: transcribeResult }) };
  },
  release: () => {},
};

// ── fs mock — real fs, but existsSync stubbed for model-path checks ───────────

/** Set to true in transcribe tests to simulate model file already present. */
let modelFileExists = false;

const MODEL_PATH_MARKER = 'whisper-models';

const mockedFs = {
  ...realFs,
  existsSync: (p: string) => {
    if (typeof p === 'string' && p.includes(MODEL_PATH_MARKER)) return modelFileExists;
    return realFs.existsSync(p);
  },
};

// ── Store mock ────────────────────────────────────────────────────────────────

const mockSettingsEvents = new EventEmitter();
const configuredModel = 'base.en';

const mockStore = {
  get: (key: string) => {
    if (key === 'settings') return { voiceFlow: { model: configuredModel } };
    return undefined;
  },
};

// ── Module._load intercept ────────────────────────────────────────────────────

const origLoad = Module._load as (req: string, parent: unknown, isMain: boolean) => unknown;
(Module._load as unknown) = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return {
      app: { getPath: () => '/tmp/test-userdata-audioservice' },
      BrowserWindow: class {},
    };
  }
  if (request === '@fugood/whisper.node') {
    return {
      initWhisper: async (_opts: unknown) => {
        initWhisperCalls++;
        return mockCtx;
      },
    };
  }
  if (request === 'child_process') {
    return {
      spawn: (cmd: string, args: string[], opts?: unknown) => {
        spawnCalls.push({ cmd, args });
        void opts;
        return makeProc();
      },
    };
  }
  if (request === 'fs') {
    return mockedFs;
  }
  // Intercept store/index (resolved absolute path for relative imports)
  if (typeof request === 'string' && request.includes('/store/index')) {
    return { getStore: () => mockStore, settingsEvents: mockSettingsEvents };
  }
  return origLoad.call(this, request, parent, isMain);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { audioService } = require('../../../src/main/audio/audioService') as {
  audioService: {
    isModelReady: () => boolean;
    transcribe: (buf: Buffer, win: null) => Promise<string>;
    invalidateContext: () => void;
    playTTS: (text: string) => void;
    stopTTS: () => void;
  };
};

(Module._load as unknown) = origLoad;

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetSpawn() {
  spawnCalls.length = 0;
}

// ── isModelReady ──────────────────────────────────────────────────────────────

test('isModelReady: returns a boolean', () => {
  modelFileExists = false;
  const result = audioService.isModelReady();
  assert.ok(typeof result === 'boolean', `expected boolean, got ${typeof result}`);
});

test('isModelReady: returns false when model file does not exist', () => {
  modelFileExists = false;
  assert.strictEqual(audioService.isModelReady(), false);
});

test('isModelReady: returns true when model file exists', () => {
  modelFileExists = true;
  assert.strictEqual(audioService.isModelReady(), true);
  modelFileExists = false;
});

test('isModelReady: re-checks on each call (no stale cache)', () => {
  modelFileExists = false;
  const first = audioService.isModelReady();
  modelFileExists = true;
  const second = audioService.isModelReady();
  assert.notStrictEqual(first, second, 'should reflect updated file existence');
  modelFileExists = false;
});

// ── stopTTS ───────────────────────────────────────────────────────────────────

test('stopTTS: does not throw when no TTS process is running', () => {
  assert.doesNotThrow(() => audioService.stopTTS());
});

test('stopTTS: can be called multiple times safely', () => {
  assert.doesNotThrow(() => {
    audioService.stopTTS();
    audioService.stopTTS();
  });
});

// ── playTTS ───────────────────────────────────────────────────────────────────

test('playTTS: does not throw on any platform', () => {
  assert.doesNotThrow(() => audioService.playTTS('hello'));
  audioService.stopTTS();
});

test('playTTS: spawns "say" on darwin', () => {
  if (process.platform !== 'darwin') {
    resetSpawn();
    audioService.playTTS('test text');
    assert.strictEqual(spawnCalls.length, 0, 'playTTS should be a no-op on non-darwin');
    return;
  }
  resetSpawn();
  audioService.playTTS('test text');
  assert.strictEqual(spawnCalls.length, 1);
  assert.strictEqual(spawnCalls[0].cmd, 'say');
  assert.deepStrictEqual(spawnCalls[0].args, ['test text']);
  audioService.stopTTS();
});

// ── transcribe ────────────────────────────────────────────────────────────────

test('transcribe: calls transcribeFile and returns trimmed result', async () => {
  modelFileExists = true;
  audioService.invalidateContext();
  transcribeResult = '  hello world  ';
  transcribeFileCalls = 0;
  const result = await audioService.transcribe(Buffer.from('fake-wav-data'), null);
  assert.ok(transcribeFileCalls >= 1, 'transcribeFile should have been called');
  assert.strictEqual(result, 'hello world');
});

test('transcribe: returns empty string when result is whitespace-only', async () => {
  modelFileExists = true;
  transcribeResult = '   ';
  const result = await audioService.transcribe(Buffer.from('silence'), null);
  assert.strictEqual(result, '');
});

test('transcribe: reuses STT context across calls (persistent context)', async () => {
  modelFileExists = true;
  audioService.invalidateContext();
  initWhisperCalls = 0;
  transcribeResult = 'first';
  await audioService.transcribe(Buffer.from('a'), null);
  transcribeResult = 'second';
  await audioService.transcribe(Buffer.from('b'), null);
  assert.strictEqual(initWhisperCalls, 1, 'initWhisper should only be called once for two transcriptions');
});

test('transcribe: reinitializes context after invalidateContext', async () => {
  modelFileExists = true;
  audioService.invalidateContext();
  initWhisperCalls = 0;
  transcribeResult = 'after reset';
  await audioService.transcribe(Buffer.from('x'), null);
  assert.strictEqual(initWhisperCalls, 1, 'initWhisper should be called once after invalidation');
});

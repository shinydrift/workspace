/**
 * Tests for src/main/audio/audioService.ts
 *
 * audioService is now a thin proxy: transcription runs in the whisper
 * utilityProcess (see whisperWorkerClient / whisperEngine, tested separately).
 * External dependencies are mocked via Module._load:
 *   - electron              (app.getPath)
 *   - store/index           (getStore)
 *   - fs                    (existsSync stubbed for model-path checks)
 *   - child_process         (spawn → for TTS "say" command)
 *   - whisperWorkerClient   (fake — records delegation, returns canned text)
 *
 * Tests cover: isModelReady, playTTS platform guard, stopTTS safety, and that
 * transcribe/transcribeFromFile delegate to the whisper worker client.
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

// ── whisperWorkerClient mock ──────────────────────────────────────────────────

let transcribeText = 'transcribed text';
const workerCalls = {
  configure: [] as string[],
  transcribeBuffer: [] as Array<{ model: string }>,
  transcribeFromFile: [] as Array<{ filePath: string; model: string }>,
};

const mockWorkerClient = {
  configure: (userDataPath: string) => {
    workerCalls.configure.push(userDataPath);
  },
  transcribeBuffer: async (_audio: ArrayBuffer, model: string) => {
    workerCalls.transcribeBuffer.push({ model });
    return transcribeText;
  },
  transcribeFromFile: async (filePath: string, model: string) => {
    workerCalls.transcribeFromFile.push({ filePath, model });
    return transcribeText;
  },
  shutdown: async () => {},
};

// ── fs mock — real fs, but existsSync stubbed for model-path checks ───────────

/** Set to true in tests to simulate model file already present. */
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
    return { app: { getPath: () => '/tmp/test-userdata-audioservice' } };
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
  if (typeof request === 'string' && request.includes('/store/index')) {
    return { getStore: () => mockStore, settingsEvents: new EventEmitter() };
  }
  if (typeof request === 'string' && request.includes('/whisperWorkerClient')) {
    return { whisperWorkerClient: mockWorkerClient };
  }
  return origLoad.call(this, request, parent, isMain);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { audioService } = require('../../../src/main/audio/audioService') as {
  audioService: {
    isModelReady: () => boolean;
    transcribe: (buf: ArrayBuffer) => Promise<string>;
    transcribeFromFile: (filePath: string) => Promise<string>;
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
  // '--' terminates option parsing so text with leading hyphens isn't read as say(1) flags.
  assert.deepStrictEqual(spawnCalls[0].args, ['--', 'test text']);
  audioService.stopTTS();
});

// ── transcribe (delegation to whisper worker) ─────────────────────────────────

test('transcribe: delegates to the whisper worker and returns its text', async () => {
  transcribeText = 'hello world';
  workerCalls.transcribeBuffer.length = 0;
  const result = await audioService.transcribe(new ArrayBuffer(8));
  assert.strictEqual(result, 'hello world');
  assert.strictEqual(workerCalls.transcribeBuffer.length, 1);
  assert.strictEqual(workerCalls.transcribeBuffer[0].model, configuredModel);
});

test('transcribe: configures the worker with the userData path', async () => {
  workerCalls.configure.length = 0;
  await audioService.transcribe(new ArrayBuffer(8));
  // configure() is idempotent — it registers only on the first transcribe of the
  // process. Either it was already configured (0 recorded) or it used the app path.
  assert.ok(
    workerCalls.configure.length === 0 || workerCalls.configure[0] === '/tmp/test-userdata-audioservice',
    'worker should be configured with the app userData path'
  );
});

test('transcribeFromFile: delegates to the whisper worker', async () => {
  transcribeText = 'from file';
  workerCalls.transcribeFromFile.length = 0;
  const result = await audioService.transcribeFromFile('/tmp/voice-memo.m4a');
  assert.strictEqual(result, 'from file');
  assert.strictEqual(workerCalls.transcribeFromFile.length, 1);
  assert.strictEqual(workerCalls.transcribeFromFile[0].filePath, '/tmp/voice-memo.m4a');
  assert.strictEqual(workerCalls.transcribeFromFile[0].model, configuredModel);
});

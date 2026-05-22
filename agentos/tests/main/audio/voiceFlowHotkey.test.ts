import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { EventEmitter } from 'node:events';

// Fake UiohookKey with distinct numeric values per key so we can assert exactly which codes are included.
const MOCK_KEY = {
  Shift: 42,
  ShiftRight: 54,
  Meta: 100,
  MetaRight: 101,
  Ctrl: 200,
  CtrlRight: 201,
  Alt: 300,
  AltRight: 301,
  Space: 57,
  F13: 183,
};

// Handler registries — populated when VoiceFlowHotkey.start() registers with uiohook / ipcMain.
const uiohookHandlers: Record<string, Array<(e: { keycode: number }) => void>> = {};
const ipcMainHandlers: Record<string, Array<() => void>> = {};

const origLoad = Module._load as (req: string, parent: unknown, isMain: boolean) => unknown;
(Module._load as unknown) = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'uiohook-napi') {
    return {
      uIOhook: {
        on: (event: string, h: (e: { keycode: number }) => void) => {
          (uiohookHandlers[event] ??= []).push(h);
        },
        off: (event: string, h: (e: { keycode: number }) => void) => {
          uiohookHandlers[event] = (uiohookHandlers[event] ?? []).filter((x) => x !== h);
        },
        start: () => {},
        stop: () => {},
      },
      UiohookKey: MOCK_KEY,
    };
  }
  if (request === 'electron') {
    return {
      systemPreferences: { isTrustedAccessibilityClient: () => true },
      shell: { openExternal: () => {} },
      app: { on: () => {}, off: () => {} },
      ipcMain: {
        on: (event: string, h: () => void) => {
          (ipcMainHandlers[event] ??= []).push(h);
        },
        off: (event: string, h: () => void) => {
          ipcMainHandlers[event] = (ipcMainHandlers[event] ?? []).filter((x) => x !== h);
        },
      },
    };
  }
  if (typeof request === 'string' && request.includes('/store/index')) {
    return {
      getStore: () => ({ get: () => ({}) }),
      settingsEvents: new EventEmitter(),
    };
  }
  if (request === 'child_process') {
    return { exec: () => {} };
  }
  return origLoad.call(this, request, parent, isMain);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveKeyCodes, VoiceFlowHotkey } = require('../../../src/main/audio/voiceFlowHotkey') as {
  resolveKeyCodes: (keyName: string) => Set<number>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  VoiceFlowHotkey: new () => any;
};

(Module._load as unknown) = origLoad;

// ---------------------------------------------------------------------------
// resolveKeyCodes unit tests
// ---------------------------------------------------------------------------

test('resolveKeyCodes: ShiftLeft returns only left shift keycode', () => {
  const codes = resolveKeyCodes('ShiftLeft');
  assert.ok(codes.has(MOCK_KEY.Shift), 'should include left shift');
  assert.ok(!codes.has(MOCK_KEY.ShiftRight), 'should NOT include right shift');
  assert.strictEqual(codes.size, 1);
});

test('resolveKeyCodes: Shift returns both left and right shift keycodes', () => {
  const codes = resolveKeyCodes('Shift');
  assert.ok(codes.has(MOCK_KEY.Shift));
  assert.ok(codes.has(MOCK_KEY.ShiftRight));
  assert.strictEqual(codes.size, 2);
});

test('resolveKeyCodes: Meta returns both left and right meta keycodes', () => {
  const codes = resolveKeyCodes('Meta');
  assert.ok(codes.has(MOCK_KEY.Meta));
  assert.ok(codes.has(MOCK_KEY.MetaRight));
  assert.strictEqual(codes.size, 2);
});

test('resolveKeyCodes: unknown key falls back to default (Space)', () => {
  const codes = resolveKeyCodes('NonExistentKey');
  // Default key is Space
  assert.ok(codes.has(MOCK_KEY.Space), 'fallback should include Space');
  assert.strictEqual(codes.size, 1);
});

// ---------------------------------------------------------------------------
// VoiceFlowHotkey state machine tests
// ---------------------------------------------------------------------------

function makeWindow(sentMessages: string[]) {
  return {
    isFocused: () => true,
    isDestroyed: () => false,
    webContents: { send: (event: string) => sentMessages.push(event) },
  };
}

test('hold abort: releasing key before 3s cancels countdown and resets recording state', () => {
  mock.timers.enable(['setTimeout']);
  const instance = new VoiceFlowHotkey();
  instance.start(() => null);

  // Simulate a short tap (keydown then immediate keyup)
  uiohookHandlers['keydown']?.forEach((h) => h({ keycode: MOCK_KEY.Space }));
  assert.strictEqual(instance.isRecording, true, 'isRecording should be true after keydown');

  uiohookHandlers['keyup']?.forEach((h) => h({ keycode: MOCK_KEY.Space }));
  assert.strictEqual(instance.isRecording, false, 'isRecording should be false after early keyup');
  assert.strictEqual(instance.startTimer, null, 'startTimer should be cleared');

  // Advancing past countdown should have no effect — timer was already cancelled
  mock.timers.tick(3001);

  instance.stop();
  mock.timers.reset();
});

test('second distinct keydown during recording sends VOICE_FLOW_STOP, not RECORDING_CANCEL', () => {
  const sentMessages: string[] = [];
  const instance = new VoiceFlowHotkey();
  instance.start(() => makeWindow(sentMessages));

  // Put instance directly into recording state (countdown already completed)
  instance.isRecording = true;
  instance.activeKeycode = null;

  uiohookHandlers['keydown']?.forEach((h) => h({ keycode: MOCK_KEY.Space }));

  assert.ok(sentMessages.includes('event:voiceFlow:stop'), 'should send VOICE_FLOW_STOP');
  assert.ok(!sentMessages.includes('event:recording:cancel'), 'should NOT send RECORDING_CANCEL');

  instance.stop();
});

test('key-repeat on stop press is debounced: only one VOICE_FLOW_STOP sent', () => {
  const sentMessages: string[] = [];
  const instance = new VoiceFlowHotkey();
  instance.start(() => makeWindow(sentMessages));

  // Put instance directly into recording state
  instance.isRecording = true;
  instance.activeKeycode = null;

  // First stop press — sets activeKeycode, sends VOICE_FLOW_STOP
  uiohookHandlers['keydown']?.forEach((h) => h({ keycode: MOCK_KEY.Space }));
  assert.strictEqual(
    sentMessages.filter((e) => e === 'event:voiceFlow:stop').length,
    1,
    'first press should send one VOICE_FLOW_STOP',
  );

  // OS key-repeat while still holding — activeKeycode is set, should be debounced
  uiohookHandlers['keydown']?.forEach((h) => h({ keycode: MOCK_KEY.Space }));
  assert.strictEqual(
    sentMessages.filter((e) => e === 'event:voiceFlow:stop').length,
    1,
    'repeat should be debounced — no second VOICE_FLOW_STOP',
  );

  instance.stop();
});

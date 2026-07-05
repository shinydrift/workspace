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
  Escape: 1,
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

test('resolveKeyCodes: unknown key falls back to default (Alt)', () => {
  const codes = resolveKeyCodes('NonExistentKey');
  // Default key is Alt — both left and right variants match
  assert.ok(codes.has(MOCK_KEY.Alt), 'fallback should include left Alt');
  assert.ok(codes.has(MOCK_KEY.AltRight), 'fallback should include right Alt');
  assert.strictEqual(codes.size, 2);
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

test('hold abort: releasing key before the threshold cancels the countdown — recording never starts', () => {
  mock.timers.enable(['setTimeout']);
  const instance = new VoiceFlowHotkey();
  instance.start(() => null);

  // Keydown arms the hold countdown — recording has NOT begun yet.
  uiohookHandlers['keydown']?.forEach((h) => h({ keycode: MOCK_KEY.Alt }));
  assert.strictEqual(instance.isRecording, false, 'isRecording should be false during countdown');
  assert.notStrictEqual(instance.startTimer, null, 'startTimer should be armed after keydown');

  // Release before the threshold — the countdown is cancelled.
  uiohookHandlers['keyup']?.forEach((h) => h({ keycode: MOCK_KEY.Alt }));
  assert.strictEqual(instance.startTimer, null, 'startTimer should be cleared');
  assert.strictEqual(instance.isRecording, false, 'isRecording should remain false after early keyup');

  // Advancing past the countdown has no effect — the timer was already cancelled.
  mock.timers.tick(1001);
  assert.strictEqual(instance.isRecording, false, 'isRecording stays false — countdown was cancelled');

  instance.stop();
  mock.timers.reset();
});

test('full hold cycle: countdown completes, then key release sends VOICE_FLOW_STOP', () => {
  mock.timers.enable(['setTimeout']);
  const sentMessages: string[] = [];
  const instance = new VoiceFlowHotkey();
  instance.start(() => makeWindow(sentMessages));

  // Hold past the threshold — recording starts.
  uiohookHandlers['keydown']?.forEach((h) => h({ keycode: MOCK_KEY.Alt }));
  mock.timers.tick(1001);
  assert.strictEqual(instance.isRecording, true, 'isRecording should be true after the hold threshold');

  // Release while recording — stop and transcribe.
  uiohookHandlers['keyup']?.forEach((h) => h({ keycode: MOCK_KEY.Alt }));
  assert.strictEqual(instance.isRecording, false, 'isRecording should be false after keyup');
  assert.ok(sentMessages.includes('event:voiceFlow:stop'), 'should send VOICE_FLOW_STOP');
  assert.ok(!sentMessages.includes('event:recording:cancel'), 'should NOT send RECORDING_CANCEL');

  instance.stop();
  mock.timers.reset();
});

test('auto-stop while key is still held does not re-arm on key-repeat (no double recording)', () => {
  mock.timers.enable(['setTimeout']);
  const sentMessages: string[] = [];
  const instance = new VoiceFlowHotkey();
  instance.start(() => makeWindow(sentMessages));

  // Hold past the threshold — recording starts.
  uiohookHandlers['keydown']?.forEach((h) => h({ keycode: MOCK_KEY.Alt }));
  mock.timers.tick(1001);
  assert.strictEqual(instance.isRecording, true);

  // Renderer's silence auto-stop acks completion while the key is STILL physically held.
  ipcMainHandlers['event:voiceFlow:stopped']?.forEach((h) => h());
  assert.strictEqual(instance.isRecording, false, 'recording ends on auto-stop ack');
  assert.notStrictEqual(instance.activeKeycode, null, 'activeKeycode must persist — the key is still held');

  // OS key-repeat keeps delivering keydowns — they must NOT arm a second countdown.
  uiohookHandlers['keydown']?.forEach((h) => h({ keycode: MOCK_KEY.Alt }));
  assert.strictEqual(instance.startTimer, null, 'no new countdown armed after auto-stop while held');
  mock.timers.tick(1001);
  assert.strictEqual(instance.isRecording, false, 'no second recording starts from the same hold');

  // The physical release finally clears the held-key marker.
  uiohookHandlers['keyup']?.forEach((h) => h({ keycode: MOCK_KEY.Alt }));
  assert.strictEqual(instance.activeKeycode, null, 'key-up clears activeKeycode');

  instance.stop();
  mock.timers.reset();
});

test('stuck-key watchdog: a dropped key-up self-heals so the hotkey never wedges', () => {
  mock.timers.enable(['setTimeout']);
  const instance = new VoiceFlowHotkey();
  instance.start(() => null);

  // Hold past the threshold, then the matching key-up is never delivered (dropped by the global hook).
  uiohookHandlers['keydown']?.forEach((h) => h({ keycode: MOCK_KEY.Alt }));
  mock.timers.tick(1001);
  assert.strictEqual(instance.isRecording, true);
  assert.notStrictEqual(instance.activeKeycode, null, 'key is considered held');

  // The watchdog force-releases the held key after the timeout.
  mock.timers.tick(150001);
  assert.strictEqual(instance.activeKeycode, null, 'watchdog clears the stuck activeKeycode');
  assert.strictEqual(instance.isRecording, false, 'watchdog ends the stuck recording');

  // Hotkey is usable again — a fresh press arms a new countdown.
  uiohookHandlers['keydown']?.forEach((h) => h({ keycode: MOCK_KEY.Alt }));
  assert.notStrictEqual(instance.startTimer, null, 'a new hold arms after self-heal');

  instance.stop();
  mock.timers.reset();
});

test('key-repeat during hold is debounced: countdown is armed only once', () => {
  mock.timers.enable(['setTimeout']);
  const instance = new VoiceFlowHotkey();
  instance.start(() => null);

  // First keydown arms the countdown.
  uiohookHandlers['keydown']?.forEach((h) => h({ keycode: MOCK_KEY.Alt }));
  const armedTimer = instance.startTimer;
  assert.notStrictEqual(armedTimer, null, 'first keydown should arm the countdown');

  // OS key-repeat fires more keydowns while still holding — activeKeycode is set, so they are ignored.
  uiohookHandlers['keydown']?.forEach((h) => h({ keycode: MOCK_KEY.Alt }));
  assert.strictEqual(instance.startTimer, armedTimer, 'repeat keydown should not re-arm the countdown');

  instance.stop();
  mock.timers.reset();
});

/**
 * Vitest setup — runs before each renderer test file.
 * Mocks window.electronAPI so hooks that call IPC methods work in jsdom.
 */

import { vi, beforeEach } from 'vitest';

function makeElectronAPI() {
  return {
    settings: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      onChange: vi.fn().mockReturnValue(() => {}),
    },
    thread: {
      create: vi.fn().mockResolvedValue({ id: 'new-thread' }),
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    project: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    audio: {
      transcribe: vi.fn().mockResolvedValue(''),
      stopTTS: vi.fn().mockResolvedValue(undefined),
    },
    tray: {
      focusThread: vi.fn(),
      openApp: vi.fn(),
      quitApp: vi.fn(),
    },
    on: {
      threadStatus: vi.fn().mockReturnValue(() => {}),
      settingsChanged: vi.fn().mockReturnValue(() => {}),
      message: vi.fn().mockReturnValue(() => {}),
    },
    platform: 'linux',
  };
}

// Reset mocks before each test
beforeEach(() => {
  Object.defineProperty(window, 'electronAPI', {
    value: makeElectronAPI(),
    writable: true,
    configurable: true,
  });
});

/**
 * Tests for renderer/hooks/useMeetingRecorder.ts
 * Uses renderHook + vitest mocks; no real audio hardware required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMeetingRecorder } from '../../../src/renderer/hooks/useMeetingRecorder';

// ── Audio lib mock ────────────────────────────────────────────────────────────

vi.mock('@/lib/audio', () => ({
  attachAudioCapture: vi.fn(),
  resamplePcmTo16kHz: vi.fn(async function () {
    return new Float32Array(16);
  }),
  encodePcmAsWav: vi.fn(function () {
    return new ArrayBuffer(128);
  }),
}));

import { attachAudioCapture } from '@/lib/audio';

// ── AudioContext constructor mock ─────────────────────────────────────────────

class MockAudioContext {
  sampleRate = 44100;
  destination = {};
  createMediaStreamSource = vi.fn(function () {
    return { connect: vi.fn() };
  });
  createMediaStreamDestination = vi.fn(function () {
    return { stream: {} };
  });
  createGain = vi.fn(function () {
    return { gain: { value: 0 }, connect: vi.fn() };
  });
  createOscillator = vi.fn(function () {
    return { frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null };
  });
  close = vi.fn();
}

// ── Test state ────────────────────────────────────────────────────────────────

let lastOnChunk: ((chunk: Float32Array) => void) | undefined;

// ── electronAPI extensions needed by this hook ────────────────────────────────

function extendElectronAPI() {
  Object.assign(window.electronAPI, {
    audio: {
      ...window.electronAPI.audio,
      modelReady: vi.fn().mockResolvedValue({ ready: true }),
      transcribe: vi.fn().mockResolvedValue({ text: 'Hello meeting' }),
    },
    files: {
      saveTranscript: vi.fn().mockResolvedValue({ path: '.agentos/transcripts/test.txt' }),
      saveRecording: vi.fn().mockResolvedValue({ recordingId: 'rec-1' }),
      setRecordingThread: vi.fn().mockResolvedValue(null),
    },
    terminal: {
      sendInput: vi.fn().mockResolvedValue(undefined),
    },
    thread: {
      ...window.electronAPI.thread,
      create: vi.fn().mockResolvedValue({ id: 'thread-meeting-1', name: 'Meeting' }),
    },
  });
}

beforeEach(() => {
  lastOnChunk = undefined;

  extendElectronAPI();

  vi.mocked(attachAudioCapture).mockImplementation(async function (_ctx, _dest, onChunk) {
    lastOnChunk = onChunk;
    return { stop: vi.fn() } as unknown as import('@/lib/audio').AudioCapture;
  });

  Object.defineProperty(window, 'AudioContext', {
    value: MockAudioContext,
    writable: true,
    configurable: true,
  });

  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: vi.fn() }],
        getAudioTracks: () => [],
      }),
      getDisplayMedia: vi.fn().mockRejectedValue(new Error('not available')),
    },
    writable: true,
    configurable: true,
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useMeetingRecorder', () => {
  it('mic permission denied (NotAllowedError) → error state with actionable message', async () => {
    const err = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(err);

    const { result } = renderHook(() => useMeetingRecorder('/home/user/project'));

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.state).toBe('error');
    expect(result.current.errorMsg).toMatch(/microphone access denied/i);
  });

  it('stopAndProcess with no audio captured → error state with expected message', async () => {
    const { result } = renderHook(() => useMeetingRecorder('/home/user/project'));

    // Start recording — no chunks pushed, so pcmChunksRef stays empty.
    await act(async () => {
      await result.current.startRecording();
    });
    expect(result.current.state).toBe('recording');

    await act(async () => {
      await result.current.stopAndProcess();
    });

    expect(result.current.state).toBe('error');
    expect(result.current.errorMsg).toMatch(/no audio was captured/i);
  });

  it('successful flow: transcribe → save → create thread → send prompt → idle', async () => {
    const { result } = renderHook(() => useMeetingRecorder('/home/user/project'));

    await act(async () => {
      await result.current.startRecording();
    });
    expect(result.current.state).toBe('recording');

    // Push a PCM chunk so audio is non-empty.
    act(() => {
      lastOnChunk?.(new Float32Array([0.1, 0.2, 0.3]));
    });

    await act(async () => {
      await result.current.stopAndProcess();
    });

    await waitFor(() => expect(result.current.state).toBe('idle'));
    expect(window.electronAPI.thread.create).toHaveBeenCalled();
    expect(window.electronAPI.terminal.sendInput).toHaveBeenCalled();
  });

  it('thread create failure → error state; state recoverable via reset', async () => {
    vi.mocked(window.electronAPI.thread.create).mockRejectedValueOnce(new Error('create failed'));

    const { result } = renderHook(() => useMeetingRecorder('/home/user/project'));

    await act(async () => {
      await result.current.startRecording();
    });
    act(() => {
      lastOnChunk?.(new Float32Array([0.1, 0.2, 0.3]));
    });

    await act(async () => {
      await result.current.stopAndProcess();
    });

    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.errorMsg).toMatch(/failed to create thread/i);

    act(() => {
      result.current.reset();
    });
    expect(result.current.state).toBe('idle');
    expect(result.current.errorMsg).toBe('');
  });
});

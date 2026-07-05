/**
 * Tests for renderer/hooks/useVoiceFlow.ts
 * Uses renderHook + vitest mocks; no real audio hardware required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useVoiceFlow } from '../../../src/renderer/hooks/useVoiceFlow';
import { useUIStore } from '../../../src/renderer/store/uiStore';

// ── Audio lib mock ────────────────────────────────────────────────────────────

vi.mock('@/lib/audio', () => ({
  attachAudioCapture: vi.fn(),
  encodePcmAsWav: vi.fn(function () {
    return new ArrayBuffer(64);
  }),
  resamplePcmTo16kHz: vi.fn(async function (chunks: Float32Array[]) {
    return chunks[0] ?? new Float32Array(0);
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
  createGain = vi.fn(function () {
    return { gain: { value: 0 }, connect: vi.fn() };
  });
  createAnalyser = vi.fn(function () {
    return { fftSize: 256, connect: vi.fn(), getFloatTimeDomainData: vi.fn() };
  });
  createOscillator = vi.fn(function () {
    return { frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null };
  });
  close = vi.fn();
}

// ── Test state ────────────────────────────────────────────────────────────────

// Routing (appFocused / frontmostApp) is delivered with the START event and captured in routingRef;
// the STOP event carries no payload (it just triggers the auto-stop path).
let voiceFlowStartCb: ((payload: { appFocused: boolean; frontmostApp: string | null }) => void) | null = null;
let voiceFlowStopCb: (() => void) | null = null;
let recordingCancelCb: (() => void) | null = null;
let lastOnChunk: ((chunk: Float32Array) => void) | undefined;

// ── electronAPI extensions needed by this hook ────────────────────────────────

function extendElectronAPI() {
  Object.assign(window.electronAPI, {
    audio: {
      ...window.electronAPI.audio,
      transcribe: vi.fn().mockResolvedValue({ text: 'Transcribed text' }),
    },
    win: {
      pasteTranscript: vi.fn().mockResolvedValue(undefined),
      focus: vi.fn().mockResolvedValue(undefined),
      broadcastRecordingState: vi.fn(),
      notifyVoiceFlowStopped: vi.fn(),
    },
    on: {
      ...window.electronAPI.on,
      voiceFlowStart: vi.fn(function (cb: (p: { appFocused: boolean; frontmostApp: string | null }) => void) {
        voiceFlowStartCb = cb;
        return function () {
          voiceFlowStartCb = null;
        };
      }),
      voiceFlowStop: vi.fn(function (cb: () => void) {
        voiceFlowStopCb = cb;
        return function () {
          voiceFlowStopCb = null;
        };
      }),
      recordingCancel: vi.fn(function (cb: () => void) {
        recordingCancelCb = cb;
        return function () {
          recordingCancelCb = null;
        };
      }),
      voiceFlowDownloadProgress: vi.fn(function () {
        return function () {};
      }),
      voiceFlowTranscriptSegment: vi.fn(function () {
        return function () {};
      }),
    },
  });
}

beforeEach(() => {
  voiceFlowStartCb = null;
  voiceFlowStopCb = null;
  recordingCancelCb = null;
  lastOnChunk = undefined;

  // Reset UIStore between tests to avoid state leaking across tests.
  useUIStore.setState({ selectedThreadId: null });

  extendElectronAPI();

  vi.mocked(attachAudioCapture).mockImplementation(async function (_ctx, _source, onChunk) {
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
      }),
    },
    writable: true,
    configurable: true,
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useVoiceFlow', () => {
  it('starts in idle state', () => {
    const { result } = renderHook(() => useVoiceFlow());
    expect(result.current.state).toBe('idle');
  });

  it('cancel called while getUserMedia is pending → no recording starts, stays idle', async () => {
    let resolveGetUserMedia!: (stream: MediaStream) => void;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValueOnce(
      new Promise<MediaStream>((resolve) => {
        resolveGetUserMedia = resolve;
      })
    );

    const { result } = renderHook(() => useVoiceFlow());

    act(() => {
      voiceFlowStartCb?.({ appFocused: true, frontmostApp: null });
    });
    // Fire cancel immediately while getUserMedia is still pending — sets the pending-stop flag.
    act(() => {
      recordingCancelCb?.();
    });

    // Resolve getUserMedia — the hook should detect the pending stop flag and bail.
    await act(async () => {
      resolveGetUserMedia({
        getTracks: () => [{ stop: vi.fn() }],
      } as unknown as MediaStream);
    });

    expect(result.current.state).toBe('idle');
  });

  it('silent capture (empty chunks) skips transcription and returns to idle', async () => {
    const { result } = renderHook(() => useVoiceFlow());

    act(() => {
      voiceFlowStartCb?.({ appFocused: true, frontmostApp: null });
    });
    await waitFor(() => expect(result.current.state).toBe('recording'));

    // Stop with no PCM chunks pushed → audio is silent.
    await act(async () => {
      voiceFlowStopCb?.();
    });

    await waitFor(() => expect(result.current.state).toBe('idle'));
    expect(window.electronAPI.audio.transcribe).not.toHaveBeenCalled();
  });

  it('routes to focused thread when app is focused (does not paste or open new thread)', async () => {
    // A selected thread is required for routeToThread to be true.
    useUIStore.setState({ selectedThreadId: 'thread-active' });

    const { result } = renderHook(() => useVoiceFlow());

    act(() => {
      voiceFlowStartCb?.({ appFocused: true, frontmostApp: null });
    });
    await waitFor(() => expect(result.current.state).toBe('recording'));

    // Push a chunk with non-trivial energy so hasAudioEnergy returns true.
    act(() => {
      lastOnChunk?.(new Float32Array(Array(100).fill(0.1)));
    });

    await act(async () => {
      voiceFlowStopCb?.();
    });

    await waitFor(() => expect(result.current.state).toBe('idle'));
    // App is focused → transcript should go to the selected thread, not pasted externally.
    expect(window.electronAPI.win.pasteTranscript).not.toHaveBeenCalled();
    expect(window.electronAPI.win.focus).not.toHaveBeenCalled();
    expect(window.electronAPI.audio.transcribe).toHaveBeenCalled();
  });

  it('paste to external field; passes frontmostApp to pasteTranscript', async () => {
    const { result } = renderHook(() => useVoiceFlow());

    act(() => {
      voiceFlowStartCb?.({ appFocused: false, frontmostApp: 'Safari' });
    });
    await waitFor(() => expect(result.current.state).toBe('recording'));

    act(() => {
      lastOnChunk?.(new Float32Array(Array(100).fill(0.1)));
    });

    await act(async () => {
      voiceFlowStopCb?.();
    });

    await waitFor(() => expect(result.current.state).toBe('idle'));
    expect(window.electronAPI.win.pasteTranscript).toHaveBeenCalledWith('Transcribed text', 'Safari');
    expect(window.electronAPI.win.focus).not.toHaveBeenCalled();
  });

  it('pastes when app not focused and frontmostApp is set, even if externalTextField is false (browser case)', async () => {
    const { result } = renderHook(() => useVoiceFlow());

    act(() => {
      voiceFlowStartCb?.({ appFocused: false, frontmostApp: 'Chrome' });
    });
    await waitFor(() => expect(result.current.state).toBe('recording'));

    act(() => {
      lastOnChunk?.(new Float32Array(Array(100).fill(0.1)));
    });

    await act(async () => {
      voiceFlowStopCb?.();
    });

    await waitFor(() => expect(result.current.state).toBe('idle'));
    expect(window.electronAPI.win.pasteTranscript).toHaveBeenCalledWith('Transcribed text', 'Chrome');
    expect(window.electronAPI.win.focus).not.toHaveBeenCalled();
  });

  it('paste to external field; on paste failure falls back to new thread (win.focus called)', async () => {
    vi.mocked(window.electronAPI.win.pasteTranscript).mockRejectedValueOnce(new Error('paste failed'));

    const { result } = renderHook(() => useVoiceFlow());

    act(() => {
      voiceFlowStartCb?.({ appFocused: false, frontmostApp: 'Notes' });
    });
    await waitFor(() => expect(result.current.state).toBe('recording'));

    act(() => {
      lastOnChunk?.(new Float32Array(Array(100).fill(0.1)));
    });

    await act(async () => {
      voiceFlowStopCb?.();
    });

    await waitFor(() => expect(result.current.state).toBe('idle'));
    // pasteTranscript was attempted but failed.
    expect(window.electronAPI.win.pasteTranscript).toHaveBeenCalledWith('Transcribed text', 'Notes');
    // On failure: window is focused to show the new-thread fallback.
    expect(window.electronAPI.win.focus).toHaveBeenCalled();
  });

  it('falls back to new thread when frontmostApp is null (AX check failed)', async () => {
    const { result } = renderHook(() => useVoiceFlow());

    act(() => {
      voiceFlowStartCb?.({ appFocused: false, frontmostApp: null });
    });
    await waitFor(() => expect(result.current.state).toBe('recording'));

    act(() => {
      lastOnChunk?.(new Float32Array(Array(100).fill(0.1)));
    });

    await act(async () => {
      voiceFlowStopCb?.();
    });

    await waitFor(() => expect(result.current.state).toBe('idle'));
    // No app name → paste skipped, AgentOS is focused to show the new-thread fallback.
    expect(window.electronAPI.win.pasteTranscript).not.toHaveBeenCalled();
    expect(window.electronAPI.win.focus).toHaveBeenCalled();
  });

  it('hung transcription times out → resets to idle and acks main (no wedge in transcribing)', async () => {
    vi.useFakeTimers();
    try {
      // Transcription that never resolves — simulates a hung STT / model load.
      vi.mocked(window.electronAPI.audio.transcribe).mockReturnValueOnce(new Promise<{ text: string }>(() => {}));

      const { result } = renderHook(() => useVoiceFlow());

      await act(async () => {
        voiceFlowStartCb?.({ appFocused: true, frontmostApp: null });
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.state).toBe('recording');

      act(() => {
        lastOnChunk?.(new Float32Array(Array(100).fill(0.1)));
      });

      await act(async () => {
        voiceFlowStopCb?.();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.state).toBe('transcribing');

      // Advance past the transcribe timeout — the flow must self-heal.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300_001);
      });
      expect(result.current.state).toBe('idle');
      expect(window.electronAPI.win.notifyVoiceFlowStopped).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('listener cleanup on unmount — off-functions are called', () => {
    const { unmount } = renderHook(() => useVoiceFlow());

    expect(window.electronAPI.on.voiceFlowStart).toHaveBeenCalled();
    expect(window.electronAPI.on.voiceFlowStop).toHaveBeenCalled();
    expect(window.electronAPI.on.recordingCancel).toHaveBeenCalled();

    unmount();

    // The cleanup functions returned by the on.* mocks should have been called,
    // clearing the module-level capture variables.
    expect(voiceFlowStartCb).toBeNull();
    expect(voiceFlowStopCb).toBeNull();
    expect(recordingCancelCb).toBeNull();
  });
});

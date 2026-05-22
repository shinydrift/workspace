import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAgentSettings } from '../../../../src/renderer/hooks/settings/useAgentSettings';
import type { AppSettings } from '../../../../src/shared/types/settings';
import {
  DEFAULT_PROVIDER_FAILOVER_SETTINGS,
  DEFAULT_PROVIDER_ORDER,
} from '../../../../src/shared/types/provider';

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { theme: 'dark', ...overrides } as AppSettings;
}

describe('useAgentSettings', () => {
  // ── null settings ────────────────────────────────────────────────────────

  it('returns defaults when settings is null', () => {
    const { result } = renderHook(() => useAgentSettings(null));
    expect(result.current.queueSilenceFallbackMs).toBe(1500);
    expect(result.current.failoverEnabled).toBe(DEFAULT_PROVIDER_FAILOVER_SETTINGS.enabled);
    expect(result.current.failoverTranscriptMessages).toBe(DEFAULT_PROVIDER_FAILOVER_SETTINGS.transcriptMessages);
    expect(result.current.persistDebugLogs).toBe(false);
    expect(result.current.ttsEnabled).toBe(false);
    expect(result.current.autopilotEnabled).toBe(false);
    expect(result.current.autopilotMaxConsecutiveTurns).toBe(3);
    expect(result.current.autopilotTranscriptMessages).toBe(12);
  });

  // ── queueSilenceFallbackMs ────────────────────────────────────────────────

  it('queueSilenceFallbackMs: returns explicit value', () => {
    const s = makeSettings({ queueSilenceFallbackMs: 3000 });
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.queueSilenceFallbackMs).toBe(3000);
  });

  it('queueSilenceFallbackMs: defaults to 1500 when absent', () => {
    const s = makeSettings();
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.queueSilenceFallbackMs).toBe(1500);
  });

  it('queueSilenceFallbackMs: clamps below 200 to 200', () => {
    const s = makeSettings({ queueSilenceFallbackMs: 50 });
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.queueSilenceFallbackMs).toBe(200);
  });

  it('queueSilenceFallbackMs: accepts exact 200', () => {
    const s = makeSettings({ queueSilenceFallbackMs: 200 });
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.queueSilenceFallbackMs).toBe(200);
  });

  // ── providerOrder ─────────────────────────────────────────────────────────

  it('providerOrder: returns DEFAULT_PROVIDER_ORDER when absent', () => {
    const s = makeSettings();
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.providerOrder).toEqual(DEFAULT_PROVIDER_ORDER);
  });

  it('providerOrder: normalizes legacy string entries', () => {
    const s = makeSettings({ providerOrder: ['claude', 'gemini'] as unknown as AppSettings['providerOrder'] });
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.providerOrder).toEqual([{ provider: 'claude' }, { provider: 'gemini' }]);
  });

  it('providerOrder: accepts provider/model entries', () => {
    const s = makeSettings({ providerOrder: [{ provider: 'claude' as const, model: 'claude-sonnet-4-6' }] });
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.providerOrder[0]).toEqual({ provider: 'claude', model: 'claude-sonnet-4-6' });
  });

  it('providerOrder: empty array falls back to DEFAULT_PROVIDER_ORDER', () => {
    const s = makeSettings({ providerOrder: [] });
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.providerOrder).toEqual(DEFAULT_PROVIDER_ORDER);
  });

  it('providerOrder: invalid provider entries are filtered', () => {
    const s = makeSettings({ providerOrder: [{ provider: 'unknown' }] as unknown as AppSettings['providerOrder'] });
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.providerOrder).toEqual(DEFAULT_PROVIDER_ORDER);
  });

  it('providerOrder: returned value is a copy (not same reference as DEFAULT_PROVIDER_ORDER)', () => {
    const s = makeSettings();
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.providerOrder).not.toBe(DEFAULT_PROVIDER_ORDER);
  });

  // ── failoverEnabled ───────────────────────────────────────────────────────

  it('failoverEnabled: defaults to DEFAULT_PROVIDER_FAILOVER_SETTINGS.enabled when absent', () => {
    const s = makeSettings();
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.failoverEnabled).toBe(DEFAULT_PROVIDER_FAILOVER_SETTINGS.enabled);
  });

  it('failoverEnabled: explicit false', () => {
    const s = makeSettings({ failover: { enabled: false, transcriptMessages: 12 } });
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.failoverEnabled).toBe(false);
  });

  it('failoverEnabled: explicit true', () => {
    const s = makeSettings({ failover: { enabled: true, transcriptMessages: 12 } });
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.failoverEnabled).toBe(true);
  });

  // ── failoverTranscriptMessages ────────────────────────────────────────────

  it('failoverTranscriptMessages: default when absent', () => {
    const s = makeSettings();
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.failoverTranscriptMessages).toBe(DEFAULT_PROVIDER_FAILOVER_SETTINGS.transcriptMessages);
  });

  it('failoverTranscriptMessages: explicit value', () => {
    const s = makeSettings({ failover: { enabled: true, transcriptMessages: 5 } });
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.failoverTranscriptMessages).toBe(5);
  });

  it('failoverTranscriptMessages: clamps 0 to 1', () => {
    const s = makeSettings({ failover: { enabled: true, transcriptMessages: 0 } });
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.failoverTranscriptMessages).toBe(1);
  });

  // ── boolean settings ──────────────────────────────────────────────────────

  it('persistDebugLogs: false when absent', () => {
    const s = makeSettings();
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.persistDebugLogs).toBe(false);
  });

  it('persistDebugLogs: true when set', () => {
    const s = makeSettings({ persistDebugLogs: true });
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.persistDebugLogs).toBe(true);
  });

  it('ttsEnabled: false when absent', () => {
    const s = makeSettings();
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.ttsEnabled).toBe(false);
  });

  it('ttsEnabled: true when set', () => {
    const s = makeSettings({ voice: { ttsEnabled: true } });
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.ttsEnabled).toBe(true);
  });

  it('autopilotEnabled: false when absent', () => {
    const s = makeSettings();
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.autopilotEnabled).toBe(false);
  });

  it('autopilotEnabled: true when set', () => {
    const s = makeSettings({ autopilot: { enabled: true } });
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.autopilotEnabled).toBe(true);
  });

  // ── autopilot numeric ─────────────────────────────────────────────────────

  it('autopilotMaxConsecutiveTurns: defaults to 3', () => {
    const s = makeSettings();
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.autopilotMaxConsecutiveTurns).toBe(3);
  });

  it('autopilotMaxConsecutiveTurns: explicit value', () => {
    const s = makeSettings({ autopilot: { maxConsecutiveTurns: 7 } });
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.autopilotMaxConsecutiveTurns).toBe(7);
  });

  it('autopilotMaxConsecutiveTurns: clamps 0 to 1', () => {
    const s = makeSettings({ autopilot: { maxConsecutiveTurns: 0 } });
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.autopilotMaxConsecutiveTurns).toBe(1);
  });

  it('autopilotTranscriptMessages: defaults to 12', () => {
    const s = makeSettings();
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.autopilotTranscriptMessages).toBe(12);
  });

  it('autopilotTranscriptMessages: explicit value', () => {
    const s = makeSettings({ autopilot: { transcriptMessages: 20 } });
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.autopilotTranscriptMessages).toBe(20);
  });

  it('autopilotTranscriptMessages: clamps 0 to 1', () => {
    const s = makeSettings({ autopilot: { transcriptMessages: 0 } });
    const { result } = renderHook(() => useAgentSettings(s));
    expect(result.current.autopilotTranscriptMessages).toBe(1);
  });
});

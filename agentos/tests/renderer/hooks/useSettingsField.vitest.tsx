import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSettingsField } from '../../../src/renderer/hooks/settings/useSettingsField';
import type { AppSettings } from '../../../src/shared/types';

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { theme: 'dark', ...overrides } as AppSettings;
}

describe('useSettingsField', () => {
  it('returns defaultValue when settings is null', () => {
    const { result } = renderHook(() =>
      useSettingsField<string>(null, (s) => s.theme as string, 'light')
    );
    expect(result.current[0]).toBe('light');
  });

  it('returns value from getter when settings is provided', () => {
    const settings = makeSettings({ theme: 'dark' });
    const { result } = renderHook(() =>
      useSettingsField<string>(settings, (s) => s.theme as string, 'light')
    );
    expect(result.current[0]).toBe('dark');
  });

  it('updates when settings change', () => {
    const s1 = makeSettings({ theme: 'light' });
    const s2 = makeSettings({ theme: 'dark' });

    const { result, rerender } = renderHook(
      ({ settings }) => useSettingsField<string>(settings, (s) => s.theme as string, 'light'),
      { initialProps: { settings: s1 } }
    );

    expect(result.current[0]).toBe('light');
    rerender({ settings: s2 });
    expect(result.current[0]).toBe('dark');
  });

  it('setter updates the value independently', () => {
    const settings = makeSettings({ theme: 'dark' });
    const { result } = renderHook(() =>
      useSettingsField<string>(settings, (s) => s.theme as string, 'light')
    );

    act(() => {
      result.current[1]('system');
    });

    expect(result.current[0]).toBe('system');
  });

  it('settings becoming null does not change current value', () => {
    const settings = makeSettings({ theme: 'dark' });
    const { result, rerender } = renderHook(
      ({ s }: { s: AppSettings | null }) =>
        useSettingsField<string>(s, (st) => st.theme as string, 'light'),
      { initialProps: { s: settings as AppSettings | null } }
    );

    expect(result.current[0]).toBe('dark');
    rerender({ s: null });
    // useEffect guard: `if (!settings) return` — value stays as-is
    expect(result.current[0]).toBe('dark');
  });
});

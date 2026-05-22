import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAsyncOp } from '../../../src/renderer/hooks/useAsyncOp';

describe('useAsyncOp', () => {
  it('starts with busy=false, error=null', () => {
    const { result } = renderHook(() => useAsyncOp());
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it('sets busy=true while the operation runs, then false on success', async () => {
    const { result } = renderHook(() => useAsyncOp());
    let resolveFn!: (val: string) => void;
    const promise = new Promise<string>((r) => (resolveFn = r));

    act(() => {
      result.current.run(() => promise);
    });
    expect(result.current.busy).toBe(true);

    await act(async () => {
      resolveFn('done');
      await promise;
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it('returns the resolved value', async () => {
    const { result } = renderHook(() => useAsyncOp());
    let returnValue: string | undefined;

    await act(async () => {
      returnValue = await result.current.run(async () => 'hello');
    });

    expect(returnValue).toBe('hello');
  });

  it('captures error message on failure and returns undefined', async () => {
    const { result } = renderHook(() => useAsyncOp());
    let returnValue: string | undefined = 'sentinel';

    await act(async () => {
      returnValue = await result.current.run(async () => {
        throw new Error('something went wrong');
      });
    });

    expect(result.current.error).toBe('something went wrong');
    expect(result.current.busy).toBe(false);
    expect(returnValue).toBeUndefined();
  });

  it('clears error on next run', async () => {
    const { result } = renderHook(() => useAsyncOp());

    await act(async () => {
      await result.current.run(async () => {
        throw new Error('first error');
      });
    });
    expect(result.current.error).toBe('first error');

    await act(async () => {
      await result.current.run(async () => 'ok');
    });
    expect(result.current.error).toBe(null);
  });

  it('setError allows manual error setting', () => {
    const { result } = renderHook(() => useAsyncOp());
    act(() => {
      result.current.setError('manual error');
    });
    expect(result.current.error).toBe('manual error');
  });

  it('setError(null) clears error', () => {
    const { result } = renderHook(() => useAsyncOp());
    act(() => {
      result.current.setError('err');
    });
    act(() => {
      result.current.setError(null);
    });
    expect(result.current.error).toBe(null);
  });
});

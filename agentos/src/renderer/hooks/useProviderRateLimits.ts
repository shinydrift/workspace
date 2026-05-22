import { useEffect, useRef } from 'react';
import { useInsightsStore } from '../store/insightsStore';

export function useProviderRateLimits() {
  const providerRateLimits = useInsightsStore((s) => s.providerRateLimits);
  const setProviderRateLimits = useInsightsStore((s) => s.setProviderRateLimits);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    function load() {
      if (inFlight.current) return;
      inFlight.current = true;
      window.electronAPI.analytics
        .getProviderRateLimits()
        .then((data) => {
          if (!cancelled) setProviderRateLimits(data);
        })
        .catch((error: unknown) => console.warn('Failed to load provider rate limits', error))
        .finally(() => {
          inFlight.current = false;
        });
    }

    load();
    const offMessage = window.electronAPI.on.messageAppended(({ message }) => {
      if (message.role === 'assistant') load();
    });

    return () => {
      cancelled = true;
      offMessage();
    };
  }, [setProviderRateLimits]);

  return providerRateLimits;
}

import { useEffect, useState } from 'react';
import type { HealthCheck } from '../../shared/types';

export function useDockerHealth() {
  const [healthStatus, setHealthStatus] = useState<HealthCheck['status'] | null>(null);

  useEffect(() => {
    window.electronAPI?.health
      .run()
      .then((report) => {
        const hasError = report.checks.some((c) => c.status === 'error');
        const hasWarn = report.checks.some((c) => c.status === 'warn');
        setHealthStatus(hasError ? 'error' : hasWarn ? 'warn' : 'ok');
      })
      .catch(() => {
        // silently ignore — health is non-critical at startup
      });
  }, []);

  return { healthStatus };
}

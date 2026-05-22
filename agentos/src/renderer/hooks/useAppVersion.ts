import { useEffect, useState } from 'react';

export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const getAppInfo = window.electronAPI?.app?.getInfo;
    if (!getAppInfo) {
      setVersion('Unavailable');
      return;
    }
    getAppInfo()
      .then((info) => {
        if (mounted) setVersion(info.version);
      })
      .catch(() => {
        if (mounted) setVersion('Unavailable');
      });
    return () => {
      mounted = false;
    };
  }, []);

  return version;
}

import React, { useEffect, useState } from 'react';
import { AppShell } from './components/layout/AppShell';
import { useAppSync } from './hooks/useAppSync';
import { TooltipProvider } from './components/ui/tooltip';
import { useUIStore } from './store/uiStore';
import { useTheme } from './hooks/useTheme';
import { useDomainStore } from './store/domainStore';
import { LogoTextAnimation } from './components/ui/logo-text-animation';
import { ThreadToaster } from './components/thread/ThreadToaster';

export function App() {
  useTheme();
  useAppSync();
  const setSelectedThread = useUIStore((s) => s.setSelectedThread);
  const threadsLoaded = useDomainStore((s) => s.threadsLoaded);
  const [animDone, setAnimDone] = useState(false);
  const [splashVisible, setSplashVisible] = useState(true);
  const readyToHide = threadsLoaded && animDone;

  useEffect(() => {
    if (!readyToHide) return;
    const t = setTimeout(() => setSplashVisible(false), 500);
    return () => clearTimeout(t);
  }, [readyToHide]);

  useEffect(() => {
    const off = window.electronAPI?.on.trayNavigateToThread(({ threadId }) => {
      setSelectedThread(threadId);
    });
    return () => off?.();
  }, [setSelectedThread]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = (e.target as HTMLElement).closest('a');
      if (!target) return;
      const href = target.getAttribute('href');
      if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
        e.preventDefault();
        window.electronAPI?.shell.openExternal(href);
      }
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);
  return (
    <TooltipProvider>
      <AppShell />
      <ThreadToaster />
      {splashVisible && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background transition-opacity duration-500"
          style={{ opacity: readyToHide ? 0 : 1, pointerEvents: readyToHide ? 'none' : 'auto' }}
        >
          <LogoTextAnimation onComplete={() => setAnimDone(true)} />
        </div>
      )}
    </TooltipProvider>
  );
}

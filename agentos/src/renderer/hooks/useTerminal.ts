import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { AppSettings } from '../../shared/types';

export function useTerminal(
  containerRef: React.RefObject<HTMLDivElement>,
  threadId: string,
  settings: Pick<AppSettings, 'fontSize'>
) {
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const FALLBACK_BG = '#1a1a1a';
  const FALLBACK_FG = '#d4d4d4';

  function resolveColor(cssVar: string, fallback: string): string {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
    if (!raw) return fallback;
    // xterm.js only accepts hex/rgb/named — resolve oklch and other modern formats via a temp element
    const el = document.createElement('div');
    el.style.display = 'none';
    el.style.color = raw;
    document.body.appendChild(el);
    const resolved = getComputedStyle(el).color;
    document.body.removeChild(el);
    return resolved || fallback;
  }

  useEffect(() => {
    if (!containerRef.current) return;

    const background = resolveColor('--background', FALLBACK_BG);
    const foreground = resolveColor('--foreground', FALLBACK_FG);

    const term = new Terminal({
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: settings.fontSize,
      theme: {
        background,
        foreground,
      },
      cursorBlink: true,
      scrollback: 5000,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;

    // Replay log history
    window.electronAPI.terminal.getHistory(threadId).then((entries: Array<{ data: string }>) => {
      entries.forEach((e) => term.write(e.data));
    });

    // Subscribe to live terminal data
    const unsubData = window.electronAPI.on.terminalData((event) => {
      if (event.threadId === threadId) {
        term.write(event.data);
      }
    });

    // Resize observer: fit terminal to container, then notify main
    const ro = new ResizeObserver(() => {
      fitAddon.fit();
      window.electronAPI.terminal.resize({
        threadId,
        cols: term.cols,
        rows: term.rows,
      });
    });
    ro.observe(containerRef.current);

    // Keep xterm colors in sync when theme class changes.
    const mo = new MutationObserver(() => {
      const nextBg = resolveColor('--background', FALLBACK_BG);
      const nextFg = resolveColor('--foreground', FALLBACK_FG);
      if (nextBg === term.options.theme?.background && nextFg === term.options.theme?.foreground) return;
      term.options.theme = { background: nextBg, foreground: nextFg };
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => {
      unsubData();
      ro.disconnect();
      mo.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]); // re-mount when threadId changes

  function clear() {
    termRef.current?.clear();
  }

  function scrollToBottom() {
    termRef.current?.scrollToBottom();
  }

  return { clear, scrollToBottom };
}

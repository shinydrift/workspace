import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getBaseName(value?: string): string {
  if (!value) return '';
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

export function timeAgo(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

export function relativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const mins = Math.max(1, Math.floor(diffMs / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export const focusRing =
  'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export function formatSeconds(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function getArgSummary(name: string, args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const a = args as Record<string, unknown>;
  if (typeof a.description === 'string') return a.description;
  if (typeof a.prompt === 'string') return a.prompt.length > 80 ? a.prompt.slice(0, 80) + '…' : a.prompt;
  if (typeof a.file_path === 'string') return a.file_path;
  if (typeof a.path === 'string') return a.path;
  if (typeof a.command === 'string') {
    const cmd = a.command;
    return cmd.length > 80 ? cmd.slice(0, 80) + '…' : cmd;
  }
  if (typeof a.pattern === 'string') return a.pattern;
  if (typeof a.query === 'string') return a.query;
  if (typeof a.url === 'string') return a.url;
  return '';
}

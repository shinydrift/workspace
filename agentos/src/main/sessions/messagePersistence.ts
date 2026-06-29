import fs from 'fs';
import path from 'path';
import stripAnsiLib from 'strip-ansi';
import * as threadStore from '../threads/threadStore';
import { eventLogger } from '../utils/eventLog';

export function ensureDataDirs(homeDir: string): {
  logsDir: string;
  messagesDir: string;
  sessionsDataDir: string;
  threadPostsDir: string;
} {
  const base = path.join(homeDir, '.agentos');
  const logsDir = path.join(base, 'logs');
  const messagesDir = path.join(base, 'messages');
  const sessionsDataDir = path.join(base, 'sessions');
  const threadPostsDir = path.join(base, 'thread-posts');
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(messagesDir, { recursive: true });
  fs.mkdirSync(sessionsDataDir, { recursive: true });
  fs.mkdirSync(threadPostsDir, { recursive: true });
  return { logsDir, messagesDir, sessionsDataDir, threadPostsDir };
}

/**
 * Parses rawOutput once and persists all provider session IDs found.
 * Returns the Claude session ID (for auto-titling), or null.
 */
export function persistAllSessionIds(threadId: string, rawOutput: string): string | null {
  const cleaned = stripAnsiLib(rawOutput).replace(/\r\n|\r/g, '\n');
  let claudeId: string | null = null;
  let codexId: string | null = null;
  let geminiId: string | null = null;
  let piId: string | null = null;

  for (const line of cleaned.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const p = JSON.parse(trimmed) as Record<string, unknown>;
      if (!claudeId && p['type'] === 'result' && typeof p['session_id'] === 'string') claudeId = p['session_id'];
      if (!codexId && p['type'] === 'thread.started' && typeof p['thread_id'] === 'string') codexId = p['thread_id'];
      if (!geminiId && p['type'] === 'init' && typeof p['session_id'] === 'string') geminiId = p['session_id'];
      if (!piId && p['type'] === 'session' && typeof p['id'] === 'string') piId = p['id'];
    } catch {
      // not JSON, skip
    }
  }

  if (claudeId) {
    threadStore.updateThread(threadId, { claudeSessionId: claudeId });
    eventLogger.debug('thread', 'Claude session_id persisted', { threadId, sessionId: claudeId });
  }
  if (codexId) {
    threadStore.updateThread(threadId, { codexSessionId: codexId });
    eventLogger.debug('thread', 'Codex thread_id persisted', { threadId, sessionId: codexId });
  }
  if (geminiId) {
    threadStore.updateThread(threadId, { geminiSessionId: geminiId });
    eventLogger.debug('thread', 'Gemini session_id persisted', { threadId, sessionId: geminiId });
  }
  if (piId) {
    threadStore.updateThread(threadId, { piSessionId: piId });
    eventLogger.debug('thread', 'Pi session id persisted', { threadId, sessionId: piId });
  }

  return claudeId;
}

export function generateSlugFromSessionId(sessionId: string): string {
  const adjectives = [
    'amber',
    'azure',
    'brisk',
    'calm',
    'coral',
    'crisp',
    'dusky',
    'eager',
    'faint',
    'frosted',
    'gilded',
    'golden',
    'hazy',
    'ivory',
    'jade',
    'keen',
    'lemon',
    'lunar',
    'marble',
    'mellow',
    'misty',
    'moonlit',
    'mossy',
    'noble',
    'oaken',
    'pearl',
    'polar',
    'quiet',
    'rainy',
    'russet',
    'sandy',
    'silver',
    'smoky',
    'snowy',
    'solar',
    'spry',
    'stark',
    'still',
    'sunny',
    'swift',
    'tawny',
    'wispy',
    'woody',
  ];
  const actions = [
    'baking',
    'carving',
    'chasing',
    'crafting',
    'drifting',
    'farming',
    'fishing',
    'forging',
    'gliding',
    'hiking',
    'hunting',
    'leaping',
    'mending',
    'paddling',
    'sailing',
    'sketching',
    'soaring',
    'spinning',
    'trading',
    'trekking',
    'wandering',
    'weaving',
  ];
  const animals = [
    'badger',
    'bear',
    'bunny',
    'crane',
    'deer',
    'dove',
    'eagle',
    'falcon',
    'finch',
    'fox',
    'hare',
    'hawk',
    'heron',
    'jay',
    'lynx',
    'mink',
    'moose',
    'moth',
    'otter',
    'owl',
    'panda',
    'raven',
    'robin',
    'seal',
    'stag',
    'swan',
    'tiger',
    'vole',
    'wolf',
    'wren',
  ];
  const hex = sessionId.replace(/-/g, '');
  const a = parseInt(hex.slice(0, 8), 16) >>> 0;
  const b = parseInt(hex.slice(8, 16), 16) >>> 0;
  const c = parseInt(hex.slice(16, 24), 16) >>> 0;
  return [adjectives[a % adjectives.length], actions[b % actions.length], animals[c % animals.length]].join('-');
}

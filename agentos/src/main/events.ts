import { EventEmitter } from 'events';
import type { MessageAppendedEvent } from '../shared/types';
import { eventLogger } from './utils/eventLog';

// Internal main-process event bus — not exposed to renderer.
//
// Convention: when to use internalBus vs. direct callbacks
//
// Use internalBus for cross-module fire-and-forget notifications where the
// sender doesn't care who listens (zero, one, or many). Examples: a message
// was appended, a thread went idle, token usage was recorded.
//
// Use direct callbacks (constructor/method parameters) for lifecycle hooks
// where the caller needs the result, guarantees exactly one handler, or needs
// to avoid a circular import. Examples: onOutputChunk, onComplete after a PTY
// closes, startThread/sendInput passed into a manager class.
//
// Other domain emitters (councilEvents in council/service.ts,
// settingsEvents in store/index.ts) follow the same rule — they use
// EventEmitter for cross-module notifications scoped to their domain.
const _bus = new EventEmitter();

export const internalBus = {
  on: _bus.on.bind(_bus),
  off: _bus.off.bind(_bus),
  once: _bus.once.bind(_bus),
  removeAllListeners: _bus.removeAllListeners.bind(_bus),
  emit(event: string, ...args: unknown[]): void {
    for (const listener of _bus.rawListeners(event)) {
      try {
        (listener as (...a: unknown[]) => void)(...args);
      } catch (err) {
        eventLogger.error('events', `Unhandled error in listener for "${event}"`, {
          error: err instanceof Error ? (err.stack ?? err.message) : String(err),
        });
      }
    }
  },
};

// Typed emit/on helpers
export function emitMessageAppended(payload: MessageAppendedEvent): void {
  internalBus.emit('message:appended', payload);
}

export type TokenUsageEvent = {
  threadId: string;
  projectId: string;
  provider: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
};

export type ThreadIdleEvent = {
  threadId: string;
};

export function emitTokenUsage(payload: TokenUsageEvent): void {
  internalBus.emit('token:usage', payload);
}

export function emitThreadIdle(payload: ThreadIdleEvent): void {
  internalBus.emit('thread:idle', payload);
}

export type TurnActiveEvent = {
  threadId: string;
};

export function emitTurnStarted(payload: TurnActiveEvent): void {
  internalBus.emit('turn:started', payload);
}

export function emitTurnEnded(payload: TurnActiveEvent): void {
  internalBus.emit('turn:ended', payload);
}

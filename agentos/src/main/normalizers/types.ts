import type { MessageContentBlock, MessageNormalizedPayload, MessageRole, Provider } from '../../shared/types';
import type { RateLimitWindow } from '../../shared/types/analytics';

export type NormalizedMessageInput = {
  provider: Provider;
  role: MessageRole;
  text: string;
  raw?: string;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  model?: string;
};

export type NormalizedMessageResult = {
  content: string;
  normalized: MessageNormalizedPayload;
  tokenUsage?: TokenUsage;
  rateLimitWindows?: RateLimitWindow[];
};

export type ProviderNormalizer = (input: NormalizedMessageInput) => NormalizedMessageResult;

// Default Anthropic rate-limit key labels. Pass `extraLabels` to `extractRateLimitWindows`
// to add or override entries for other providers.
const RATE_LIMIT_LABELS: Record<string, string> = {
  five_hour: '5-hour',
  seven_day: '7-day',
  seven_day_opus: '7-day (Opus)',
  seven_day_sonnet: '7-day (Sonnet)',
};

/** Safely JSON-serialises an unknown value; never throws. */
export function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '[unserializable]';
  }
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function unixSecondsFrom(value: unknown): number | undefined {
  const n = numberFrom(value);
  if (n === undefined) return undefined;
  return n > 10_000_000_000 ? Math.round(n / 1000) : n;
}

function labelRateLimitWindow(key: string, extraLabels?: Record<string, string>): string {
  const labels = extraLabels ? { ...RATE_LIMIT_LABELS, ...extraLabels } : RATE_LIMIT_LABELS;
  return labels[key] ?? key.replace(/[_-]+/g, ' ');
}

export function parseRateLimitWindow(label: string, raw: unknown): RateLimitWindow | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const window = raw as Record<string, unknown>;
  const utilization = numberFrom(window.utilization);
  // Some providers report utilization as 0..1 fraction; others as 0..100 percentage.
  const utilizationAsPct = utilization !== undefined ? (utilization > 1 ? utilization : utilization * 100) : undefined;
  const usedPercentage =
    numberFrom(window.used_percentage) ??
    numberFrom(window.usedPercent) ??
    numberFrom(window.used_percent) ??
    numberFrom(window.utilization_percentage) ??
    numberFrom(window.utilizationPercent) ??
    utilizationAsPct;
  const resetsAt =
    unixSecondsFrom(window.resets_at) ??
    unixSecondsFrom(window.resetsAt) ??
    unixSecondsFrom(window.reset_at) ??
    unixSecondsFrom(window.resetAt) ??
    unixSecondsFrom(window.reset_time) ??
    unixSecondsFrom(window.resetTime);
  if (usedPercentage === undefined || resetsAt === undefined) return undefined;
  return { label, usedPercentage: Math.max(0, Math.min(100, usedPercentage)), resetsAt };
}

function unwrapRateLimitEvent(rawEvent: Record<string, unknown>): Record<string, unknown> {
  if (rawEvent.type === 'stream_event' && rawEvent.event && typeof rawEvent.event === 'object') {
    return rawEvent.event as Record<string, unknown>;
  }
  if (rawEvent.type === 'event_msg' && rawEvent.payload && typeof rawEvent.payload === 'object') {
    return rawEvent.payload as Record<string, unknown>;
  }
  return rawEvent;
}

export function extractRateLimitWindows(
  events: Array<Record<string, unknown>>,
  extraLabels?: Record<string, string>
): RateLimitWindow[] | undefined {
  for (const rawEvent of events) {
    const event = unwrapRateLimitEvent(rawEvent);
    const account =
      event.account && typeof event.account === 'object' ? (event.account as Record<string, unknown>) : {};
    const source =
      event.rate_limits ?? event.rateLimits ?? event.limits ?? event.quota ?? account.rate_limits ?? account.rateLimits;
    if (!source || typeof source !== 'object') continue;
    const windows = Object.entries(source as Record<string, unknown>).flatMap(([key, value]) => {
      const window = parseRateLimitWindow(labelRateLimitWindow(key, extraLabels), value);
      return window ? [window] : [];
    });
    if (windows.length > 0) return windows;
  }
  return undefined;
}

export function parseJsonLines(text: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim().replace(/^data:\s*/, ''); // strip SSE "data:" prefix
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        events.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Ignore non-JSON lines.
    }
  }
  return events;
}

/** Appends text to the last block if it has the same type, otherwise pushes a new block. */
export function appendBlock(blocks: MessageContentBlock[], type: 'text' | 'thinking', value: string | undefined): void {
  if (!value) return;
  const prev = blocks[blocks.length - 1];
  if (prev?.type === type) {
    prev.text += value;
  } else {
    blocks.push({ type, text: value });
  }
}

export function contentFromBlocks(blocks: MessageContentBlock[]): string {
  return blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

export function buildStreamResult(
  input: NormalizedMessageInput,
  provider: Provider,
  blocks: MessageContentBlock[],
  rawPayload: unknown
): NormalizedMessageResult {
  return {
    content: contentFromBlocks(blocks),
    normalized: {
      schemaVersion: 1,
      provider,
      role: input.role,
      blocks,
      raw: { source: 'stream_json', payload: rawPayload },
    },
  };
}

/** Iterates events and accumulates token usage. Returns undefined if both counts are zero. */
export function sumTokenUsage(
  events: Array<Record<string, unknown>>,
  check: (e: Record<string, unknown>) => {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    model?: string;
  } | null
): TokenUsage | undefined {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let model: string | undefined;
  for (const e of events) {
    const u = check(e);
    if (!u) continue;
    inputTokens += u.inputTokens ?? 0;
    outputTokens += u.outputTokens ?? 0;
    cacheReadTokens += u.cacheReadTokens ?? 0;
    cacheCreationTokens += u.cacheCreationTokens ?? 0;
    if (u.model) model = u.model;
  }
  return inputTokens === 0 && outputTokens === 0
    ? undefined
    : { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, model };
}

export function buildPlainTextResult(input: NormalizedMessageInput): NormalizedMessageResult {
  const content = input.text.trim();
  const blocks: MessageContentBlock[] = content ? [{ type: 'text', text: content }] : [];

  return {
    content,
    normalized: {
      schemaVersion: 1,
      provider: input.provider,
      role: input.role,
      blocks,
      raw: {
        source: 'plain_text',
        payload: input.raw ?? input.text,
      },
    },
  };
}

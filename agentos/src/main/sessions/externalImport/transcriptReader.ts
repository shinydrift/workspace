import type { JsonlEntry } from '../claudeInteractive/ClaudeJsonlWatcher';

/** Parse newline-delimited JSON transcript text into entries, skipping blank/partial lines. */
export function parseTranscriptLines(text: string): JsonlEntry[] {
  const entries: JsonlEntry[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      entries.push(JSON.parse(trimmed) as JsonlEntry);
    } catch {
      // incomplete or non-JSON line — skip
    }
  }
  return entries;
}

export function transcriptHasAssistant(entries: JsonlEntry[]): boolean {
  return entries.some((e) => e.type === 'assistant');
}

/**
 * Return the human-authored prompt text for a `user` entry, or null when the entry is not a
 * human turn. Claude records both human prompts and tool results as `type: 'user'`; tool-result
 * carriers (content blocks of type `tool_result`) belong to the preceding assistant turn and are
 * left for the assistant normalizer, so they return null here.
 */
export function extractHumanUserText(entry: JsonlEntry): string | null {
  if (entry.type !== 'user') return null;
  if ((entry as { isMeta?: boolean }).isMeta) return null;
  const message = entry.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (typeof content === 'string') return content.trim() || null;
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const block of content as Array<Record<string, unknown>>) {
      if (block?.type === 'tool_result') return null; // tool-result carrier, not a human turn
      if (block?.type === 'text' && typeof block.text === 'string') texts.push(block.text);
    }
    const joined = texts.join('\n').trim();
    return joined || null;
  }
  return null;
}

export interface MessageEmitterSink {
  appendUserMessage(text: string): void;
  /** rawJsonl is one or more assistant / user-tool-result entries, newline-delimited. */
  appendAssistantRaw(rawJsonl: string): void;
}

/**
 * Reduces a stream of transcript entries into AgentOS messages, preserving turn boundaries.
 *
 * Human `user` entries flush the accumulated assistant turn and emit a user message; assistant
 * entries and their interleaved tool-result carriers accumulate until the next human turn (or an
 * explicit flush) so the Claude normalizer can rebuild them into a single assistant message with
 * its tool calls. Works identically for a completed backfill and a live tail.
 */
export class TranscriptMessageEmitter {
  private assistantBuffer: string[] = [];

  constructor(private readonly sink: MessageEmitterSink) {}

  push(entry: JsonlEntry): void {
    const humanText = extractHumanUserText(entry);
    if (humanText !== null) {
      this.flush();
      this.sink.appendUserMessage(humanText);
      return;
    }
    // Assistant output, or a user entry carrying tool_result blocks → part of the assistant turn.
    if (entry.type === 'assistant' || entry.type === 'user') {
      this.assistantBuffer.push(JSON.stringify(entry));
    }
    // Everything else (system/summary/file-history/etc.) is not rendered as a chat message.
  }

  flush(): void {
    if (this.assistantBuffer.length === 0) return;
    const raw = this.assistantBuffer.join('\n') + '\n';
    this.assistantBuffer = [];
    this.sink.appendAssistantRaw(raw);
  }
}

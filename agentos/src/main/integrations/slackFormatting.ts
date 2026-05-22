/**
 * Converts common Markdown patterns to Slack mrkdwn.
 * Models often output Markdown even when instructed to use mrkdwn.
 */
export function convertMarkdownToMrkdwn(text: string): string {
  return (
    text
      // Headers: ## Heading -> *Heading*
      .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
      // Bold: **text** -> *text*
      .replace(/\*\*(.+?)\*\*/gs, '*$1*')
      // Horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, '')
      // Links: [text](url) -> <url|text>
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>')
  );
}

/** Truncates a Slack message to stay within Slack's character limit. */
export function clampSlackText(input: string, max = 39000): string {
  const trimmed = input.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

/**
 * Extracts the Final Update / Summary / Questions sections from an assistant
 * response and formats them for a Slack thread reply.
 * Returns null if none of the expected sections are present.
 */
export function buildCuratedSlackUpdate(content: string): string | null {
  const text = content.trim();
  if (!text) return null;

  const lines = text.split(/\r?\n/);
  let currentSection: 'final' | 'summary' | 'questions' | null = null;
  const sections: Record<'final' | 'summary' | 'questions', string[]> = {
    final: [],
    summary: [],
    questions: [],
  };

  // Each entry has a standalone regex (heading occupies the full line) and an inline regex
  // (heading followed by ": content") so we catch both "Final Update:\ncontent" and "Final Update: content".
  const headingMap: Array<{
    key: 'final' | 'summary' | 'questions';
    standalone: RegExp;
    inline: RegExp;
  }> = [
    {
      key: 'final',
      standalone: /^\s*(final\s+update|update)\s*:?\s*$/i,
      inline: /^\s*(final\s+update|update)\s*:\s*(.+)$/i,
    },
    { key: 'summary', standalone: /^\s*summary\s*:?\s*$/i, inline: /^\s*summary\s*:\s*(.+)$/i },
    { key: 'questions', standalone: /^\s*questions?\s*:?\s*$/i, inline: /^\s*questions?\s*:\s*(.+)$/i },
  ];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    const standaloneHeading = headingMap.find((item) => item.standalone.test(trimmed));
    if (standaloneHeading) {
      currentSection = standaloneHeading.key;
      continue;
    }
    const inlineHeading = headingMap.find((item) => item.inline.test(trimmed));
    if (inlineHeading) {
      currentSection = inlineHeading.key;
      const match = inlineHeading.inline.exec(trimmed);
      const trailing = match?.[2]?.trim();
      if (trailing) sections[currentSection].push(trailing);
      continue;
    }
    if (!currentSection) continue;
    if (!line.trim()) {
      sections[currentSection].push('');
      continue;
    }
    sections[currentSection].push(line);
  }

  const parts: string[] = [];
  if (sections.final.join('').trim()) parts.push(`Final Update:\n${sections.final.join('\n').trim()}`);
  if (sections.summary.join('').trim()) parts.push(`Summary:\n${sections.summary.join('\n').trim()}`);
  if (sections.questions.join('').trim()) parts.push(`Questions:\n${sections.questions.join('\n').trim()}`);
  if (parts.length === 0) return null;
  return clampSlackText(parts.join('\n\n'));
}

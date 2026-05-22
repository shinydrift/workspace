import crypto from 'crypto';

export function hashText(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

// 16 hex chars = 64-bit collision resistance — sufficient for content-addressed dedup at typical
// memory corpus sizes (millions of chunks would need ~4B entries to hit a 50% collision probability).
export function memoryChunkId(embedText: string): string {
  return 'memory:' + hashText(embedText);
}

export function createSnippet(text: string, query: string): string {
  const MAX = 300;

  function wordTrim(s: string): string {
    const lastSpace = s.lastIndexOf(' ');
    return (lastSpace > 0 ? s.slice(0, lastSpace) : s) + '…';
  }

  if (text.length <= MAX) return text;
  if (!query) return wordTrim(text.slice(0, MAX));

  const lowerText = text.toLowerCase();
  const queryTokens = [...new Set(query.toLowerCase().match(/[a-z0-9_]+/g) ?? [])];
  if (queryTokens.length === 0) return wordTrim(text.slice(0, MAX));

  // Build candidate window starts: one per token occurrence (offset by -80 to center it)
  const candidates: number[] = [0];
  for (const token of queryTokens) {
    let pos = 0;
    while ((pos = lowerText.indexOf(token, pos)) !== -1) {
      candidates.push(Math.max(0, pos - 80));
      pos += token.length;
    }
  }

  // Pick the window with the most distinct query-token hits
  let bestStart = 0;
  let bestCount = -1;
  for (const start of candidates) {
    const window = lowerText.slice(start, start + MAX);
    let count = 0;
    for (const token of queryTokens) {
      if (window.includes(token)) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      bestStart = start;
    }
  }

  const raw = text.slice(bestStart, bestStart + MAX);
  const trimmed = bestStart + MAX < text.length ? wordTrim(raw) : raw;
  return (bestStart > 0 ? '…' : '') + trimmed;
}

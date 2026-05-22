import AnsiToHtml from 'ansi-to-html';

export type DiffRow = { type: 'context' | 'delete' | 'add'; text: string };

function splitLines(value: string): string[] {
  if (!value) return [];
  return value.split('\n');
}

export function buildDiffRows(oldValue: string, newValue: string): DiffRow[] {
  const oldLines = splitLines(oldValue);
  const newLines = splitLines(newValue);
  const m = oldLines.length;
  const n = newLines.length;

  if (m === 0 && n === 0) return [];

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      rows.push({ type: 'context', text: oldLines[i] });
      i++;
      j++;
      continue;
    }
    if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'delete', text: oldLines[i] });
      i++;
    } else {
      rows.push({ type: 'add', text: newLines[j] });
      j++;
    }
  }
  while (i < m) {
    rows.push({ type: 'delete', text: oldLines[i] });
    i++;
  }
  while (j < n) {
    rows.push({ type: 'add', text: newLines[j] });
    j++;
  }

  return rows;
}

const ansiConverter = new AnsiToHtml({ escapeXML: true });

export function renderAnsiHtml(value: string): string {
  return ansiConverter.toHtml(value);
}

/** Unwraps MCP content-array envelope `[{type:'text',text:'...'}]` and pretty-prints inner JSON if possible. */
export function unwrapMcpResponse(raw: string): string {
  if (!raw) return raw;
  try {
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed[0]?.type === 'text' &&
      typeof parsed[0]?.text === 'string'
    ) {
      const text = parsed[0].text;
      try {
        return JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        return text;
      }
    }
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

/** Task/agent result can be a JSON array of {type:"text",text:string} blocks — extract and join. */
export function parseTaskResult(result: string): string {
  try {
    const parsed = JSON.parse(result);
    if (Array.isArray(parsed)) {
      return parsed
        .filter(
          (b): b is { type: string; text: string } =>
            !!b &&
            typeof b === 'object' &&
            (b as Record<string, unknown>).type === 'text' &&
            typeof (b as Record<string, unknown>).text === 'string'
        )
        .map((b) => b.text)
        .join('\n\n');
    }
  } catch {
    // not JSON, use as-is
  }
  return result;
}

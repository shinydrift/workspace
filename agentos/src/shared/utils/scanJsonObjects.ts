// Parse concatenated JSON objects (no newline separators) from raw text.
// Handles nested braces, strings, and escape sequences correctly.
// Returns only objects (not arrays or primitives).
export function scanJsonObjects(text: string): unknown[] {
  const objects: unknown[] = [];
  let pos = 0;
  while (pos < text.length) {
    const start = text.indexOf('{', pos);
    if (start === -1) break;
    let depth = 0,
      inString = false,
      escaped = false,
      end = -1;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    if (end === -1) break;
    try {
      const parsed = JSON.parse(text.slice(start, end));
      if (typeof parsed === 'object' && parsed !== null) objects.push(parsed);
    } catch {
      /* skip malformed chunks */
    }
    pos = end;
  }
  return objects;
}

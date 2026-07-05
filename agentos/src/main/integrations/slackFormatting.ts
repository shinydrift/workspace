const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?[\s:|-]+\|?\s*$/;
// Opening fence: leading whitespace, ``` or ~~~ (3+), then an optional info string we discard.
const FENCE_OPEN = /^([ \t]*)(`{3,}|~{3,})(.*)$/;

function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** Renders a GFM table block as a padded, code-fenced grid so columns stay aligned in Slack's monospace. */
function renderTable(block: string[]): string {
  const grid = block.filter((line) => !(TABLE_SEPARATOR.test(line) && line.includes('-'))).map(splitCells);
  const cols = Math.max(...grid.map((row) => row.length));
  const widths = Array.from({ length: cols }, (_, c) => Math.max(...grid.map((row) => (row[c] ?? '').length)));
  const body = grid
    .map((row) =>
      Array.from({ length: cols }, (_, c) => (row[c] ?? '').padEnd(widths[c]))
        .join(' | ')
        .trimEnd()
    )
    .join('\n');
  return `\`\`\`\n${body}\n\`\`\``;
}

/**
 * Rewrites GFM tables (a header row, a `|---|` separator, then body rows) into code-fenced text.
 * Slack has no table markup, so an untouched table echoes as an unreadable pipe/dash blob.
 */
function reflowTables(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const next = lines[i + 1];
    // The separator must carry a pipe, else a bare `---` horizontal rule below a pipe line reads as a table.
    if (
      TABLE_ROW.test(lines[i]) &&
      next !== undefined &&
      TABLE_SEPARATOR.test(next) &&
      next.includes('-') &&
      next.includes('|')
    ) {
      let j = i + 2;
      while (j < lines.length && TABLE_ROW.test(lines[j])) j++;
      out.push(renderTable(lines.slice(i, j)));
      i = j;
    } else {
      out.push(lines[i]);
      i += 1;
    }
  }
  return out.join('\n');
}

/** Converts a run of non-code Markdown to mrkdwn. Never invoked on fenced-code content. */
function convertTextBlock(text: string): string {
  return (
    reflowTables(text)
      // Headers: ## Heading -> *Heading*
      .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
      // Bold: **text** -> *text*
      .replace(/\*\*(.+?)\*\*/gs, '*$1*')
      // Strikethrough: ~~text~~ -> ~text~
      .replace(/~~(.+?)~~/gs, '~$1~')
      // Horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, '')
      // Bullets: "- item" / "* item" -> "• item" (Slack has no list markup)
      .replace(/^([ \t]*)[-*] +/gm, '$1• ')
      // Images: ![alt](url) -> <url|alt> (drop the leading !)
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => (alt ? `<${url}|${alt}>` : `<${url}>`))
      // Links: [text](url) -> <url|text>
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>')
  );
}

/**
 * Converts common Markdown patterns to Slack mrkdwn. Agents write standard Markdown (the Thread view
 * renders it directly); this translates it for the Slack echo, which supports only a small mrkdwn subset.
 *
 * Fenced code blocks are passed through verbatim (only the info string is dropped, which Slack ignores)
 * so the mrkdwn conversions never rewrite `-`/`#`/`~~` that are literal code content.
 */
export function convertMarkdownToMrkdwn(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(FENCE_OPEN);
    if (open) {
      const [, indent, fence] = open;
      out.push(`${indent}${fence}`); // drop the info string; keep the fence
      i += 1;
      const closeRe = new RegExp(`^[ \\t]*\\${fence[0]}{3,}[ \\t]*$`);
      while (i < lines.length && !closeRe.test(lines[i])) out.push(lines[i++]);
      if (i < lines.length) out.push(lines[i++]); // closing fence
    } else {
      const start = i;
      while (i < lines.length && !FENCE_OPEN.test(lines[i])) i += 1;
      out.push(convertTextBlock(lines.slice(start, i).join('\n')));
    }
  }
  return out.join('\n');
}

/** Truncates a Slack message to stay within Slack's character limit. */
export function clampSlackText(input: string, max = 39000): string {
  const trimmed = input.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

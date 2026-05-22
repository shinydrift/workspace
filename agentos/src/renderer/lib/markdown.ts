import DOMPurifyLib from 'dompurify';
import hljs from 'highlight.js';
import { marked } from 'marked';

const COPY_SVG =
  '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/>' +
  '<path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" stroke="currentColor" stroke-width="1.3"/>' +
  '</svg>';

marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }): string {
      const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
      const highlighted = hljs.highlight(text, { language }).value;
      const encoded = encodeURIComponent(text);
      return (
        `<div class="code-block not-prose">` +
        `<button class="copy-code-btn" data-code="${encoded}" type="button" title="Copy">${COPY_SVG}</button>` +
        `<pre><code class="hljs language-${language}">${highlighted}</code></pre>` +
        `</div>`
      );
    },
  },
});

marked.setOptions({ gfm: true, breaks: true });

const CACHE = new Map<string, string>();
const MAX_CACHE = 200;
const TRUNCATE_AT = 140_000;

const SANITIZE_TAGS = [
  'a',
  'b',
  'blockquote',
  'button',
  'code',
  'del',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  'span',
  'strong',
  'svg',
  'path',
  'rect',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
];

const SANITIZE_ATTRS = [
  'class',
  'data-code',
  'fill',
  'href',
  'rel',
  'rx',
  'stroke',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-width',
  'target',
  'type',
  'viewBox',
  'width',
  'height',
  'd',
  'x',
  'x1',
  'x2',
  'y',
  'y1',
  'y2',
  'xmlns',
];

export function renderMarkdown(text: string): string {
  const key = `${text.slice(0, 100)}:${text.length}`;
  const cached = CACHE.get(key);
  if (cached) return cached;

  const truncated = text.length > TRUNCATE_AT ? `${text.slice(0, TRUNCATE_AT)}\n...` : text;
  const html = marked.parse(truncated) as string;
  const clean = DOMPurifyLib.sanitize(html, { ALLOWED_TAGS: SANITIZE_TAGS, ALLOWED_ATTR: SANITIZE_ATTRS });

  if (CACHE.size >= MAX_CACHE) {
    const oldest = CACHE.keys().next().value;
    if (oldest) CACHE.delete(oldest);
  }
  CACHE.set(key, clean);
  return clean;
}

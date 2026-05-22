export const MEMORY_SECTION_MAX_CHARS = 1400;

export type TextChunk = { text: string; startLine: number; endLine: number; contextHeader?: string };

export function splitMemoryByDelimiters(text: string, filename: string): TextChunk[] {
  const parts = text.split(/\n---\n/);
  const chunks: TextChunk[] = [];
  let lineOffset = 1;

  for (const part of parts) {
    const lineCount = part.split('\n').length;
    const trimmed = part.trim();
    if (trimmed) {
      chunks.push({
        text: trimmed,
        startLine: lineOffset,
        endLine: lineOffset + lineCount - 1,
        contextHeader: `[${filename} > chunk ${chunks.length + 1}]`,
      });
    }
    lineOffset += lineCount + 1; // +1 for the --- separator line
  }

  return chunks.length ? chunks : [{ text: text.trim() || text, startLine: 1, endLine: text.split('\n').length }];
}

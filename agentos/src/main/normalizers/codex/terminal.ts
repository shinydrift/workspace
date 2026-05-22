const ESC = String.fromCharCode(27);
const BELL = String.fromCharCode(7);

export function expandCursorRightEscapes(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    if (input[i] !== ESC || input[i + 1] !== '[') {
      out += input[i];
      continue;
    }

    let j = i + 2;
    let digits = '';
    while (j < input.length && input[j] >= '0' && input[j] <= '9') {
      digits += input[j];
      j++;
    }
    if (digits && input[j] === 'C') {
      out += ' '.repeat(Math.max(0, Number(digits) || 0));
      i = j;
      continue;
    }

    out += input[i];
  }
  return out;
}

export function normalizeTerminalText(input: string): string {
  return (
    expandCursorRightEscapes(input)
      // Cursor-right escape sequences are used heavily by TUI UIs; convert to spaces first.
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split(BELL)
      .join('')
  );
}

export function cleanupLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .filter((line) => line.trim().length > 0);
}

export function isCodexAuthScreen(lines: string[]): boolean {
  const blob = lines.join('\n').toLowerCase();
  return blob.includes('welcome to codex') && blob.includes('sign in with') && blob.includes('press enter to continue');
}

export function filterPromptNoise(lines: string[]): string[] {
  const cleaned = [...lines];
  while (cleaned.length > 0) {
    const tail = cleaned[cleaned.length - 1]?.trim() ?? '';
    if (!tail || tail === '>' || tail === 'codex>') {
      cleaned.pop();
      continue;
    }
    break;
  }
  return cleaned;
}

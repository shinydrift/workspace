type DeriveThreadTitleOptions = {
  isSlack?: boolean;
  maxLength?: number;
};

function capitalizeFirstLetter(value: string): string {
  if (!value) {
    return value;
  }
  return value[0].toUpperCase() + value.slice(1);
}

export function deriveThreadTitleFromMessage(
  text: string | undefined | null,
  options: DeriveThreadTitleOptions = {}
): string | null {
  const maxLength = options.maxLength && options.maxLength > 0 ? options.maxLength : 100;
  let normalized = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return null;
  }

  if (options.isSlack) {
    normalized = normalized.replace(/^@ark\b[,:-]?\s*/i, '').trim();
    if (!normalized) {
      return null;
    }
  }

  const titled = capitalizeFirstLetter(normalized);
  return titled.length <= maxLength ? titled : `${titled.slice(0, maxLength - 1)}…`;
}

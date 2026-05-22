/**
 * Strip prompt-injection markers from MCP tool result text before returning to the model.
 * Targets common injection patterns used in documented MCP attack vectors (Apr 2025).
 * Treat this as defense-in-depth, not a complete security boundary.
 */
const INJECTION_MARKERS = [
  /<\/?SYSTEM>/gi,
  /<\/?INSTRUCTION>/gi,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<<\/?SYS>>/gi,
  /<system-reminder>/gi,
  /<\/system-reminder>/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /<\|tool_call\|>/gi,
];

const MAX_RESULT_BYTES = 524_288; // 512 KB

export function sanitizeToolResult(text: string): string {
  let result = text;
  for (const pattern of INJECTION_MARKERS) {
    result = result.replace(pattern, (match) => `[blocked:${match.replace(/[<>[\]/|]/g, '')}]`);
  }
  if (Buffer.byteLength(result, 'utf8') > MAX_RESULT_BYTES) {
    result = Buffer.from(result, 'utf8').subarray(0, MAX_RESULT_BYTES).toString('utf8');
    result += '\n[truncated: response exceeded MCP tool size limit]';
  }
  return result;
}

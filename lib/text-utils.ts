/**
 * Normalizes line breaks, strips C0 control characters (except tab/newline), and
 * collapses runs of 3+ newlines to two. Used for raw transcript and streamed summary text.
 */
export function sanitizeMultilineText(s: string): string {
  if (!s) return s;
  return s
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

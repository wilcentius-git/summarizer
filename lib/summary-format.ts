/**
 * Post-processing for summary output.
 * Enforces word limits on Ringkasan Eksekutif and Insight tambahan.
 */

const RINGKASAN_EKSEKUTIF_MARKER = "**Ringkasan Eksekutif:**";
const RANGKUMAN_MARKER = "**Rangkuman";
const INSIGHT_MARKER = "**Insight tambahan:**";

/** Truncate text to at most maxWords, ending at a sentence boundary when possible. */
function truncateToWords(text: string, maxWords: number): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const words = trimmed.split(/\s+/);
  if (words.length <= maxWords) return trimmed;
  const truncated = words.slice(0, maxWords).join(" ");
  const lastPeriod = truncated.lastIndexOf(".");
  if (lastPeriod > truncated.length * 0.5) {
    return truncated.slice(0, lastPeriod + 1).trim();
  }
  return truncated.trim();
}

/** Extract content between two markers (exclusive of markers). */
function extractBetween(
  text: string,
  startMarker: string,
  endMarkerPattern: RegExp
): { content: string; startIdx: number; endIdx: number } | null {
  const startIdx = text.indexOf(startMarker);
  if (startIdx === -1) return null;
  const contentStart = startIdx + startMarker.length;
  const afterMarker = text.slice(contentStart);
  const match = afterMarker.match(endMarkerPattern);
  const endIdx = match?.index ?? -1;
  const contentEnd = endIdx >= 0 ? contentStart + endIdx : text.length;
  const content = text.slice(contentStart, contentEnd).trim();
  return { content, startIdx, endIdx: contentEnd };
}

/** Extract content from a marker to end of text. */
function extractFromMarkerToEnd(text: string, marker: string): { content: string; startIdx: number } | null {
  const startIdx = text.indexOf(marker);
  if (startIdx === -1) return null;
  const contentStart = startIdx + marker.length;
  const content = text.slice(contentStart).trim();
  return { content, startIdx };
}

/**
 * Ensure blank line between section headers and body content for ReactMarkdown.
 * Fixes preview spacing to match PDF (single \n → \n\n after section titles).
 */
export function ensureBlankLineAfterSections(text: string): string {
  if (!text?.trim()) return text;
  return text
    .replace(/(\*\*Ringkasan Eksekutif\*\*:?)\s*\n(?!\n)/g, "$1\n\n")
    .replace(/(\*\*Rangkuman\s*:?\s*\*\*)\s*\n(?!\n)/g, "$1\n\n")
    .replace(/(\*\*Insight tambahan\*\*:?)\s*\n(?!\n)/g, "$1\n\n")
    .replace(/(\*\*Ringkasan Eksekutif\*\*:?)\s+([^\n]+)/g, "$1\n\n$2")
    .replace(/(\*\*Rangkuman\s*:?\s*\*\*)\s+([^\n]+)/g, "$1\n\n$2")
    .replace(/(\*\*Insight tambahan\*\*:?)\s+([^\n]+)/g, "$1\n\n$2");
}

/**
 * Truncate Ringkasan Eksekutif and Insight tambahan to maxWords.
 * Only applies to "Dokumen Bukan Rapat" format (has these sections).
 */
export function truncateSummarySections(text: string, maxWords = 40): string {
  if (!text?.trim()) return text;

  let result = text;

  const hasRingkasan = result.includes(RINGKASAN_EKSEKUTIF_MARKER);
  const hasRangkuman = result.includes(RANGKUMAN_MARKER);
  const hasInsight = result.includes(INSIGHT_MARKER);

  if (!hasRingkasan || !hasInsight) return result;

  if (hasRingkasan && hasRangkuman) {
    const ringkasanMatch = extractBetween(
      result,
      RINGKASAN_EKSEKUTIF_MARKER,
      /\n\s*\*\*Rangkuman\s*:?\s*\*\*/
    );
    if (ringkasanMatch) {
      const truncated = truncateToWords(ringkasanMatch.content, maxWords);
      const before = result.slice(0, ringkasanMatch.startIdx + RINGKASAN_EKSEKUTIF_MARKER.length);
      const after = result.slice(ringkasanMatch.endIdx);
      const newContent = `\n\n${truncated}\n\n`;
      result = before + newContent + after;
    }
  }

  const insightMatch = extractFromMarkerToEnd(result, INSIGHT_MARKER);
  if (insightMatch) {
    const truncated = truncateToWords(insightMatch.content, maxWords);
    const before = result.slice(0, insightMatch.startIdx + INSIGHT_MARKER.length);
    const newContent = `\n\n${truncated}`;
    result = before + newContent;
  }

  return result;
}

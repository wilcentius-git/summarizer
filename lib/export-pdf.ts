/**
 * PDF export utilities for summary content.
 * Preserves bold (**text**) and improves line spacing.
 */

import type jsPDF from "jspdf";

/** Strip markdown except **bold** - we preserve bold for PDF rendering. */
export function prepareContentForPdf(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^#+\s*/gm, "")
    .replace(/^(\s*)[-*]\s+/gm, "$1• ")
    .replace(/(:\*\*)\s*\n+/g, "$1 ");
}

/** Split text into segments alternating between normal and bold (from **...**). */
function splitBoldSegments(line: string): { text: string; bold: boolean }[] {
  const parts = line.split(/\*\*(.+?)\*\*/);
  const segments: { text: string; bold: boolean }[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].length > 0) {
      segments.push({ text: parts[i], bold: i % 2 === 1 });
    }
  }
  return segments;
}

/** Render content with bold and improved spacing. Returns final y position. */
export function renderPdfContent(
  doc: jsPDF,
  content: string,
  opts: {
    margin: number;
    maxWidth: number;
    lineHeight: number;
    paragraphSpacing: number;
    headingSpacing: number;
    maxY: number;
    startY: number;
    fontSize: number;
  }
): number {
  const {
    margin,
    maxWidth,
    lineHeight,
    paragraphSpacing,
    headingSpacing,
    maxY,
    startY,
    fontSize,
  } = opts;

  let y = startY;
  const lines = content.split("\n");

  const addPageIfNeeded = () => {
    if (y > maxY) {
      doc.addPage();
      y = opts.margin;
    }
  };

  const drawSegment = (
    text: string,
    bold: boolean,
    x: number
  ): { nextX: number; nextY: number } => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(fontSize);

    let drawX = x;
    let availableWidth = maxWidth - (x - margin);

    if (availableWidth <= 10) {
      drawX = margin;
      availableWidth = maxWidth;
      y += lineHeight;
      addPageIfNeeded();
    }

    const wrapped = doc.splitTextToSize(text, availableWidth);

    if (wrapped.length === 0) return { nextX: drawX, nextY: y };

    doc.text(wrapped[0], drawX, y);
    const firstLineWidth = doc.getTextDimensions(wrapped[0]).w;
    let nextX = drawX + firstLineWidth;
    let nextY = y;

    for (let i = 1; i < wrapped.length; i++) {
      nextY += lineHeight;
      if (nextY > maxY) {
        doc.addPage();
        nextY = opts.margin;
      }
      doc.text(wrapped[i], margin, nextY);
      nextX = margin;
    }
    y = nextY;
    return { nextX, nextY };
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === "") {
      y += paragraphSpacing;
      addPageIfNeeded();
      continue;
    }

    const segments = splitBoldSegments(line);
    if (segments.length === 0) continue;

    let x = margin;
    for (const seg of segments) {
      addPageIfNeeded();
      const { nextX, nextY } = drawSegment(seg.text, seg.bold, x);
      x = nextX;
      y = nextY;
    }

    y += lineHeight;

    const isHeading =
      !!line.match(/^(\*\*[^*]+\*\*\s*)+:?\s*$/) ||
      !!(line.match(/^\d+\.\s*\*\*[^*]+\*\*:?\s*$/) && line.length < 80);
    if (isHeading) {
      y += headingSpacing;
    }
  }

  return y;
}

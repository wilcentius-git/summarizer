/**
 * PDF export utilities for summary content.
 * Preserves bold (**text**) and improves line spacing.
 */

import type jsPDF from "jspdf";
import { sanitizeMultilineText } from "@/lib/text-utils";

/** Strip markdown except **bold** - we preserve bold for PDF rendering. */
export function prepareContentForPdf(text: string): string {
  return sanitizeMultilineText(text)
    .replace(/^#+\s*/gm, "")
    .replace(/^(\s*)[-*]\s+/gm, "$1• ")
    .replace(/(:\*\*)\s*\n+/g, "$1 ")
    .replace(/≈/g, "sekitar")
    .replace(/→/g, "->")
    .replace(/×/g, "x")
    .replace(/±/g, "+/-")
    .replace(/÷/g, ":");
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
  let currentFontSize = fontSize;
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
    x: number,
    hangingIndent: number = margin
  ): { nextX: number; nextY: number } => {
    doc.setFont("NotoSans", bold ? "bold" : "normal");
    doc.setFontSize(currentFontSize);

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
      doc.setFont("NotoSans", bold ? "bold" : "normal");
      doc.setFontSize(currentFontSize);
      doc.text(wrapped[i], hangingIndent, nextY);
      nextX = hangingIndent + doc.getTextDimensions(wrapped[i]).w;
    }
    y = nextY;
    return { nextX, nextY };
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === "") {
      let prevNonEmpty: string | null = null;
      for (let j = i - 1; j >= 0; j--) {
        if (lines[j].trim() !== "") {
          prevNonEmpty = lines[j];
          break;
        }
      }
      let nextNonEmpty: string | null = null;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() !== "") {
          nextNonEmpty = lines[j];
          break;
        }
      }
      const betweenNumberedItems =
        prevNonEmpty !== null &&
        nextNonEmpty !== null &&
        /^\d+\.\s/.test(prevNonEmpty) &&
        /^\d+\.\s/.test(nextNonEmpty);
      if (!betweenNumberedItems) {
        y += paragraphSpacing;
        addPageIfNeeded();
      } else {
        y += 2;
      }
      continue;
    }

    const isHeading =
      !!line.match(/^(\*\*[^*]+\*\*\s*)+:?\s*$/) ||
      !!(line.match(/^\d+\.\s*\*\*[^*]+\*\*:?\s*$/) && line.length < 80);
    if (isHeading) {
      currentFontSize = fontSize + 2;
      doc.setFontSize(fontSize + 2);
    }

    const numberedMatch = line.match(/^(\d+\.\s)(.*)$/);
    let x = margin;
    let hangingIndent = margin;
    let segments: { text: string; bold: boolean }[];

    if (numberedMatch) {
      const prefix = numberedMatch[1];
      addPageIfNeeded();
      doc.setFont("NotoSans", "normal");
      doc.setFontSize(currentFontSize);
      doc.text(prefix, margin + 4, y);
      x = margin + 4 + doc.getTextDimensions(prefix).w;
      hangingIndent = margin + 4 + doc.getTextDimensions(prefix).w;
      segments = splitBoldSegments(numberedMatch[2]);
    } else {
      segments = splitBoldSegments(line);
    }

    if (segments.length === 0) continue;
    for (const seg of segments) {
      addPageIfNeeded();
      const { nextX, nextY } = numberedMatch
        ? drawSegment(seg.text, seg.bold, x, hangingIndent)
        : drawSegment(seg.text, seg.bold, x);
      x = nextX;
      y = nextY;
    }

    if (isHeading) {
      currentFontSize = fontSize;
      doc.setFontSize(fontSize);
    }

    y += lineHeight;

    if (isHeading) {
      y += headingSpacing;
    }
  }

  return y;
}

/**
 * One-column A4 PDF with a standard header (Dokumen, Tanggal dibuat) and body
 * from {@link renderPdfContent}. Returns `null` when `text` is empty.
 * Uses a dynamic `jspdf` import for client-friendly bundling.
 */
export async function buildJobPdf(
  text: string,
  filename: string
): Promise<jsPDF | null> {
  if (!text) return null;

  const dateStr = new Date().toLocaleString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const content = prepareContentForPdf(text);
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const toBinaryString = (buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return binary;
  };

  const regularResponse = await fetch("/fonts/NotoSans-Regular.ttf");
  const regularBase64 = toBinaryString(await regularResponse.arrayBuffer());
  doc.addFileToVFS("NotoSans-Regular.ttf", regularBase64);
  doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");

  const boldResponse = await fetch("/fonts/NotoSans-Bold.ttf");
  const boldBase64 = toBinaryString(await boldResponse.arrayBuffer());
  doc.addFileToVFS("NotoSans-Bold.ttf", boldBase64);
  doc.addFont("NotoSans-Bold.ttf", "NotoSans", "bold");

  doc.setFont("NotoSans", "normal");

  const margin = 20;
  const maxWidth = 210 - margin * 2;
  const lineHeight = 6;
  const paragraphSpacing = 4;
  const headingSpacing = 0;
  const pageHeight = 297;
  const maxY = pageHeight - margin;

  let y = margin;

  doc.setFont("NotoSans", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);

  const headerMaxW = maxWidth - 20;
  const titleText = `Dokumen: ${filename}`;
  const titleLineCount = doc.splitTextToSize(titleText, headerMaxW).length;
  doc.text(titleText, margin, y, { maxWidth: headerMaxW });
  y += titleLineCount * lineHeight;

  doc.text(`Tanggal dibuat: ${dateStr}`, margin, y);
  y += lineHeight;
  y += 4;

  doc.setTextColor(0, 0, 0);
  renderPdfContent(doc, content, {
    margin,
    maxWidth,
    lineHeight,
    paragraphSpacing,
    headingSpacing,
    maxY,
    startY: y,
    fontSize: 11,
  });

  return doc;
}

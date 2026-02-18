/**
 * Extracts plain text from various document formats.
 * Supports: PDF, DOCX, TXT, RTF, ODT
 */

import { pdfPagesToImages, type PdfPageImage } from "@/lib/pdf-to-images";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse");

export const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/msword", // .doc (older Word)
  "text/plain",
  "application/rtf",
  "text/rtf",
  "application/vnd.oasis.opendocument.text", // .odt
] as const;

export const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".doc", ".txt", ".rtf", ".odt"] as const;

export type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

export function isSupportedMimeType(mime: string): mime is SupportedMimeType {
  return SUPPORTED_MIME_TYPES.includes(mime as SupportedMimeType);
}

export function isSupportedFileName(name: string): boolean {
  const ext = name.toLowerCase().slice(name.lastIndexOf("."));
  return SUPPORTED_EXTENSIONS.includes(ext as (typeof SUPPORTED_EXTENSIONS)[number]);
}

const EXT_TO_MIME: Record<string, SupportedMimeType> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".txt": "text/plain",
  ".rtf": "application/rtf",
  ".odt": "application/vnd.oasis.opendocument.text",
};

/** Resolve MIME type, inferring from filename when type is generic. */
export function resolveMimeType(mimeType: string, fileName?: string): string {
  if (isSupportedMimeType(mimeType)) return mimeType;
  if (fileName) {
    const ext = fileName.toLowerCase().slice(fileName.lastIndexOf("."));
    const inferred = EXT_TO_MIME[ext];
    if (inferred) return inferred;
  }
  return mimeType;
}

function extractTextFromTxt(buffer: Buffer): string {
  return buffer.toString("utf-8");
}

async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? "";
}

function extractTextFromRtf(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const parse = require("rtf-parser");
    const str = buffer.toString("utf-8");
    parse.string(str, (err: Error | null, doc: { content?: Array<{ content?: Array<{ value?: string }> }> }) => {
      if (err) {
        reject(err);
        return;
      }
      let text = "";
      for (const para of doc?.content ?? []) {
        for (const span of para?.content ?? []) {
          if (span?.value) text += span.value;
        }
        text += "\n\n";
      }
      resolve(text.trim());
    });
  });
}

function extractTextFromOdt(buffer: Buffer): string {
  const AdmZip = require("adm-zip");
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry("content.xml");
  if (!entry) return "";
  const xml = entry.getData().toString("utf-8");
  // Strip XML tags and decode entities for plain text
  const text = xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return data?.text ?? "";
}

export type ExtractTextOptions = {
  /** For PDF: fallback to OCR when text extraction yields little. Requires apiKey for Groq Vision. */
  ocrFallback?: (images: PdfPageImage[]) => Promise<string>;
};

/**
 * Extract plain text from a document buffer based on MIME type.
 */
export async function extractText(
  buffer: Buffer,
  mimeType: string,
  options?: ExtractTextOptions
): Promise<string> {
  let text = "";

  switch (mimeType) {
    case "text/plain":
      text = extractTextFromTxt(buffer);
      break;
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/msword":
      text = await extractTextFromDocx(buffer);
      break;
    case "application/rtf":
    case "text/rtf":
      text = await extractTextFromRtf(buffer);
      break;
    case "application/vnd.oasis.opendocument.text":
      text = extractTextFromOdt(buffer);
      break;
    case "application/pdf":
      text = await extractTextFromPdf(buffer);
      // PDF: optional OCR fallback for scanned documents
      if (options?.ocrFallback && (!text.trim() || text.length < 50)) {
        try {
          const images = await pdfPagesToImages(buffer, { maxPages: 20 });
          if (images.length > 0) {
            text = await options.ocrFallback(images);
          }
        } catch {
          // Keep original (possibly empty) text
        }
      }
      break;
    default:
      // Try to detect by file signature / extension as fallback
      if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
        // ZIP signature - could be DOCX or ODT
        if (buffer.toString("utf-8", 0, 100).includes("word/")) {
          text = await extractTextFromDocx(buffer);
        } else {
          text = extractTextFromOdt(buffer);
        }
      } else if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
        text = await extractTextFromPdf(buffer);
      } else if (buffer.toString("utf-8", 0, 10).includes("{\\rtf")) {
        text = await extractTextFromRtf(buffer);
      } else {
        text = extractTextFromTxt(buffer);
      }
  }

  return text;
}

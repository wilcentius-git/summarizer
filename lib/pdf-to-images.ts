/**
 * Converts PDF pages to images for OCR/vision processing.
 * Uses pdf-to-img (pdfjs with proper canvas factory) to avoid multi-page rendering bugs.
 */

const MAX_PAGES = 20;
const SCALE = 3; // Higher resolution for better OCR of small text in diagrams/tables

export type PdfPageImage = {
  pageNum: number;
  base64: string;
};

export async function pdfPagesToImages(
  buffer: Buffer,
  options?: { maxPages?: number; scale?: number }
): Promise<PdfPageImage[]> {
  const { pdf } = await import("pdf-to-img");
  const maxPages = options?.maxPages ?? MAX_PAGES;

  const results: PdfPageImage[] = [];
  let pageNum = 0;

  const document = await pdf(buffer, { scale: options?.scale ?? SCALE });
  const pageLimit = Math.min(document.length, maxPages);

  for await (const imageBuffer of document) {
    pageNum += 1;
    if (pageNum > pageLimit) break;

    const dataUrl = `data:image/png;base64,${imageBuffer.toString("base64")}`;
    results.push({ pageNum, base64: dataUrl });
  }

  return results;
}

/**
 * Converts PDF pages to JPEG images for OCR/vision processing.
 * Uses pdfjs-dist + canvas (Node.js compatible).
 */

import { createCanvas } from "@napi-rs/canvas/node-canvas";

const MAX_PAGES = 20;
const SCALE = 3; // Higher resolution for better OCR of small text in diagrams/tables
const JPEG_QUALITY = 0.85;

export type PdfPageImage = {
  pageNum: number;
  base64: string;
};

export async function pdfPagesToImages(
  buffer: Buffer,
  options?: { maxPages?: number; scale?: number }
): Promise<PdfPageImage[]> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "";

  const maxPages = options?.maxPages ?? MAX_PAGES;
  const scale = options?.scale ?? SCALE;

  const data = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
  });

  const pdfDocument = await loadingTask.promise;
  const numPages = Math.min(pdfDocument.numPages, maxPages);
  const results: PdfPageImage[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDocument.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext("2d");

    const renderTask = page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    });
    await renderTask.promise;

    const imageBuffer = canvas.toBuffer("image/jpeg", { quality: JPEG_QUALITY });
    const base64 = imageBuffer.toString("base64");
    const dataUrl = `data:image/jpeg;base64,${base64}`;

    results.push({ pageNum: i, base64: dataUrl });
  }

  return results;
}

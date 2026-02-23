/**
 * Shared Groq API utilities for OCR and document processing.
 * Used by both /api/summarize and /api/summarize-meeting.
 */

import type { PdfPageImage } from "@/lib/pdf-to-images";

export const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB
export const MAX_TEXT_LENGTH = 30000;
export const GROQ_IMAGES_PER_REQUEST = 1;
export const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
export const GROQ_MODEL = "llama-3.1-8b-instant";
export const GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

export async function callVisionApi(
  images: PdfPageImage[],
  prompt: string,
  apiKey: string
): Promise<string> {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [{ type: "text", text: prompt }];
  for (const img of images) {
    content.push({ type: "image_url", image_url: { url: img.base64 } });
  }

  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_VISION_MODEL,
      messages: [{ role: "user", content }],
      max_tokens: 8192,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Groq Vision error: ${res.status}. ${errBody}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

export async function extractTextFromImages(
  images: PdfPageImage[],
  apiKey: string,
  totalPages: number
): Promise<string> {
  const pageLabel =
    images.length === 1
      ? ` Ini Halaman ${images[0].pageNum} dari ${totalPages}.`
      : "";
  const mainPrompt =
    `Ekstrak SEMUA teks dari gambar halaman PDF ini.${pageLabel}
WAJIB berikan output untuk halaman ini - jangan kembalikan kosong.
Prioritaskan konten utama (badan dokumen). Abaikan header/footer/kop surat yang berulang.
Jika ada bagan, diagram, tabel, atau flowchart: ekstrak semua teks dan label, jelaskan strukturnya.
Pertahankan urutan. Kembalikan sebagai teks biasa dalam Bahasa Indonesia.`;

  let extracted = await callVisionApi(images, mainPrompt, apiKey);

  if (!extracted.trim() && images.length === 1) {
    const fallbackPrompt = `Deskripsikan SEMUA yang terlihat di halaman PDF ini (Halaman ${images[0].pageNum} dari ${totalPages}). Sertakan teks, label, elemen bagan/diagram/tabel. Tulis dalam Bahasa Indonesia. WAJIB berikan deskripsi - jangan kosong.`;
    extracted = await callVisionApi(images, fallbackPrompt, apiKey);
  }

  return extracted;
}

/**
 * Creates an OCR fallback function for extractText.
 * Processes PDF pages via Vision API and returns concatenated text with page markers.
 */
export function createOcrFallback(apiKey: string) {
  return async (images: PdfPageImage[]): Promise<string> => {
    const chunks: string[] = [];
    const totalPages = images.length;
    for (let i = 0; i < images.length; i += GROQ_IMAGES_PER_REQUEST) {
      const batch = images.slice(i, i + GROQ_IMAGES_PER_REQUEST);
      const extracted = await extractTextFromImages(batch, apiKey, totalPages);
      const pageNum = batch[0].pageNum;
      chunks.push(
        extracted.trim()
          ? `[Halaman ${pageNum}]\n${extracted}`
          : `[Halaman ${pageNum}]\n(Konten halaman ini tidak dapat diekstrak.)`
      );
    }
    return chunks.join("\n\n");
  };
}

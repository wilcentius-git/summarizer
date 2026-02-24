/**
 * Shared Groq API utilities for OCR and document processing.
 * Used by both /api/summarize and /api/summarize-meeting.
 */

import type { PdfPageImage } from "@/lib/pdf-to-images";

export const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB
export const MAX_TEXT_LENGTH = 30000;
/** Chunk size for summarization (~2000 tokens). Keeps requests under Groq TPM limit. */
export const SUMMARIZE_CHUNK_SIZE = 8000;
/** Delay between chunk requests to avoid Groq TPM rate limit (429). */
export const SUMMARIZE_CHUNK_DELAY_MS = 2500;
export const GROQ_IMAGES_PER_REQUEST = 1;

/**
 * Splits text into chunks at natural boundaries (paragraph, line, sentence).
 * Each chunk stays under maxSize to fit within API token limits.
 */
export function splitIntoChunks(text: string, maxSize: number): string[] {
  if (text.length <= maxSize) return [text.trim()];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxSize) {
      chunks.push(remaining.trim());
      break;
    }
    const segment = remaining.slice(0, maxSize);
    let breakPoint = -1;
    const minBreak = maxSize * 0.5;
    for (const sep of ["\n\n", "\n", ". ", " "]) {
      const idx = segment.lastIndexOf(sep);
      if (idx >= minBreak) {
        breakPoint = idx + sep.length;
        break;
      }
    }
    if (breakPoint <= 0) breakPoint = maxSize;
    chunks.push(remaining.slice(0, breakPoint).trim());
    remaining = remaining.slice(breakPoint).trim();
  }
  return chunks.filter((c) => c.length > 0);
}

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

const SUMMARIZE_PROMPT = `Anda adalah asisten yang merangkum dokumen. Aturan:
- Tulis rangkuman dalam Bahasa Indonesia.
- Istilah teknis (misalnya: API, PDF, database, framework, dll.) tetap gunakan istilah aslinya, jangan diterjemahkan.
- Awali rangkuman dengan kalimat deskripsi dokumen, contoh: "Dokumen ini berisi hal tentang [topik utama dokumen]."
- Setelah itu, lanjutkan dengan poin-poin penting secara ringkas.
- PENTING: Gunakan konten dari SEMUA halaman dokumen (Halaman 1 sampai terakhir). Jangan hanya merangkum halaman terakhir - sertakan poin penting dari halaman awal dan tengah.
- Jangan hanya menyatakan kesimpulan abstrak. Berikan contoh konkret dari dokumen yang mendukung kesimpulan itu.
- Jaga struktur dan poin kunci. Tanpa pembukaan lain, langsung rangkuman saja.

Dokumen:

`;

const SUMMARIZE_CHUNK_PROMPT = `Rangkum bagian berikut secara ringkas dalam Bahasa Indonesia. Fokus pada poin-poin penting. Tanpa pembukaan, langsung rangkuman saja.

Bagian:

`;

const SUMMARIZE_MERGE_PROMPT = `Gabungkan rangkuman berikut menjadi satu rangkuman koheren dalam Bahasa Indonesia. Awali dengan kalimat deskripsi singkat tentang topik utama, lalu poin-poin penting. Hindari pengulangan. Tanpa pembukaan lain, langsung rangkuman saja.

Rangkuman per bagian:

`;

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Parse "try again in X.XXs" from Groq 429 error. Returns ms to wait, or default. */
function parseRetryAfterMs(errBody: string, defaultMs: number): number {
  const match = errBody.match(/try again in ([\d.]+)s/i);
  if (match) {
    const sec = parseFloat(match[1]);
    return Math.ceil(sec * 1000) + 1000;
  }
  return defaultMs;
}

export async function summarizeWithGroq(
  content: string,
  apiKey: string,
  options?: { isChunk?: boolean; isMerge?: boolean }
): Promise<string> {
  const prompt = options?.isMerge
    ? SUMMARIZE_MERGE_PROMPT + content
    : options?.isChunk
      ? SUMMARIZE_CHUNK_PROMPT + content
      : SUMMARIZE_PROMPT + content;

  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1024,
        temperature: 0.3,
      }),
    });

    if (res.ok) {
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return json.choices?.[0]?.message?.content?.trim() ?? "";
    }

    const errBody = await res.text();
    lastError = new Error(`Groq API error: ${res.status}. ${errBody}`);

    if (res.status === 429 && attempt < maxRetries - 1) {
      const waitMs = parseRetryAfterMs(errBody, 20000);
      await sleep(waitMs);
      continue;
    }

    throw lastError;
  }

  throw lastError ?? new Error("Summarization failed.");
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

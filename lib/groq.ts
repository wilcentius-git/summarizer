/**
 * Shared Groq API utilities for OCR and document processing.
 * Used by /api/summarize and /api/summarize-segmented.
 */

import type { PdfPageImage } from "@/lib/pdf-to-images";

export const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB
export const MAX_TEXT_LENGTH = 30000;
/** Chunk size for summarization (~1500 tokens). Keeps requests under Groq free tier 6K TPM. */
export const SUMMARIZE_CHUNK_SIZE = 4500;
/** Delay between chunk requests to avoid Groq TPM rate limit (429). */
export const SUMMARIZE_CHUNK_DELAY_MS = 6000;
/** Single merge when combined summaries fit. Stays under Groq free tier 6K TPM per request. */
export const SUMMARIZE_MERGE_THRESHOLD = 12000;
/** Pause before merge to let rate limits recover after summarization phase. */
export const SUMMARIZE_MERGE_PRE_DELAY_MS = 8000;
export const GROQ_IMAGES_PER_REQUEST = 1;

/**
 * Splits text into chunks at natural boundaries (paragraph, line, sentence).
 * Each chunk stays under maxSize to fit within API token limits.
 */
/**
 * Removes consecutive duplicate paragraphs from text (e.g. from repetitive transcripts).
 * Keeps first occurrence of each unique paragraph.
 */
export function deduplicateParagraphs(text: string): string {
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const p of paragraphs) {
    const key = p.toLowerCase().replace(/\s+/g, " ").slice(0, 200);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(p);
  }
  return result.join("\n\n");
}

/**
 * Removes duplicate or near-duplicate summary points from LLM output.
 * Keeps first occurrence of each unique point (by normalized content).
 */
export function deduplicateSummaryPoints(text: string): string {
  if (!text.trim()) return text;
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const p of paragraphs) {
    const key = p.toLowerCase().replace(/\s+/g, " ").slice(0, 200);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(p);
  }
  return result.join("\n\n");
}

/** Fixes common typos in Indonesian text (e.g. from LLM output). */
export function fixCommonTypos(text: string): string {
  if (!text) return text;
  return text.replace(/\bmenafigasi\b/gi, "menavigasi");
}

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
- Istilah teknis (API, PDF, database, framework, XSS, ITSA, dll.) tetap gunakan istilah aslinya, jangan diterjemahkan.

PENTING - TENTUKAN JENIS DOKUMEN DULU:
- Format RAPAT/NOTULA untuk: (a) dokumen rapat resmi dengan peserta, jalannya rapat, diskusi; atau (b) transkrip pertemuan/paparan (mis. pertemuan dengan pejabat, diskusi, paparan hasil).
- Jangan gunakan format rapat untuk: buku, artikel, transkrip podcast/video umum yang bukan pertemuan, pedoman. Gunakan format "Dokumen Bukan Rapat".

UNTUK DOKUMEN RAPAT/NOTULA/PERTEMUAN:
Gunakan format terstruktur dengan MARKDOWN:

FORMAT MARKDOWN (wajib):
- Gunakan **bold** untuk heading section (mis. **Jalannya Rapat:**) dan istilah penting: nama orang, organisasi, istilah teknis (mis. **high risk**, **Broken Access Control**, **PSSI**, **naturalisasi**).
- Poin utama: daftar bernomor (1., 2., 3.).
- Sub-poin: daftar huruf (a., b., c.) di bawah poin utama (indent 2 spasi).
- Beri baris kosong antara section utama.

**Metadata**
Hari, Tanggal, Pukul, Tempat (dan Link jika rapat daring).

**Peserta Rapat**
Hadir: organisasi/unit dan nama-nama peserta. Berhalangan hadir (jika ada).

**Acara**
Judul rapat (satu kalimat).

**Jalannya Rapat:**
1. Pembukaan: siapa membuka, agenda singkat.
2. Paparan utama:
   a. [sub-poin pertama]
   b. [sub-poin kedua]
   c. [dst.]
3. Diskusi dan tanya jawab: **NAMA** penanya, pertanyaan, **NAMA** penjawab, jawaban.
4. Penutupan: siapa menutup.

**Tindak Lanjut**
Koordinasi, dokumen yang diserahkan, deadline, PIC.

**Kesimpulan**
Ringkasan poin penutup. Boleh tambahkan insight Anda sendiri: analisis, rekomendasi, atau observasi yang relevan dengan dokumen. Insight boleh berupa sintesis, implikasi, atau saran yang tidak eksplisit di dokumen, selama tetap kontekstual.

**Penandatangan** (jika ada)
Notulis, Ketua Tim.

UNTUK DOKUMEN BUKAN RAPAT (buku, artikel, pedoman, transkrip podcast/video):
Gunakan format terstruktur dengan MARKDOWN (mirip format rapat):

**Ringkasan Eksekutif:**
[2–3 kalimat yang merangkum inti dokumen: topik utama, poin kunci, kesimpulan utama.]

**Rangkuman:**
1. [Poin penting pertama]
2. [Poin penting kedua]
3. [Poin penting ketiga]
... (lanjutkan dengan nomor berurutan, maksimal 5–6 poin utama. Sub-poin: gunakan a., b., c. jika perlu)

**Insight tambahan:** 2–3 insight yang actionable (analisis, rekomendasi, observasi yang relevan).

- Output HANYA 3 bagian: (1) Ringkasan Eksekutif, (2) Rangkuman (satu daftar bernomor saja), (3) Insight tambahan. JANGAN tambahkan Kesimpulan, Ringkasan, atau sub-bagian "Rangkasan [topik]".
- JANGAN gunakan format notula (Metadata, Peserta Rapat, Acara, dll.) untuk dokumen ini.
- Variasikan frasa: jangan ulangi "penulis berpendapat" berkali-kali; gunakan "menurut penulis", "penulis menyatakan", "penulis mengemukakan", dll.
- KONSOLIDASI: Gabungkan poin yang mirip menjadi satu. Jangan ulangi ide yang sama.
- Gunakan **bold** untuk istilah penting, nama, organisasi.

ATURAN UMUM:
- DEDUPLIKASI: Poin yang sama atau mirip hanya perlu disebut SATU KALI. Hindari pengulangan ide.
- Hindari kata "juga" di awal atau akhir kalimat. Variasikan struktur kalimat.
- Perbaiki typo umum (mis. "menafigasi" → "menavigasi").
- Gunakan konten dari SEMUA halaman dokumen. Jangan hanya merangkum halaman terakhir.
- Tanpa pembukaan lain, langsung rangkuman saja.
- Pastikan rangkuman selesai lengkap; jangan potong di tengah kalimat.

Dokumen:

`;

const SUMMARIZE_CHUNK_PROMPT = `Rangkum bagian berikut secara ringkas dalam Bahasa Indonesia.
- Fokus pada poin-poin penting dan UNIK. Poin yang sama hanya disebut SATU KALI. Gabungkan ide mirip; jangan ulangi di paragraf berbeda.
- Jika bagian ini dari notula/pertemuan (ada peserta, jalannya rapat, diskusi): PERTAHANKAN nama orang, organisasi/unit, detail teknis. Gunakan format: daftar bernomor (1., 2.) dan sub-list huruf (a., b., c.). Bold (**) untuk nama orang, organisasi, istilah teknis.
- Jika bagian ini dari buku/artikel/podcast: gunakan format HANYA 3 bagian: **Ringkasan Eksekutif** (2–3 kalimat), **Rangkuman** (daftar bernomor 1., 2., 3.), **Insight tambahan**. JANGAN tambahkan Kesimpulan atau Rangkasan per topik. Variasikan frasa (jangan ulangi "penulis berpendapat" berkali-kali).
- Hindari kata "juga" di awal atau akhir kalimat. Variasikan struktur kalimat.
- Perbaiki typo umum (mis. "menafigasi" → "menavigasi").
- Tanpa pembukaan, langsung rangkuman saja. Pastikan kalimat terakhir selesai lengkap.

Bagian:

`;

const SUMMARIZE_MERGE_PROMPT = `Input di bawah terdiri dari BEBERAPA rangkuman per bagian (setiap bagian punya Ringkasan Eksekutif, Rangkuman, Insight tambahan). Ini dari dokumen yang sama yang dipotong menjadi beberapa chunk.

Tugas Anda: GABUNGKAN semuanya menjadi SATU rangkuman final. Output HANYA:
- SATU **Ringkasan Eksekutif** (sintesis semua bagian menjadi 2–3 kalimat)
- SATU **Rangkuman** (satu daftar bernomor 1., 2., 3., ... gabungkan semua poin)
- SATU **Insight tambahan** (gabungkan insight terbaik dari semua bagian)

JANGAN output ulang setiap blok. JANGAN ada lebih dari satu Ringkasan Eksekutif, satu Rangkuman, atau satu Insight tambahan.

ATURAN PENTING:
- DEDUPLIKASI: Poin yang sama atau mirip hanya perlu disebut SATU KALI. Gabungkan ide mirip menjadi satu; jangan ulangi di paragraf berbeda.
- Format RAPAT/NOTULA hanya jika rangkuman per bagian JELAS berisi rapat/pertemuan (peserta, jalannya rapat, diskusi). Gabungkan ke format terstruktur dengan MARKDOWN: **bold** untuk heading dan istilah penting, daftar bernomor (1., 2.) dan sub-list huruf (a., b., c.). Pertahankan nama orang dan detail teknis. Untuk **Kesimpulan**: boleh tambahkan insight Anda sendiri (analisis, rekomendasi, observasi) yang relevan.
- Jika rangkuman berisi buku/artikel/podcast (tidak ada peserta rapat, jalannya rapat): Output WAJIB tepat 3 bagian—**Ringkasan Eksekutif**, **Rangkuman**, **Insight tambahan**. Gabungkan semua poin dari tiap bagian ke dalam SATU daftar bernomor. Sintesis semua Ringkasan Eksekutif menjadi satu paragraf. Gabungkan insight menjadi satu blok. JANGAN output blok Ringkasan Eksekutif/Rangkuman/Insight lebih dari sekali.
- Hindari kata "juga" di awal atau akhir kalimat. Variasikan kata penghubung dan frasa (selain itu, selanjutnya, menurut penulis, dll.) - jangan gunakan "penulis berpendapat" berulang kali.
- Perbaiki typo umum (mis. "menafigasi" → "menavigasi").
- Pastikan rangkuman selesai LENGKAP; jangan potong di tengah kalimat atau paragraf.
- Tanpa pembukaan lain, langsung rangkuman saja. Output akhir: tepat satu blok **Ringkasan Eksekutif**, satu blok **Rangkuman**, satu blok **Insight tambahan**. Tidak boleh ada pengulangan struktur ini.

Rangkuman per bagian:

`;

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type MergeProgress = (current: number, total: number) => void;

export async function mergeSummaries(
  summaries: string[],
  apiKey: string,
  onProgress?: MergeProgress
): Promise<string> {
  const combined = summaries.join("\n\n");
  if (combined.length <= SUMMARIZE_MERGE_THRESHOLD) {
    return summarizeWithGroq(combined, apiKey, { isMerge: true });
  }
  const chunks = splitIntoChunks(combined, SUMMARIZE_CHUNK_SIZE);
  const merged: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    merged.push(await summarizeWithGroq(chunks[i], apiKey, { isMerge: true }));
    onProgress?.(i + 1, chunks.length);
    if (i < chunks.length - 1) {
      await sleep(SUMMARIZE_CHUNK_DELAY_MS);
    }
  }
  return mergeSummaries(merged, apiKey, onProgress);
}

/** Error thrown when Groq returns 429 after all retries. Job should be set to waiting_rate_limit. */
export class GroqRateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs: number
  ) {
    super(message);
    this.name = "GroqRateLimitError";
  }
}

/** Check if an error is a Groq rate limit error (429). */
export function isGroqRateLimitError(err: unknown): err is GroqRateLimitError {
  return err instanceof GroqRateLimitError;
}

/** User-friendly message for Groq 412/413 (quota) and 429 (rate limit). */
export function getGroqUserFriendlyError(status: number): string | null {
  if (status === 412 || status === 413) {
    return "You used up a per-minute quota.";
  }
  if (status === 429) {
    return "Wait for the rate limit window to reset (usually 1 hour).";
  }
  return null;
}

/** Parse "try again in X.XXs" from Groq 429 error. Returns ms to wait, or default. */
export function parseRetryAfterMs(errBody: string, defaultMs: number): number {
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
        max_tokens: 4096,
        temperature: 0.3,
      }),
    });

    if (res.ok) {
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = json.choices?.[0]?.message?.content?.trim() ?? "";
      return fixCommonTypos(raw);
    }

    const errBody = await res.text();
    const waitMs = res.status === 429 ? parseRetryAfterMs(errBody, 60 * 60 * 1000) : 0;

    if (res.status === 429 && attempt < maxRetries - 1) {
      await sleep(waitMs);
      continue;
    }

    if (res.status === 429) {
      throw new GroqRateLimitError(`Groq API rate limit: ${res.status}. ${errBody}`, waitMs);
    }

    lastError = new Error(`Groq API error: ${res.status}. ${errBody}`);
    throw lastError;
  }

  throw lastError ?? new Error("Summarization failed.");
}

/**
 * Creates an OCR fallback function for extractText.
 * Processes PDF pages via Vision API and returns concatenated text with page markers.
 */
export function createOcrFallback(
  apiKey: string,
  onProgress?: (message: string) => void
) {
  return async (images: PdfPageImage[]): Promise<string> => {
    const chunks: string[] = [];
    const totalPages = images.length;
    for (let i = 0; i < images.length; i += GROQ_IMAGES_PER_REQUEST) {
      const batch = images.slice(i, i + GROQ_IMAGES_PER_REQUEST);
      const pageNum = batch[0].pageNum;
      const pageEnd = batch.length > 1 ? batch[batch.length - 1].pageNum : pageNum;
      onProgress?.(`OCR halaman ${pageNum}${pageEnd !== pageNum ? `–${pageEnd}` : ""} dari ${totalPages}…`);
      const extracted = await extractTextFromImages(batch, apiKey, totalPages);
      chunks.push(
        extracted.trim()
          ? `[Halaman ${pageNum}]\n${extracted}`
          : `[Halaman ${pageNum}]\n(Konten halaman ini tidak dapat diekstrak.)`
      );
    }
    return chunks.join("\n\n");
  };
}

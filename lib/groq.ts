/**
 * Shared Groq API utilities for OCR and document processing.
 * Used by /api/summarize and /api/summarize-segmented.
 */

import type { PdfPageImage } from "@/lib/pdf-to-images";

export const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB
/** Chunk size for summarization (~1500 tokens). Keeps requests under Groq free tier TPM. */
export const SUMMARIZE_CHUNK_SIZE = 4500;
/** Delay between chunk requests to avoid Groq TPM rate limit (429). */
export const SUMMARIZE_CHUNK_DELAY_MS = 6000;
/** Single merge when combined summaries fit under this character limit. */
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
PENTING: Ringkasan Eksekutif dan Insight tambahan MAKSIMAL 40 kata masing-masing.

**Ringkasan Eksekutif:**

[40 kata atau kurang: gambaran UMUM—topik utama dan kesimpulan inti. JANGAN menyalin kalimat dari Rangkuman. Bagian ini adalah ikhtisar tingkat tinggi, bukan ringkasan poin-poin.]

**Rangkuman:**

1. [Poin spesifik pertama—sertakan detail konkret: nama, angka, contoh, atau kutipan singkat dari sumber]
2. [Poin spesifik kedua]
3. [Poin spesifik ketiga]
... (lanjutkan dengan nomor berurutan, maksimal 5–6 poin utama. Sub-poin: gunakan a., b., c. jika perlu)

**Insight tambahan:**

[40 kata atau kurang: 2–3 insight NON-OBVIOUS yang berasal dari narasumber/penulis—bukan nasihat umum. Tulis apa yang disampaikan narasumber, bukan saran generik. Contoh BURUK: "hidup lebih bahagia jika tidak berekspektasi". Contoh BAIK: "Ferry menekankan bahwa pertimbangan ekonomi lebih objektif daripada emosi saat menghadapi konflik kepentingan".]

PERAN TIAP BAGIAN (WAJIB DIPATUHI):
- **Ringkasan Eksekutif** = ikhtisar tingkat tinggi. TIDAK BOLEH mengulang kalimat yang sama dari Rangkuman.
- **Rangkuman** = poin-poin detail dengan fakta spesifik (nama, angka, contoh nyata). Hindari pernyataan generik yang bisa berlaku untuk topik apa saja.
- **Insight tambahan** = takeaway non-obvious DARI narasumber/penulis. Bukan nasihat hidup umum.

- Output HANYA 3 bagian. Beri baris kosong antara judul dan isi.
- JANGAN gunakan format notula (Metadata, Peserta Rapat, Acara, dll.) untuk dokumen ini.
- Variasikan frasa: jangan ulangi "penulis berpendapat" berkali-kali; gunakan "menurut penulis", "penulis menyatakan", "penulis mengemukakan", dll.
- KONSOLIDASI: Gabungkan poin yang mirip menjadi satu. Jangan ulangi ide yang sama.
- Gunakan **bold** untuk istilah penting, nama, organisasi.
- SPESIFISITAS: Setiap poin harus mengandung detail konkret dari sumber (siapa berkata apa, angka, contoh). Hindari kalimat generik seperti "beradaptasi dengan perubahan dapat menjadi tantangan" yang bisa berlaku untuk konteks apa saja.

ATURAN UMUM:
- DEDUPLIKASI: Poin yang sama atau mirip hanya perlu disebut SATU KALI. Hindari pengulangan ide.
- CROSS-SECTION DEDUP: Ringkasan Eksekutif, Rangkuman, dan Insight tambahan TIDAK BOLEH mengandung kalimat atau ide yang sama. Setiap bagian punya peran berbeda.
- Hindari kata "juga" di awal atau akhir kalimat. Variasikan struktur kalimat.
- KOREKSI TRANSKRIPSI: Perbaiki kesalahan umum dari speech-to-text, mis. "ekspetasi" → "ekspektasi", "menafigasi" → "menavigasi", "infestasi" → "investasi", "ekosistem" yang seharusnya "eksistem", nama orang/tempat yang salah eja.
- Gunakan konten dari SEMUA halaman dokumen. Jangan hanya merangkum halaman terakhir.
- Tanpa pembukaan lain, langsung rangkuman saja.
- Pastikan rangkuman selesai lengkap; jangan potong di tengah kalimat.`;

const SUMMARIZE_CHUNK_PROMPT = `Rangkum bagian berikut secara ringkas dalam Bahasa Indonesia.
- Fokus pada poin-poin penting dan UNIK. Poin yang sama hanya disebut SATU KALI. Gabungkan ide mirip; jangan ulangi di paragraf berbeda.
- Jika bagian ini dari notula/pertemuan (ada peserta, jalannya rapat, diskusi): PERTAHANKAN nama orang, organisasi/unit, detail teknis. Gunakan format: daftar bernomor (1., 2.) dan sub-list huruf (a., b., c.). Bold (**) untuk nama orang, organisasi, istilah teknis.
- Jika bagian ini dari buku/artikel/podcast: format 3 bagian—**Ringkasan Eksekutif** (MAKSIMAL 40 kata, ikhtisar tingkat tinggi), **Rangkuman** (daftar bernomor dengan detail konkret: nama, angka, contoh), **Insight tambahan** (MAKSIMAL 40 kata, takeaway non-obvious DARI narasumber/penulis—bukan nasihat umum). Beri baris kosong antara judul dan isi. Ringkasan Eksekutif TIDAK BOLEH mengulang kalimat dari Rangkuman.
- SPESIFISITAS: Sertakan detail konkret (siapa, apa, contoh nyata). Hindari pernyataan generik yang berlaku untuk topik apa saja.
- Hindari kata "juga" di awal atau akhir kalimat. Variasikan struktur kalimat.
- KOREKSI TRANSKRIPSI: Perbaiki kesalahan umum dari speech-to-text, mis. "ekspetasi" → "ekspektasi", "menafigasi" → "menavigasi", "infestasi" → "investasi".
- Tanpa pembukaan, langsung rangkuman saja. Pastikan kalimat terakhir selesai lengkap.`;

const SUMMARIZE_MERGE_PROMPT = `PENTING: Ringkasan Eksekutif dan Insight tambahan MAKSIMAL 40 kata masing-masing. JANGAN lebih.

Input di bawah terdiri dari BEBERAPA rangkuman per bagian. Gabungkan menjadi SATU rangkuman final.

Output HANYA:
- SATU **Ringkasan Eksekutif** (ikhtisar tingkat tinggi, MAKSIMAL 40 kata. JANGAN menyalin kalimat dari Rangkuman—tulis gambaran umum saja.)
- SATU **Rangkuman** (daftar bernomor 1., 2., 3., ... gabungkan semua poin. Setiap poin harus mengandung detail konkret: nama, angka, contoh nyata. Buang poin yang terlalu generik.)
- SATU **Insight tambahan** (MAKSIMAL 40 kata total. Takeaway non-obvious DARI narasumber/penulis—BUKAN nasihat hidup umum. Tulis apa yang disampaikan narasumber, bukan saran generik seperti "hidup lebih bahagia".)

Beri baris kosong antara judul section dan isi. Buang informasi kurang penting—prioritaskan yang esensial saja.

ATURAN:
- DEDUPLIKASI: Poin yang sama atau mirip hanya perlu disebut SATU KALI. Gabungkan ide mirip menjadi satu; jangan ulangi di paragraf berbeda.
- CROSS-SECTION DEDUP: Ringkasan Eksekutif, Rangkuman, dan Insight tambahan TIDAK BOLEH mengandung kalimat atau ide yang sama. Setiap bagian punya peran berbeda.
- SPESIFISITAS: Buang poin generik yang berlaku untuk konteks apa saja (mis. "beradaptasi itu tantangan"). Pertahankan hanya poin yang mengandung detail spesifik dari sumber.
- Format RAPAT/NOTULA hanya jika rangkuman per bagian JELAS berisi rapat/pertemuan (peserta, jalannya rapat, diskusi). Gabungkan ke format terstruktur dengan MARKDOWN: **bold** untuk heading dan istilah penting, daftar bernomor (1., 2.) dan sub-list huruf (a., b., c.). Pertahankan nama orang dan detail teknis. Untuk **Kesimpulan**: boleh tambahkan insight Anda sendiri (analisis, rekomendasi, observasi) yang relevan.
- Jika rangkuman berisi buku/artikel/podcast: Output 3 bagian—**Ringkasan Eksekutif**, **Rangkuman**, **Insight tambahan**. Ringkasan Eksekutif dan Insight tambahan MAKSIMAL 40 kata. Pilih poin paling penting saja; buang sisanya.
- Hindari kata "juga" di awal atau akhir kalimat. Variasikan kata penghubung dan frasa (selain itu, selanjutnya, menurut penulis, dll.) - jangan gunakan "penulis berpendapat" berulang kali.
- KOREKSI TRANSKRIPSI: Perbaiki kesalahan umum dari speech-to-text, mis. "ekspetasi" → "ekspektasi", "menafigasi" → "menavigasi", "infestasi" → "investasi".
- Pastikan rangkuman selesai LENGKAP; jangan potong di tengah kalimat atau paragraf.
- Tanpa pembukaan lain, langsung rangkuman saja. Output akhir: tepat satu blok **Ringkasan Eksekutif**, satu blok **Rangkuman**, satu blok **Insight tambahan**. Tidak boleh ada pengulangan struktur ini.`;

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

/** Parse "try again in X.XXs" or "try again in Xms" from Groq 429 error. Returns ms to wait, or default. */
export function parseRetryAfterMs(errBody: string, defaultMs: number): number {
  const msMatch = errBody.match(/try again in (\d+)ms/i);
  if (msMatch) {
    return Math.ceil(parseInt(msMatch[1], 10)) + 500;
  }
  const secMatch = errBody.match(/try again in ([\d.]+)s/i);
  if (secMatch) {
    const sec = parseFloat(secMatch[1]);
    return Math.ceil(sec * 1000) + 1000;
  }
  return defaultMs;
}

const REFINE_SYSTEM_PROMPT = `Anda adalah asisten perangkum dokumen yang memperbarui rangkuman secara bertahap.

Aturan:
- Pertahankan format dan struktur rangkuman saat ini (notula/rapat ATAU dokumen umum—jangan ubah jenis format).
- Integrasikan informasi baru ke dalam rangkuman yang sudah ada secara alami.
- DEDUPLIKASI: Poin yang sama atau mirip hanya disebut SATU KALI. Gabungkan ide mirip.
- CROSS-SECTION DEDUP: Ringkasan Eksekutif, Rangkuman, dan Insight tambahan TIDAK BOLEH mengandung kalimat atau ide yang sama.
- SPESIFISITAS: Setiap poin harus mengandung detail konkret dari sumber (nama, angka, contoh). Hindari pernyataan generik.
- Tulis dalam Bahasa Indonesia. Istilah teknis tetap gunakan istilah aslinya.
- Gunakan **bold** untuk nama orang, organisasi, istilah teknis.
- Untuk format dokumen umum: **Ringkasan Eksekutif** (ikhtisar tingkat tinggi, MAKSIMAL 40 kata) dan **Insight tambahan** (takeaway non-obvious DARI narasumber/penulis—bukan nasihat umum, MAKSIMAL 40 kata).
- Hindari kata "juga" di awal atau akhir kalimat. Variasikan struktur kalimat.
- KOREKSI TRANSKRIPSI: Perbaiki kesalahan umum dari speech-to-text, mis. "ekspetasi" → "ekspektasi", "menafigasi" → "menavigasi", "infestasi" → "investasi".
- Pastikan rangkuman selesai lengkap; jangan potong di tengah kalimat.
- Tanpa pembukaan, langsung rangkuman saja.`;

async function callGroqApi(
  messages: Array<{ role: string; content: string }>,
  apiKey: string,
  options?: { model?: string; maxTokens?: number; temperature?: number }
): Promise<string> {
  const model = options?.model ?? GROQ_MODEL;
  const maxTokens = options?.maxTokens ?? 4096;
  const temperature = options?.temperature ?? 0.3;
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
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
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
    const isRateLimit = res.status === 429;
    const isQuotaLimit = res.status === 412 || res.status === 413;

    if ((isRateLimit || isQuotaLimit) && attempt < maxRetries - 1) {
      const waitMs = isRateLimit
        ? parseRetryAfterMs(errBody, 60_000)
        : 60_000;
      await sleep(waitMs);
      continue;
    }

    if (isRateLimit || isQuotaLimit) {
      const waitMs = isRateLimit
        ? parseRetryAfterMs(errBody, 60 * 60 * 1000)
        : 60 * 60 * 1000;
      throw new GroqRateLimitError(`Groq API rate limit: ${res.status}. ${errBody}`, waitMs);
    }

    lastError = new Error(`Groq API error: ${res.status}. ${errBody}`);
    throw lastError;
  }

  throw lastError ?? new Error("Summarization failed.");
}

export async function summarizeWithGroq(
  content: string,
  apiKey: string,
  options?: { isChunk?: boolean; isMerge?: boolean }
): Promise<string> {
  const systemPrompt = options?.isMerge
    ? SUMMARIZE_MERGE_PROMPT
    : options?.isChunk
      ? SUMMARIZE_CHUNK_PROMPT
      : SUMMARIZE_PROMPT;

  const userLabel = options?.isMerge
    ? "Rangkuman per bagian:\n\n"
    : options?.isChunk
      ? "Bagian:\n\n"
      : "Dokumen:\n\n";

  return callGroqApi(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userLabel + content },
    ],
    apiKey
  );
}

export async function refineWithGroq(
  currentSummary: string,
  newChunk: string,
  apiKey: string
): Promise<string> {
  return callGroqApi(
    [
      { role: "system", content: REFINE_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Rangkuman saat ini:\n\n${currentSummary}\n\n---\n\nBagian baru dari dokumen:\n\n${newChunk}`,
      },
    ],
    apiKey
  );
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

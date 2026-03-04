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
export const SUMMARIZE_CHUNK_DELAY_MS = 6000;
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
- PEDOMAN/PANDUAN/PERATURAN: Selalu format Dokumen Bukan Rapat. Pedoman adalah dokumen panduan/prosedur, BUKAN transkrip rapat. Meskipun dokumen menyebut "rapat" atau "pertemuan", tetap gunakan format **Rangkuman :** dengan daftar bernomor. JANGAN format Metadata, Peserta Rapat, Acara, Jalannya Rapat.

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
- EKSTRAK isi konkret dari dokumen. Jangan hanya mendeskripsikan dokumen. Hindari kalimat meta seperti "Dokumen ini merupakan...", "Tujuan dari dokumen ini adalah...". Fokus pada aturan, prosedur, persyaratan, dan poin spesifik yang tertulis.
- Setiap poin harus berisi informasi spesifik dari dokumen, bukan ringkasan umum tentang jenis dokumen.
- Untuk pedoman: ekstrak prosedur, aturan, langkah-langkah, persyaratan yang tertulis. Jangan gunakan struktur Latar Belakang/Tujuan/Kerangka Kerja jika itu hanya deskripsi umum.
- Gunakan format daftar bernomor (1., 2., 3.) untuk poin utama.
- Gunakan sub-poin dengan indentasi (2–4 spasi sebelum "- ") untuk rincian.
- Awali dengan **Rangkuman :** lalu daftar bernomor.
- Berikan contoh konkret dari dokumen. Jangan hanya kesimpulan abstrak.
- JANGAN gunakan format notula (Metadata, Peserta Rapat, Acara, dll.) untuk dokumen ini.
- Variasikan frasa: jangan ulangi "penulis berpendapat" berkali-kali; gunakan "menurut penulis", "penulis menyatakan", "penulis mengemukakan", dll.
- Paragraf kesimpulan tidak boleh mengulang pembukaan; fokus pada ringkasan atau poin penutup yang baru. Boleh tambahkan insight Anda sendiri (analisis, rekomendasi, observasi) yang relevan dengan dokumen.
- KONSOLIDASI: Gabungkan poin yang mirip menjadi satu poin. Jangan ulangi ide yang sama.

ATURAN UMUM:
- RANGKUMAN vs DESKRIPSI: Rangkum ISI dokumen (aturan, prosedur, poin penting). Jangan hanya mendeskripsikan jenis dokumen atau tujuannya.
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
- Jika bagian ini dari buku/artikel/podcast: ekstrak poin spesifik dari konten. Rangkum sebagai daftar bernomor (1., 2.) dengan sub-poin (indent 2–4 spasi sebelum "- ") bila ada rincian. Jangan hanya deskripsi umum. Variasikan frasa (jangan ulangi "penulis berpendapat" berkali-kali).
- Jika bagian ini dari pedoman, panduan, peraturan, prosedur: ekstrak aturan, prosedur, langkah-langkah, persyaratan yang tertulis. SELALU rangkum sebagai daftar bernomor (bukan format notula). Hindari "Dokumen ini merupakan...", "Tujuan dari dokumen ini...". Pedoman bukan transkrip rapat.
- Hindari kata "juga" di awal atau akhir kalimat. Variasikan struktur kalimat.
- Perbaiki typo umum (mis. "menafigasi" → "menavigasi").
- Tanpa pembukaan, langsung rangkuman saja. Pastikan kalimat terakhir selesai lengkap.

Bagian:

`;

const SUMMARIZE_MERGE_PROMPT = `Gabungkan rangkuman berikut menjadi satu rangkuman koheren dalam Bahasa Indonesia.

ATURAN PENTING:
- DEDUPLIKASI: Poin yang sama atau mirip hanya perlu disebut SATU KALI. Gabungkan ide mirip menjadi satu paragraf; jangan ulangi di paragraf berbeda.
- Format RAPAT/NOTULA hanya jika rangkuman per bagian JELAS berisi rapat/pertemuan (peserta, jalannya rapat, diskusi). Gabungkan ke format terstruktur dengan MARKDOWN: **bold** untuk heading dan istilah penting, daftar bernomor (1., 2.) dan sub-list huruf (a., b., c.). Pertahankan nama orang dan detail teknis. Untuk **Kesimpulan**: boleh tambahkan insight Anda sendiri (analisis, rekomendasi, observasi) yang relevan.
- Jika rangkuman berisi buku/artikel/podcast (tidak ada peserta rapat, jalannya rapat): JANGAN gunakan format notula. Gunakan format **Rangkuman :** diikuti daftar bernomor (1., 2., 3.) dengan sub-poin (indent 2–4 spasi sebelum "- ") bila ada rincian. Pastikan poin berisi konten spesifik, bukan deskripsi umum. Tanpa duplikat. Boleh tambahkan insight Anda sendiri di poin terakhir.
- Jika rangkuman berisi pedoman, panduan, peraturan: SELALU format **Rangkuman :** dengan daftar bernomor. Ekstrak aturan, prosedur, persyaratan konkret. JANGAN format notula. JANGAN struktur Latar Belakang/Tujuan/Kerangka Kerja yang hanya deskripsi. Pedoman bukan transkrip rapat.
- Hindari kata "juga" di awal atau akhir kalimat. Variasikan kata penghubung dan frasa (selain itu, selanjutnya, menurut penulis, dll.) - jangan gunakan "penulis berpendapat" berulang kali.
- Perbaiki typo umum (mis. "menafigasi" → "menavigasi").
- Pastikan rangkuman selesai LENGKAP; jangan potong di tengah kalimat atau paragraf.
- Tanpa pembukaan lain, langsung rangkuman saja.

Rangkuman per bagian:

`;

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

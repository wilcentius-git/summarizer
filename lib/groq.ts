/**
 * Shared Groq API utilities for OCR and document processing.
 * Used by /api/summarize and /api/summarize-segmented.
 */

import type { PdfPageImage } from "@/lib/pdf-to-images";
import type { GlossaryContext } from "@/lib/glossary";
import { resolveGlossaryFromContext } from "@/lib/glossary";
import { logger } from "@/lib/logger";
import {
  SUMMARIZE_PIPELINE_STANDARD,
  type SummarizePipelineConfig,
} from "@/lib/summarize-pipeline";

export {
  SUMMARIZE_PIPELINE_STANDARD,
  type SummarizePipelineConfig,
} from "@/lib/summarize-pipeline";

export const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB

export const GROQ_IMAGES_PER_REQUEST = 1;

/**
 * Splits text into chunks at natural boundaries (paragraph, line, sentence).
 * Each chunk stays under maxSize to fit within API token limits.
 */
/**
 * Removes consecutive duplicate paragraphs (e.g. repetitive transcripts or LLM summary points).
 * Keeps first occurrence of each unique paragraph (by normalized content).
 */
export function deduplicateParagraphs(text: string): string {
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
  let result: string[];
  if (text.length <= maxSize) {
    result = [text.trim()];
  } else {
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
    result = chunks.filter((c) => c.length > 0);
  }
  logger.log(
    `>>> [SPLIT] Produced ${result.length} chunk(s) from ${text.length} chars (maxSize=${maxSize})`
  );
  result.forEach((chunk, i) => {
    logger.log(`>>> [SPLIT] Chunk ${i + 1}/${result.length}: ${chunk.length} chars`);
  });
  return result;
}

export const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
export const GROQ_MODEL = "openai/gpt-oss-20b";
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

1. [Heading poin pertama.] [Detail, contoh, atau fakta spesifik sebagai kalimat lanjutan dalam paragraf yang sama.]
2. [Heading poin kedua.] [Detail lanjutan.]
... (lanjutkan dengan nomor berurutan. Sertakan SEMUA topik dan subtopik yang dibahas — jangan buang konten hanya karena bersifat percakapan atau anekdotal. Untuk transkrip podcast/wawancara, setiap topik yang diangkat narasumber adalah poin yang valid. Gabungkan semua detail sebagai kalimat lanjutan dalam paragraf bernomor yang sama. JANGAN gunakan sub-poin a., b., c.)

**Insight tambahan:**

[40 kata atau kurang: 2–3 insight NON-OBVIOUS yang berasal dari narasumber/penulis—bukan nasihat umum. Tulis apa yang disampaikan narasumber, bukan saran generik. Contoh BURUK: "hidup lebih bahagia jika tidak berekspektasi". Contoh BAIK: "Ferry menekankan bahwa pertimbangan ekonomi lebih objektif daripada emosi saat menghadapi konflik kepentingan".]

PERAN TIAP BAGIAN (WAJIB DIPATUHI):
- **Ringkasan Eksekutif** = ikhtisar tingkat tinggi. TIDAK BOLEH mengulang kalimat yang sama dari Rangkuman.
- **Rangkuman** = poin-poin detail dengan fakta spesifik (nama, angka, contoh nyata). Untuk transkrip podcast/wawancara: sertakan semua topik yang dibahas, termasuk cerita, anekdot, dan contoh konkret yang disebutkan narasumber — ini adalah konten yang bernilai, bukan noise.
- **Insight tambahan** = takeaway non-obvious DARI narasumber/penulis. Bukan nasihat hidup umum.

- Output HANYA 3 bagian. Beri baris kosong antara judul dan isi.
- PENTING FORMAT HEADING: Setiap heading section (**Ringkasan Eksekutif:**, **Rangkuman:**, **Insight tambahan:**) harus berada di baris TERPISAH, diikuti baris kosong, lalu isinya. JANGAN gabungkan heading dan isi dalam satu baris.
- JANGAN gunakan format notula (Metadata, Peserta Rapat, Acara, dll.) untuk dokumen ini.
- Variasikan frasa: jangan ulangi "penulis berpendapat" berkali-kali; gunakan "menurut narasumber", "menurut pembicara", "Rocky Gerung menyatakan", dll.
- KONSOLIDASI: Gabungkan poin yang mirip menjadi satu. Jangan ulangi ide yang sama.
- Gunakan **bold** untuk istilah penting, nama, organisasi.
- SPESIFISITAS: Setiap poin harus mengandung detail konkret dari sumber (siapa berkata apa, contoh spesifik). Untuk podcast/wawancara, detail percakapan (siapa berkata apa kepada siapa, dalam konteks apa) adalah spesifisitas yang valid.

ATURAN UMUM:
- DEDUPLIKASI: Poin yang sama atau mirip hanya perlu disebut SATU KALI. Hindari pengulangan ide.
- CROSS-SECTION DEDUP: Ringkasan Eksekutif, Rangkuman, dan Insight tambahan TIDAK BOLEH mengandung kalimat atau ide yang sama. Setiap bagian punya peran berbeda.
- Hindari kata "juga" di awal atau akhir kalimat. Variasikan struktur kalimat.
- KOREKSI TRANSKRIPSI: Perbaiki kesalahan umum dari speech-to-text, mis. "ekspetasi" → "ekspektasi", "menafigasi" → "menavigasi", "infestasi" → "investasi", "ekosistem" yang seharusnya "eksistem", nama orang/tempat yang salah eja. Jika daftar koreksi tersimpan disertakan di bawah, terapkan ejaan benar untuk istilah yang tercantum; tetap perbaiki kesalahan lain yang Anda kenali.
- Gunakan konten dari SEMUA halaman dokumen. Jangan hanya merangkum halaman terakhir.
- Tanpa pembukaan lain, langsung rangkuman saja.
- Pastikan rangkuman selesai lengkap; jangan potong di tengah kalimat.`;

const SUMMARIZE_CHUNK_MEETING_PROMPT = `Tulis semua output dalam Bahasa Indonesia.
Gunakan hanya karakter ASCII standar. Hindari simbol seperti ≈, →, ×, ±, tanda kutip lengkung, atau em dash — gunakan kata (mis. 'sekitar', 'menjadi') atau tanda ASCII biasa (-, ->, x, +/-) sebagai gantinya.
Anda adalah asisten notulen rapat pemerintah yang mengekstrak poin dari transkrip rapat atau diskusi resmi.
Transkrip ini adalah rapat/pembahasan pemerintah — bukan podcast, wawancara, atau konten non-rapat.

Ekstrak poin HANYA jika memenuhi minimal SATU kriteria berikut:
- menyebut nama spesifik (orang, jabatan, unit/organisasi, program, lokasi)
- menyebut angka, target, anggaran, persentase, atau statistik
- mencatat keputusan, kesepakatan, atau arahan konkret
- mencatat pernyataan langsung peserta (siapa berkata apa)

ATURAN:
- Gunakan daftar bernomor (1., 2.) untuk poin utama, dan bullet (-) untuk sub-poin di bawahnya
- Bold (**) untuk nama orang, organisasi, dan istilah teknis
- PERTAHANKAN nama orang, organisasi/unit, dan detail teknis
- Fokus pada poin UNIK. Gabungkan ide mirip; jangan ulangi
- BUANG basa-basi, ucapan terima kasih, filler, dan small talk — jangan dijadikan poin
- Jika bagian ini tidak memuat konten substantif, kembalikan teks kosong (nol poin). JANGAN membuat poin hanya agar ada output.
- SPESIFISITAS: setiap poin harus memuat detail konkret dari transkrip
- KOREKSI TRANSKRIPSI: perbaiki kesalahan speech-to-text (mis. "ekspetasi"→"ekspektasi", "infestasi"→"investasi"). Dua lapis:
  (1) UTAMA — gunakan penilaian Anda sendiri: jika kata/frasa di transkrip secara fonetik menyerupai istilah glosarium yang tercantum di bawah (ejaan benar), koreksi ke ejaan benar tersebut meskipun tidak ada contoh kesalahan eksplisit. Ini berlaku untuk SETIAP istilah glosarium, dengan atau tanpa daftar kesalahan umum.
  (2) TAMBAHAN — jika istilah glosarium memuat contoh kesalahan transkripsi, anggap itu sebagai konfirmasi: koreksi pola-pola persis tersebut dengan tegas; contoh kesalahan menaikkan keyakinan, bukan menggantikan penilaian fonetik umum di (1).
  Tetap perbaiki kesalahan speech-to-text umum lain yang Anda kenali.
- Hindari kata "juga" di awal atau akhir kalimat
- Tanpa pembukaan, langsung poin saja (atau kosong jika tidak ada poin)
- Pastikan kalimat terakhir selesai lengkap`;

const SUMMARIZE_CHUNK_DOC_PROMPT = `Anda asisten notulen rapat pemerintah yang profesional. Ekstrak poin penting dari bagian transkrip berikut: maksimal 5 poin, tiap poin maksimal 30 kata. Bahasa Indonesia formal. Tanpa kesimpulan atau kalimat penutup.

Format output:
- [poin penting]
- [poin penting]`;

const SUMMARIZE_MERGE_PROMPT = `Tulis semua output dalam Bahasa Indonesia.
Gunakan hanya karakter ASCII standar. Hindari simbol seperti ≈, →, ×, ±, tanda kutip lengkung, atau em dash — gunakan kata (mis. 'sekitar', 'menjadi') atau tanda ASCII biasa (-, ->, x, +/-) sebagai gantinya.
Input di bawah terdiri dari BEBERAPA rangkuman per bagian. Gabungkan menjadi SATU rangkuman final.
PENTING: Ringkasan Eksekutif dan Insight tambahan MAKSIMAL 40 kata masing-masing. JANGAN lebih.

LANGKAH SEBELUM MENULIS RINGKASAN EKSEKUTIF:
- Sebelum menulis **Ringkasan Eksekutif**, identifikasi dulu: (1) tujuan atau agenda utama rapat, dan (2) elemen paling konkret yang benar-benar ada di transkrip—bisa berupa keputusan, angka, pihak bertanggung jawab yang dinamai, atau isu/kendala mencolok.
- Jangan memaksakan kategori di atas jika tidak ada di konten. Jika spesifikasinya tipis, akui itu—jangan mengisi dengan bahasa generik.
- **Ringkasan Eksekutif** harus berpusat pada apa yang teridentifikasi, bukan template kosong.

Output HANYA:
- SATU **Ringkasan Eksekutif** (ikhtisar tingkat tinggi, MAKSIMAL 40 kata. Jangan salin kalimat dari Rangkuman.)
- SATU **Rangkuman** (satu daftar bernomor 1., 2., 3., ... secara kronologis — lihat aturan di bawah)
- SATU **Insight tambahan** (MAKSIMAL 40 kata total. Takeaway non-obvious dari peserta rapat—bukan nasihat umum.)

URUTAN DAN FILTER RANGKUMAN:
- Susun semua poin dalam SATU daftar bernomor berurutan (1., 2., 3., ...) untuk seluruh section Rangkuman — jangan pecah menjadi bab, heading terpisah, atau daftar yang dimulai ulang.
- Urutkan poin secara KRONOLOGIS mengikuti [Bagian 1], [Bagian 2], dst.
- MAKSIMAL 50 poin. Jika lebih dari 50 poin memenuhi kriteria, pertahankan yang paling spesifik (nama, angka, keputusan)—gabungkan atau buang sisanya.
- Setiap poin: detail konkret—nama, angka, keputusan. Sub-poin bullet (-) dari input BOLEH dipertahankan jika sudah ada dan relevan—jangan paksa jadi kalimat tunggal jika strukturnya lebih jelas sebagai sub-poin.

Beri baris kosong antara judul section dan isi.
ATURAN:
- DEDUPLIKASI: Poin sama/mirip disebut SATU KALI.
- CROSS-SECTION DEDUP: Ringkasan Eksekutif, Rangkuman, Insight tambahan tidak boleh mengandung ide yang sama.
- SPESIFISITAS: Buang poin generik yang berlaku untuk konteks apa saja.
- Hindari kata "juga" di awal/akhir kalimat. Variasikan frasa penghubung.
- KOREKSI TRANSKRIPSI: perbaiki kesalahan speech-to-text (mis. "ekspetasi"→"ekspektasi"). Jika daftar koreksi tersimpan disertakan di bawah, terapkan ejaan benar untuk istilah yang tercantum; tetap perbaiki kesalahan lain yang Anda kenali.
- Pastikan rangkuman selesai LENGKAP, tidak terpotong di tengah kalimat.
- Langsung rangkuman saja, tanpa pembukaan. Output akhir: tepat satu blok tiap section, tidak ada pengulangan struktur.
- Setiap heading section di baris TERPISAH, diikuti baris kosong, lalu isinya.`;

const MERGE_INTERMEDIATE_PROMPT = `Anda adalah asisten notulen. Tugas Anda adalah mengompres poin-poin berikut menjadi daftar ringkas.

ATURAN:
- Output HANYA daftar bernomor (1., 2., 3., ...)
- Setiap poin maksimal 20 kata
- PERTAHANKAN poin yang mengandung minimal satu dari:
  nama spesifik (orang, perusahaan, produk, teknologi), angka atau statistik, contoh konkret, atau klaim langsung dari narasumber
- BUANG poin yang bersifat generik dan bisa berlaku untuk konteks apa saja tanpa nama atau detail spesifik
  contoh poin yang DIBUANG: "kerja keras adalah kunci sukses", "teknologi terus berkembang", "komunikasi itu penting"
  contoh poin yang DIPERTAHANKAN: "Elon Musk menyatakan Starship dapat mengurangi biaya orbit menjadi $100/kg", "DeepSeek mengurangi biaya komputasi AI hingga 40x"
- Gabungkan poin yang memiliki subjek dan ide yang sama menjadi satu
- Jika poin input memuat sub-poin bullet (-), pertahankan strukturnya saat digabung—jangan diratakan jadi satu kalimat panjang.
- MAKSIMAL 15 poin dalam output. Jika lebih dari 15 poin memenuhi kriteria, pertahankan yang paling spesifik (punya nama, angka, atau keputusan)—gabungkan atau buang sisanya.
- Tanpa heading, tanpa pembukaan, tanpa penutup
- Langsung daftar saja`;

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Sleep between chunk summarize calls using Groq rate-limit headers (TPM pacing).
 * Call after each chunk response except the last (pass i and total; no-op when i >= total - 1).
 */
export async function sleepChunkPacingFromGroqHeaders(
  responseHeaders: Headers,
  i: number,
  total: number
): Promise<void> {
  if (i >= total - 1) return;
  const remainingTokens = parseInt(
    responseHeaders.get("x-ratelimit-remaining-tokens") ?? "6000",
    10
  );
  const resetTokensMs =
    parseFloat(responseHeaders.get("x-ratelimit-reset-tokens") ?? "60") * 1000;

  if (remainingTokens < 1500) {
    const waitMs = resetTokensMs + 500;
    await sleep(waitMs);
  } else {
    await sleep(300);
  }
}

export type MergeProgress = (current: number, total: number) => void;

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

/** Groq merge with labeled bagian sections; merge prompt and max_tokens 600 via summarizeWithGroq. */
async function mergeSummariesOnce(
  summaries: string[],
  apiKey: string,
  glossaryContext: GlossaryContext | undefined,
  onProgress: MergeProgress | undefined,
  onBatchComplete?: (batchResults: string[]) => Promise<void>,
  depth: number = 0
): Promise<string> {
  const pipeline = SUMMARIZE_PIPELINE_STANDARD;
    const MERGE_PROMPT_OVERHEAD_TOKENS = 500;
    const SAFE_TOKEN_LIMIT = 2800;
    const BATCH_CHAR_LIMIT = 5000; // ~3000 tokens per batch at 1 token per 3 chars

    const parts = summaries.map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return "";

    logger.log(`>>> [MERGE depth=${depth}] Called with ${parts.length} summaries`);

    const MAX_MERGE_DEPTH = 3;
    if (depth >= MAX_MERGE_DEPTH) {
      console.warn("[MERGE] Max recursion depth reached, forcing final merge");
      logger.log(`>>> [MERGE depth=${depth}] Forced final merge (max depth reached)`);
      onProgress?.(1, 1);
      const result = await summarizeWithGroq(parts.join("\n\n"), apiKey, {
        systemPrompt: SUMMARIZE_MERGE_PROMPT,
        maxTokens: 4000,
        glossary: resolveGlossaryFromContext(glossaryContext, parts.join("\n\n")),
        pipeline: SUMMARIZE_PIPELINE_STANDARD,
      });
      return result;
    }

    const combined = parts
      .map((s, i) => `[Bagian ${i + 1}]\n${s}`)
      .join("\n\n");

    // Use /3 not /4 — Bahasa Indonesia tokenizes less efficiently than English
    const estimatedTokens =
      Math.round(combined.length / 3) + MERGE_PROMPT_OVERHEAD_TOKENS;

    if (estimatedTokens <= SAFE_TOKEN_LIMIT) {
      onProgress?.(1, 1);
      try {
        logger.log("[MERGE INPUT]", combined.length, "chars total");
      } catch {
        // ignore debug log failures
      }
      logger.log(`>>> [MERGE depth=${depth}] Single merge, estimated ${estimatedTokens} tokens`);
      const result = await summarizeWithGroq(combined, apiKey, {
        systemPrompt: SUMMARIZE_MERGE_PROMPT,
        maxTokens: 3000,
        glossary: resolveGlossaryFromContext(glossaryContext, combined),
        pipeline,
      });
      return result;
    }

    // Too large — split into character-limited batches
    const batches: string[][] = [];
    let currentBatch: string[] = [];
    let currentLength = 0;

    for (const summary of parts) {
      if (currentLength + summary.length > BATCH_CHAR_LIMIT && currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentLength = 0;
      }
      currentBatch.push(summary);
      currentLength += summary.length;
    }
    if (currentBatch.length > 0) batches.push(currentBatch);

    logger.log(`>>> [MERGE depth=${depth}] Too large (${estimatedTokens} tokens), split into ${batches.length} batches`);

    const batchResults: string[] = [];
    for (let i = 0; i < batches.length; i++) {
      const batchInput = batches[i]
        .map((s, j) => `[Bagian ${j + 1}]\n${s}`)
        .join("\n\n");

      logger.log(`[MERGE depth=${depth} BATCH ${i + 1}/${batches.length}] Starting, ${batches[i].length} summaries, ${batchInput.length} chars`);

      onProgress?.(i + 1, batches.length + 1);

      const result = await summarizeWithGroq(batchInput, apiKey, {
        systemPrompt: MERGE_INTERMEDIATE_PROMPT,
        maxTokens: 1500,
        glossary: resolveGlossaryFromContext(glossaryContext, batchInput),
        pipeline,
      });

      batchResults.push(result);
      logger.log(`[MERGE depth=${depth} BATCH ${i + 1}/${batches.length}] Done, result length: ${result.length} chars`);

      // Checkpoint after each batch
      if (onBatchComplete) {
        await onBatchComplete([...batchResults]);
      }

      if (i < batches.length - 1) {
        await sleep(62000);
      }
    }

    onProgress?.(batches.length + 1, batches.length + 1);
    await sleep(62000);
    // Inner reduce rounds: no onBatchComplete — checkpoints only for outermost merge
    logger.log(`>>> [MERGE depth=${depth}] All batches done, recursing to depth=${depth + 1} with ${batchResults.length} results`);
    return mergeSummariesOnce(batchResults, apiKey, glossaryContext, onProgress, onBatchComplete, depth + 1);
}

export interface MergeSummariesOptions {
  /** Pre-resolved per-call glossary string (legacy). Prefer glossaryContext. */
  glossary?: string;
  glossaryContext?: GlossaryContext;
  onProgress?: MergeProgress;
  onBatchComplete?: (batchResults: string[]) => Promise<void>;
}

export async function mergeSummaries(
  summaries: string[],
  apiKey: string,
  optionsOrProgress?: MergeProgress | MergeSummariesOptions,
  legacyOnProgress?: MergeProgress
): Promise<string> {
  const options =
    optionsOrProgress && typeof optionsOrProgress === "object"
      ? (optionsOrProgress as MergeSummariesOptions)
      : undefined;

  let glossaryContext: GlossaryContext | undefined;
  let onProgress: MergeProgress | undefined;

  if (typeof optionsOrProgress === "function") {
    onProgress = optionsOrProgress;
  } else if (options) {
    glossaryContext = options.glossaryContext;
    onProgress = options.onProgress;
  }
  if (legacyOnProgress) onProgress = legacyOnProgress;

  return mergeSummariesOnce(
    summaries,
    apiKey,
    glossaryContext,
    onProgress,
    options?.onBatchComplete
  );
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

/** Parse "try again in X.XXs", "try again in Xm Y.Zs", or "try again in Xms" from Groq 429 error. Returns ms to wait, or default. */
export function parseRetryAfterMs(errBody: string, defaultMs: number): number {
  const msMatch = errBody.match(/try again in (\d+)ms/i);
  if (msMatch) {
    return Math.ceil(parseInt(msMatch[1], 10)) + 500;
  }
  const minSecMatch = errBody.match(/try again in (\d+)m\s*([\d.]+)s/i);
  if (minSecMatch) {
    const minutes = parseInt(minSecMatch[1], 10);
    const seconds = parseFloat(minSecMatch[2]);
    return Math.ceil((minutes * 60 + seconds) * 1000) + 5000;
  }
  const secMatch = errBody.match(/try again in ([\d.]+)s/i);
  if (secMatch) {
    const sec = parseFloat(secMatch[1]);
    return Math.ceil(sec * 1000) + 5000;
  }
  return defaultMs;
}

function formatMsAsDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds}s`;
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
): Promise<{ content: string; headers: Headers }> {
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
        ...(model.startsWith("openai/gpt-oss") ? { 
          include_reasoning: false,
          reasoning_effort: "low"
        } : {}),
      }),
    });

    const rawBody = await res.clone().text();
    try {
      const parsed = JSON.parse(rawBody);
      logger.log(
        "[GROQ]",
        res.status,
        "completion_tokens:",
        parsed?.usage?.completion_tokens,
        "reasoning_tokens:",
        parsed?.usage?.completion_tokens_details?.reasoning_tokens,
        "content_len:",
        parsed?.choices?.[0]?.message?.content?.length
      );
    } catch {
      logger.log("[GROQ]", res.status, "(parse failed)");
    }

    if (res.ok) {
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = json.choices?.[0]?.message?.content?.trim() ?? "";
      return { content: fixCommonTypos(raw), headers: res.headers };
    }

    const errBody = await res.text();
    if (res.status === 429) {
      logger.warn("[429 DETAIL]", errBody, "parsed wait ms:", parseRetryAfterMs(errBody, 60_000), `(${formatMsAsDuration(parseRetryAfterMs(errBody, 60_000))})`);
    }
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

export type SummarizeWithGroqOptions = {
  isChunk?: boolean;
  isMerge?: boolean;
  glossary?: string;
  isAudio?: boolean;
  returnHeaders?: boolean;
  /** 0-based index for dev logging when summarizing audio chunks. */
  chunkIndex?: number;
  /** Total chunk count for dev logging when summarizing audio chunks. */
  chunkTotal?: number;
  /** Overrides default system prompt from isChunk/isMerge flags; glossary is still appended. */
  systemPrompt?: string;
  /** Explicit max_tokens for the completion. */
  maxTokens?: number;
  /** When set with merge-style calls, applies merge rate-limit retries from pipeline config. */
  pipeline?: SummarizePipelineConfig;
};

export async function summarizeWithGroq(
  content: string,
  apiKey: string,
  options: SummarizeWithGroqOptions & { returnHeaders: true }
): Promise<{ content: string; headers: Headers }>;
export async function summarizeWithGroq(
  content: string,
  apiKey: string,
  options?: SummarizeWithGroqOptions
): Promise<string>;
export async function summarizeWithGroq(
  content: string,
  apiKey: string,
  options?: SummarizeWithGroqOptions
): Promise<string | { content: string; headers: Headers }> {
  const isAudio = options?.isAudio === true;
  const explicitSystem = options?.systemPrompt;

  const basePrompt = explicitSystem
    ? explicitSystem
    : options?.isMerge
      ? SUMMARIZE_MERGE_PROMPT
      : options?.isChunk
        ? isAudio
          ? SUMMARIZE_CHUNK_MEETING_PROMPT
          : SUMMARIZE_CHUNK_DOC_PROMPT
        : SUMMARIZE_PROMPT;

  const glossaryNote = options?.glossary ? `\n\n${options.glossary}` : "";

  const fullSystemPrompt = basePrompt + glossaryNote;

  const userLabel =
    explicitSystem || options?.isMerge
      ? "Rangkuman per bagian:\n\n"
      : options?.isChunk
        ? "Bagian:\n\n"
        : "Dokumen:\n\n";

  const resolvedMaxTokens =
    options?.maxTokens !== undefined
      ? options.maxTokens
      : options?.isMerge
        ? 600
        : options?.isChunk
          ? isAudio
            ? 3000
            : 250
          : undefined;

  const callOpts =
    resolvedMaxTokens !== undefined ? { maxTokens: resolvedMaxTokens } : undefined;

  const execute = () =>
    callGroqApi(
      [
        { role: "system", content: fullSystemPrompt },
        { role: "user", content: userLabel + content },
      ],
      apiKey,
      callOpts
    );

  const useMergeResilience =
    Boolean(options?.pipeline) &&
    (Boolean(explicitSystem) || options?.isMerge === true);

  if (useMergeResilience && options?.pipeline) {
    const pipeline = options.pipeline;
    let lastErr: unknown;
    for (let attempt = 0; attempt < pipeline.mergeRateLimitMaxAttempts; attempt++) {
      try {
        const mergeResult = await execute();
        if (options?.returnHeaders === true) {
          return mergeResult;
        }
        return mergeResult.content;
      } catch (e) {
        lastErr = e;
        if (!isGroqRateLimitError(e) || attempt >= pipeline.mergeRateLimitMaxAttempts - 1) {
          throw e;
        }
        await sleep(pipeline.mergeRateLimitBackoffMs);
      }
    }
    throw lastErr ?? new Error("Summarization failed.");
  }

  const result = await execute();
  if (options?.isChunk && isAudio) {
    const idx =
      options.chunkIndex != null ? options.chunkIndex + 1 : "?";
    const total = options.chunkTotal ?? "?";
    logger.log(
      `>>> [SUMMARIZE_CHUNK ${idx}/${total}] Input: ${content.length} chars`
    );
    logger.log(
      `>>> [SUMMARIZE_CHUNK ${idx}/${total}] Output (${result.content.length} chars):\n${result.content}`
    );
  }
  if (options?.returnHeaders === true) {
    return result;
  }
  return result.content;
}

export async function refineWithGroq(
  currentSummary: string,
  newChunk: string,
  apiKey: string
): Promise<string> {
  return (
    await callGroqApi(
      [
        { role: "system", content: REFINE_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Rangkuman saat ini:\n\n${currentSummary}\n\n---\n\nBagian baru dari dokumen:\n\n${newChunk}`,
        },
      ],
      apiKey
    )
  ).content;
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

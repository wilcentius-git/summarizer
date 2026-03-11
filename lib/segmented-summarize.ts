/**
 * Segmented summarization logic (format check + summarize).
 * Used by /api/summarize-segmented and the rate-limit retry worker.
 */

import {
  fixCommonTypos,
  getGroqUserFriendlyError,
  GROQ_API_URL,
  GROQ_MODEL,
  MAX_TEXT_LENGTH,
  parseRetryAfterMs,
  splitIntoChunks,
  sleep,
  SUMMARIZE_CHUNK_DELAY_MS,
  SUMMARIZE_MERGE_PRE_DELAY_MS,
  deduplicateSummaryPoints,
  isGroqRateLimitError,
  mergeSummaries,
} from "@/lib/groq";

export const NO_SEGMENTED_FORMAT = "no segmented opinion format";
export const SEGMENTED_CHUNK_SIZE = 8000;

const FORMAT_CHECK_PROMPT = `Anda memeriksa apakah teks berikut memiliki format "label dan opini" yang jelas.

Format yang valid: teks memiliki segmen dengan label (nama pembicara, topik, atau judul bagian) diikuti oleh opini atau pendapat. Contoh:
- "Budi: Saya setuju dengan proposal ini karena..."
- "Topik A: Menurut saya opsi pertama lebih baik..."
- "[Pembicara 1]: Pendapat saya adalah..."

Jika teks TIDAK memiliki format label+opini yang jelas (misalnya: teks naratif biasa, dokumen tanpa pembagian per pembicara/topik, atau teks yang tidak terstruktur), jawab dengan TEPAT:
${NO_SEGMENTED_FORMAT}

Jika teks MEMILIKI format label+opini yang jelas, jawab dengan satu kata: VALID

Teks:

`;

const SEGMENTED_SUMMARIZE_PROMPT = `Teks berikut memiliki format label dan opini (transkrip percakapan dengan pembicara). Tugas Anda: rangkum dalam format daftar bernomor kronologis, singkat dan padat.

Format output (WAJIB ikuti—HANYA 3 bagian):
**Ringkasan Eksekutif:**
[2–3 kalimat yang merangkum inti percakapan: topik utama, aktor utama, kesimpulan utama]

**Rangkuman :**
1. [Poin pertama sesuai urutan kronologis]
2. [Poin kedua]
3. [Poin ketiga]
... (lanjutkan dengan nomor berurutan)

**Insight tambahan:** 2–3 insight yang actionable.

Gunakan tata bahasa formal Indonesia ("Dengan demikian", "Oleh karena itu", "Dapat disimpulkan bahwa", "Perlu dilakukan", "Disarankan agar"). Daftar bernomor BERAKHIR sebelum Insight tambahan—jangan lanjutkan penomoran di dalam Insight tambahan. Format Insight tambahan TANPA nomor. JANGAN tambahkan Kesimpulan, Ringkasan, atau sub-bagian "Rangkasan [topik]".

Aturan:
- Gunakan sudut pandang orang ketiga (mis. "Pembicara menjelaskan...", "Peserta menyatakan..."). Jangan gunakan "saya", "kita", atau "anda".
- Urutkan poin sesuai kronologi kejadian (dari awal hingga akhir percakapan).
- FOKUS PADA INTI: Rangkum hanya poin penting dan esensial. Maksimal 5–6 poin utama per bagian. Setiap poin 1 kalimat singkat.
- PRIORITAS: Hanya sertakan poin yang benar-benar penting dan substantif. Prioritaskan: keputusan, kebijakan, angka, nama, dan rekomendasi konkret.
- Hindari pengulangan. Gabungkan poin serupa. DEDUPLIKASI: Poin yang sama hanya disebut SATU KALI.
- Gunakan **bold** untuk nama orang, organisasi, istilah teknis.
- Sub-poin: hanya jika benar-benar penting, gunakan 4 spasi sebelum "- ". Maksimal 1 sub-poin per poin utama.
- Tanpa pembukaan lain, langsung **Ringkasan Eksekutif:** diikuti **Rangkuman :** diikuti daftar bernomor, diakhiri **Insight tambahan:**.

Teks:

`;

function ensureSubBulletIndentation(text: string): string {
  if (!text) return text;
  return text.replace(/^(\s{0,3})([-•]\s+)/gm, "    $2");
}

export type ResumeOptions = {
  startFromChunk: number;
  initialSummaries: string[];
  onChunkComplete?: (chunkIndex: number, part: string, totalChunks: number) => Promise<void>;
};

export async function checkFormatAndSummarize(
  text: string,
  apiKey: string,
  send?: (obj: object) => void,
  resume?: ResumeOptions
): Promise<{ summary: string } | { error: string; isRateLimit?: boolean }> {
  const trimmed = text.trim().slice(0, MAX_TEXT_LENGTH);
  if (!trimmed) {
    return { error: "No text to process." };
  }

  const chunks = splitIntoChunks(trimmed, SEGMENTED_CHUNK_SIZE);
  const startFromChunk = resume?.startFromChunk ?? 0;
  const initialSummaries = resume?.initialSummaries ?? [];

  if (startFromChunk >= chunks.length && initialSummaries.length > 0) {
    let summary: string;
    if (initialSummaries.length > 1) {
      send?.({
        type: "progress",
        step: 3,
        stepLabel: "Rangkuman",
        message: "Menggabungkan rangkuman…",
      });
      await sleep(SUMMARIZE_MERGE_PRE_DELAY_MS);
      try {
        summary = await mergeSummaries(initialSummaries, apiKey);
      } catch (err) {
        if (isGroqRateLimitError(err)) {
          return {
            error: getGroqUserFriendlyError(429) ?? "Groq rate limit reached.",
            isRateLimit: true,
          };
        }
        throw err;
      }
    } else {
      summary = initialSummaries[0] ?? "Rangkuman tidak dapat dibuat.";
    }
    summary = fixCommonTypos(summary);
    summary = deduplicateSummaryPoints(ensureSubBulletIndentation(summary));
    return { summary };
  }

  if (startFromChunk > 0) {
    if (startFromChunk >= chunks.length) {
      return { error: "Invalid resume: startFromChunk >= total chunks." };
    }
  }

  const formatCheckChunk = chunks[0];
  let formatRes: Response | null = null;

  if (startFromChunk === 0) {
  for (let attempt = 0; attempt <= 3; attempt++) {
    const r = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: "user", content: FORMAT_CHECK_PROMPT + formatCheckChunk }],
        max_tokens: 64,
        temperature: 0,
      }),
    });
    if (r.ok) {
      formatRes = r;
      break;
    }
    const errBody = await r.text();
    if (r.status === 429 && attempt < 3) {
      await sleep(parseRetryAfterMs(errBody, 35000));
      continue;
    }
    const friendly = getGroqUserFriendlyError(r.status);
    return {
      error: friendly ?? `Format check failed: ${r.status}. ${errBody}`,
      ...(r.status === 429 && { isRateLimit: true }),
    };
  }

  const json = (await formatRes!.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const reply = (json.choices?.[0]?.message?.content ?? "").trim();

  if (reply.toLowerCase().includes(NO_SEGMENTED_FORMAT) || reply.toLowerCase().includes("no segmented")) {
    return { error: NO_SEGMENTED_FORMAT };
  }

  if (!reply.toUpperCase().includes("VALID")) {
    return { error: NO_SEGMENTED_FORMAT };
  }
  }

  const summaries = [...initialSummaries];
  for (let i = startFromChunk; i < chunks.length; i++) {
    if (chunks.length > 1) {
      send?.({
        type: "progress",
        step: 3,
        stepLabel: "Rangkuman",
        message: `Merangkum bagian ${i + 1} dari ${chunks.length}…`,
      });
    }
    let sumRes: Response | null = null;
    for (let attempt = 0; attempt <= 3; attempt++) {
      const r = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [{ role: "user", content: SEGMENTED_SUMMARIZE_PROMPT + chunks[i] }],
          max_tokens: 2048,
          temperature: 0.3,
        }),
      });
      if (r.ok) {
        sumRes = r;
        break;
      }
      const errBody = await r.text();
      if (r.status === 429 && attempt < 3) {
        await sleep(parseRetryAfterMs(errBody, 35000));
        continue;
      }
      const friendly = getGroqUserFriendlyError(r.status);
      return {
        error: friendly ?? `Summarization failed: ${r.status}. ${errBody}`,
        ...(r.status === 429 && { isRateLimit: true }),
      };
    }

    const sumJson = (await sumRes!.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const part = sumJson.choices?.[0]?.message?.content?.trim() ?? "";
    if (part) {
      summaries.push(part);
      await resume?.onChunkComplete?.(i, part, chunks.length);
    }

    if (i < chunks.length - 1) {
      await sleep(SUMMARIZE_CHUNK_DELAY_MS);
    }
  }

  let summary: string;
  if (summaries.length > 1) {
    send?.({
      type: "progress",
      step: 3,
      stepLabel: "Rangkuman",
      message: "Menggabungkan rangkuman…",
    });
    await sleep(SUMMARIZE_MERGE_PRE_DELAY_MS);
    try {
      summary = await mergeSummaries(summaries, apiKey, (current, total) => {
        if (total > 1) {
          send?.({
            type: "progress",
            step: 3,
            stepLabel: "Rangkuman",
            message: `Menggabungkan bagian ${current} dari ${total}…`,
          });
        }
      });
    } catch (err) {
      if (isGroqRateLimitError(err)) {
        return {
          error: getGroqUserFriendlyError(429) ?? "Groq rate limit reached.",
          isRateLimit: true,
        };
      }
      throw err;
    }
  } else {
    summary = summaries[0] ?? "Rangkuman tidak dapat dibuat.";
  }

  summary = fixCommonTypos(summary);
  summary = deduplicateSummaryPoints(summary);
  summary = ensureSubBulletIndentation(summary);
  return { summary };
}

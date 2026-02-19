import { NextRequest, NextResponse } from "next/server";

import {
  extractText,
  isSupportedFileName,
  isSupportedMimeType,
  resolveMimeType,
} from "@/lib/extract-text";
import { pdfPagesToImages, type PdfPageImage } from "@/lib/pdf-to-images";

const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB
const MAX_TEXT_LENGTH = 30000;
const MIN_TEXT_FOR_SKIP_OCR = 50;
const GROQ_IMAGES_PER_REQUEST = 1;
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.1-8b-instant";
const GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

async function callVisionApi(
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

async function extractTextFromImages(
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

const SYSTEM_PROMPT = `You are a meeting analysis engine for Indonesian business conversations.
Extract structured facts. Never label anyone as "imposter", "liar", or "performative".
Output alignment risk indicators as observable patterns with evidence, not character judgments.
If uncertain, use stance "unclear".

IMPORTANT: Distinguish information from opinion. Factual reports, data, statistics, and neutral descriptions are NOT disagreement or risk. Only flag opinion/stance with intent. Informational content counts as disagreement ONLY if it contains hidden intent to attack or offend.

Return ONLY valid JSON. No markdown.`;

function buildUserPrompt(
  leaderName: string,
  leaderPosition: string,
  transcript: string
): string {
  return `Context:
- Leader: ${leaderName}
- Leader position: ${leaderPosition}
- Language: Indonesian
- Format: "Speaker: text"

Task: For each participant (EXCLUDE the leader "${leaderName}"), extract topic-level stances and alignment risks.

Classify stance toward leader using Indonesian markers. Apply the same classification to any phrase with similar meaning or context.

STRONG SUPPORT — stance "support", agreement_confidence 4–5:
"setuju", "sepakat", "gas", "jalan", "oke, eksekusi", "saya dukung", "ini paling masuk akal", "kita commit". Same for similar: "saya setuju penuh", "mantap", "oke lanjut", etc.

SOFT SUPPORT / performative agreement risk — stance "mixed", flag as risk:
"iya…", "boleh sih", "oke juga", "yaudah", "ikut aja", "terserah", "setuju, tapi…", "sepakat, cuma…", "boleh, hanya…", "nanti kita lihat", "kayaknya", "mungkin", "sepertinya", "kalau bisa", "kalau memungkinkan", "idealnya", "noted", "siap" (without detail). Same for similar: "oke deh", "terserah deh", "ikut saja", etc.

OPPOSE — stance "oppose", agreement_confidence 1–2:
"kurang setuju", "saya tidak sepakat", "menurut saya ini riskan", "jangan dulu", "ini belum siap", "ini terlalu cepat", "nggak masuk". Same for similar: "tidak setuju", "belum siap", "terlalu riskan", etc.

DEFLECTION / AVOIDANCE — flag as risk type "deflection":
"tergantung", "balik lagi", "lihat nanti", "diinfokan aja", "mohon arahan", "menyesuaikan". Same for similar: "nanti saja", "ikuti arahan", "menunggu keputusan", etc.

Risk types (score 0–1, higher = stronger signal). Apply ONLY to opinion/stance, NOT to informational content:
- hedging: soft support markers without substance (e.g., "mungkin"/"kayaknya"/"oke juga"/"siap" alone)
- concession_flip: "setuju, tapi…" / "sepakat, cuma…" / "boleh, hanya…" with blockers (or similar)
- vagueness: EMPTY agreement — "setuju"/"oke" with NO concrete follow-through. Do NOT flag when speaker provides concrete solutions or direct responses to concerns.
- deflection: deflection/avoidance markers (e.g., "tergantung"/"mohon arahan"/"menyesuaikan" or similar)
- inconsistency: support then oppose (or vice versa) on same topic
- no_ownership: supports publicly, avoids tasks (only if visible)

Schema (strict):
{
  "leader": {"name": "string", "position": "string"},
  "participants": [
    {
      "speaker": "string",
      "agreement_confidence": 1,
      "points": [{"topic": "string", "stance": "support|mixed|oppose|unclear", "evidence": ["quote"]}],
      "risks": [{"type": "hedging|concession_flip|vagueness|deflection|inconsistency|no_ownership", "score": 0.0, "evidence": ["quote"]}],
      "summary": "One sentence: X shows [pattern] ([N] instances): [evidence]. Omit if no risks."
    }
  ]
}

agreement_confidence: 1–5 scale. 1 = not agree at all, 5 = fully agree with leader. Required for each participant.
MUST be consistent with points: if most/all points are "oppose" → 1–2; if most "support" → 4–5; if "mixed" → 3.
Never output 4/5 when points show opposition. Never output 1/2 when points show support.

Rules:
- Exclude leader from participants.
- ONE ENTRY PER PERSON: Each speaker appears exactly ONCE in participants. Combine ALL their opinions, points, and risks into that single entry. Do not split by opinion — group by person.
- points: all topic-level stances for this person in one array. At least one per participant.
- risks: all observed risks for this person in one array. score 0–1. evidence: exact quotes.
- summary: one brief narrative when risks exist. Omit if empty.
- Do not invent content.

CRITICAL — Information vs opinion:
- INFORMATIONAL content (facts, data, statistics, reports, neutral descriptions) is NOT disagreement or risk.
- Example: "Sekitar 9% output memerlukan revisi substansial" = factual report, NOT vagueness or opposition.
- Only flag as disagreement/risk when the speaker expresses OPINION, STANCE, or agreement/disagreement.
- Do NOT count informational statements as disagreement unless they contain HIDDEN INTENT to attack or offend the opponent's opinion (e.g., sarcasm, belittling, undermining).
- When in doubt whether something is information vs opinion, default to information — do not flag.

CRITICAL — Vagueness vs substantive response:
- vagueness = empty "setuju"/"oke" with nothing concrete. No mechanism, no action, no answer to concerns.
- Do NOT flag as vagueness when the speaker provides concrete solutions, mechanisms, or direct answers to concerns raised by opponent. Example: "Kami telah menyiapkan mekanisme logging dan versioning" = addressing audit/transparency concern = substantive, NOT vague.

Similar context: When a phrase has similar meaning or intent to the markers above, classify it the same way (e.g., "saya mendukung" = strong support like "saya dukung"; "nggak yakin" = oppose like "kurang setuju").

Transcript:

${transcript}`;
}

function parseJsonResponse(raw: string): unknown {
  let cleaned = raw.trim();
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }
  return JSON.parse(cleaned) as unknown;
}

type ParticipantShape = {
  speaker: string;
  agreement_confidence?: number;
  points?: Array<{ topic: string; stance: string; evidence?: string[] }>;
  risks?: Array<{ type: string; score: number; evidence?: string[] }>;
  summary?: string;
};

function deriveAgreementFromPoints(points: ParticipantShape["points"]): number | null {
  if (!points?.length) return null;
  const oppose = points.filter((pt) => pt.stance === "oppose").length;
  const support = points.filter((pt) => pt.stance === "support").length;
  const mixed = points.filter((pt) => pt.stance === "mixed").length;
  const total = points.length;
  if (oppose === total) return 1;
  if (support === total) return 5;
  if (support > oppose) return 4;
  if (oppose > support) return 2;
  return 3;
}

function mergeParticipantsBySpeaker(participants: ParticipantShape[]): ParticipantShape[] {
  const bySpeaker = new Map<string, ParticipantShape>();
  for (const p of participants) {
    const key = (p.speaker ?? "").trim().toLowerCase() || "(unknown)";
    const existing = bySpeaker.get(key);
    if (!existing) {
      bySpeaker.set(key, {
        speaker: p.speaker,
        agreement_confidence: p.agreement_confidence,
        points: [...(p.points ?? [])],
        risks: [...(p.risks ?? [])],
        summary: p.summary,
      });
    } else {
      existing.points = [...(existing.points ?? []), ...(p.points ?? [])];
      existing.risks = [...(existing.risks ?? []), ...(p.risks ?? [])];
      if (p.agreement_confidence != null && existing.agreement_confidence == null) {
        existing.agreement_confidence = p.agreement_confidence;
      }
      if (p.summary && !existing.summary) existing.summary = p.summary;
    }
  }
  const merged = Array.from(bySpeaker.values());
  for (const m of merged) {
    const derived = deriveAgreementFromPoints(m.points);
    if (derived != null && m.points && m.points.length > 0) {
      m.agreement_confidence = derived;
    }
  }
  return merged;
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "Groq API key is not configured. Set GROQ_API_KEY in .env.local.",
        },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const leaderName = (formData.get("leaderName") as string)?.trim() ?? "";
    const leaderPosition =
      (formData.get("leaderPosition") as string)?.trim() ?? "";

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "No document file provided." },
        { status: 400 }
      );
    }

    if (!leaderName) {
      return NextResponse.json(
        { error: "Leader name is required. Siapa Anda dalam percakapan ini?" },
        { status: 400 }
      );
    }

    const fileName = file instanceof File ? file.name : "file";
    const resolvedMime = resolveMimeType(file.type, fileName);
    if (!isSupportedMimeType(resolvedMime) && !isSupportedFileName(fileName)) {
      return NextResponse.json(
        {
          error:
            "Unsupported file type. Supported: PDF, DOCX, DOC, TXT, RTF, ODT.",
        },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File exceeds ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB.` },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const ocrFallback =
      resolvedMime === "application/pdf"
        ? async (images: PdfPageImage[]) => {
            const chunks: string[] = [];
            const totalPages = images.length;
            for (let i = 0; i < images.length; i += GROQ_IMAGES_PER_REQUEST) {
              const batch = images.slice(i, i + GROQ_IMAGES_PER_REQUEST);
              const extracted = await extractTextFromImages(
                batch,
                apiKey,
                totalPages
              );
              const pageNum = batch[0].pageNum;
              chunks.push(
                extracted.trim()
                  ? `[Halaman ${pageNum}]\n${extracted}`
                  : `[Halaman ${pageNum}]\n(Konten halaman ini tidak dapat diekstrak.)`
              );
            }
            return chunks.join("\n\n");
          }
        : undefined;

    let text = await extractText(buffer, resolvedMime, {
      ocrFallback,
    });

    if (!text.trim()) {
      return NextResponse.json(
        {
          error:
            resolvedMime === "application/pdf"
              ? "No text could be extracted. The PDF may be scanned—OCR failed. Try a different file."
              : "No text could be extracted from the document.",
        },
        { status: 400 }
      );
    }

    if (text.length > MAX_TEXT_LENGTH) {
      text =
        text.slice(0, MAX_TEXT_LENGTH) + "\n\n[Text truncated for length.]";
    }

    const userPrompt = buildUserPrompt(
      leaderName,
      leaderPosition || "(tidak disebutkan)",
      text
    );

    const groqResponse = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 8192,
        temperature: 0.2,
      }),
    });

    if (!groqResponse.ok) {
      const errBody = await groqResponse.text();
      console.error("Groq API error:", groqResponse.status, errBody);
      return NextResponse.json(
        { error: `Groq API error: ${groqResponse.status}. ${errBody}` },
        { status: 502 }
      );
    }

    const json = (await groqResponse.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rawContent = json.choices?.[0]?.message?.content?.trim() ?? "";

    let analysis: unknown;
    try {
      analysis = parseJsonResponse(rawContent);
    } catch (parseErr) {
      console.error("Meeting analysis JSON parse error:", parseErr);
      return NextResponse.json(
        {
          error:
            "Failed to parse meeting analysis. The model may have returned invalid JSON.",
        },
        { status: 502 }
      );
    }

    const hasParticipants =
      analysis &&
      typeof analysis === "object" &&
      Array.isArray((analysis as { participants?: unknown }).participants);
    if (!hasParticipants) {
      return NextResponse.json(
        { error: "Invalid analysis: missing participants array." },
        { status: 502 }
      );
    }

    const raw = analysis as { participants: ParticipantShape[] };
    raw.participants = mergeParticipantsBySpeaker(raw.participants);

    return NextResponse.json({ analysis });
  } catch (err) {
    console.error("Summarize meeting error:", err);
    const message =
      err instanceof Error ? err.message : "Meeting analysis failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

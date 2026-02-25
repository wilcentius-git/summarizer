import { NextRequest, NextResponse } from "next/server";

import {
  extractText,
  isSupportedFileName,
  isSupportedMimeType,
  resolveMimeType,
} from "@/lib/extract-text";
import {
  createOcrFallback,
  GROQ_API_URL,
  GROQ_MODEL,
  MAX_FILE_SIZE_BYTES,
  MAX_TEXT_LENGTH,
} from "@/lib/groq";
import {
  isAudioFileName,
  isAudioMimeType,
  MAX_AUDIO_SIZE_BYTES,
  resolveAudioMimeType,
  transcribeWithGroq,
} from "@/lib/transcribe-audio";

/**
 * Preprocesses and normalizes a meeting transcript for consistent parsing.
 * - Normalizes whitespace and line endings
 * - Parses "Speaker: text" turns (handles "Name:", "Name :", "Bpk. Name:", etc.)
 * - Strips common Indonesian prefixes (Bpk., Bapak, Ibu, Pak, Bu) for canonical speaker names
 * - Ensures consistent "Speaker: text" format with clear turn separation
 */
function normalizeTranscript(raw: string): string {
  let text = raw
    .replace(/\r\n|\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();

  const lines = text.split("\n");
  const turns: Array<{ speaker: string; text: string }> = [];
  const speakerPattern = /^([^:\n]+)\s*:\s*(.*)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const match = line.match(speakerPattern);
    if (match) {
      const rawSpeaker = match[1].trim();
      const content = match[2].trim();
      const speaker = rawSpeaker
        .replace(/^(Bpk\.?|Bapak|Pak|Ibu|Bu)\s+/i, "")
        .trim() || rawSpeaker;
      if (content) {
        turns.push({ speaker, text: content });
      } else {
        let continuation = "";
        while (i + 1 < lines.length && lines[i + 1].trim() && !lines[i + 1].trim().match(speakerPattern)) {
          i++;
          continuation += (continuation ? " " : "") + lines[i].trim();
        }
        if (continuation) {
          turns.push({ speaker, text: continuation });
        }
      }
    } else if (turns.length > 0) {
      turns[turns.length - 1].text += " " + line;
    }
  }

  return turns.map((t) => `${t.speaker}: ${t.text}`).join("\n\n");
}

const SYSTEM_PROMPT = `You are a meeting analysis engine for Indonesian business conversations.
Extract structured facts. Never label anyone as "imposter", "liar", or "performative".
Output alignment risk indicators as observable patterns with evidence, not character judgments.
If uncertain, use stance "unclear".

IMPORTANT: Distinguish information from opinion. Factual reports, data, statistics, and neutral descriptions are NOT disagreement or risk. Only flag opinion/stance with intent. Informational content counts as disagreement ONLY if it contains hidden intent to attack or offend.

CRITICAL: Deferral ("ikut keputusan manajemen saja", "siap menyesuaikan", "ikuti arahan") is NOT opposition. Attribute each quote ONLY to the speaker who said it — verify against the transcript.

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

SOFT SUPPORT / weak agreement / deferral — stance "mixed", flag as risk:
Weak agreement = agree but not fully committed. Deferral to others = NOT oppose. Key markers: "ya, saya mengikuti saja", "ikut aja", "ikut saja", "ikut keputusan manajemen saja", "siap menyesuaikan", "iya…", "boleh sih", "oke juga", "yaudah", "terserah", "setuju, tapi…", "sepakat, cuma…", "boleh, hanya…", "nanti kita lihat", "kayaknya", "mungkin", "sepertinya", "kalau bisa", "kalau memungkinkan", "idealnya", "noted", "siap" (without detail). Same for similar: "oke deh", "terserah deh", "ikuti keputusan", "ikut arahan", etc.

OPPOSE — stance "oppose", agreement_confidence 1–2:
ONLY when speaker explicitly disagrees or rejects. "kurang setuju", "saya tidak sepakat", "menolak", "menurut saya ini riskan", "jangan dulu", "ini belum siap", "ini terlalu cepat", "nggak masuk". Same for similar: "tidak setuju", "belum siap", "terlalu riskan", etc.
Do NOT use oppose for deferral ("ikut keputusan manajemen saja", "siap menyesuaikan") — those are mixed/deflection.

DEFLECTION / AVOIDANCE — stance "mixed", flag as risk type "deflection":
"tergantung", "balik lagi", "lihat nanti", "diinfokan aja", "mohon arahan", "menyesuaikan", "ikut keputusan manajemen saja", "siap menyesuaikan". Same for similar: "nanti saja", "ikuti arahan", "menunggu keputusan", etc.

Risk types (score 0–1, higher = stronger signal). Apply ONLY to opinion/stance, NOT to informational content:
- hedging: weak agreement without substance (e.g., "ya, saya mengikuti saja"/"ikut saja"/"mungkin"/"kayaknya"/"oke juga"/"siap" alone)
- concession_flip: "setuju, tapi…" / "sepakat, cuma…" / "boleh, hanya…" with blockers (or similar)
- vagueness: EMPTY agreement — "setuju"/"oke" with NO concrete follow-through. Do NOT flag when speaker provides concrete solutions or direct responses to concerns.
- deflection: deflection/avoidance markers (e.g., "tergantung"/"mohon arahan"/"menyesuaikan" or similar)
- inconsistency: ONLY when speaker contradicts themselves on the SAME topic (e.g., first supports, then opposes). Do NOT use for the same vague phrase ("ikut saja", etc.) repeated across different topics — that is hedging/vagueness, not inconsistency.
- no_ownership: supports publicly, avoids tasks (only if visible)

Risk evidence rules:
- Each risk type should have distinct evidence when possible. Do NOT assign the same quote to multiple risk types unless it clearly demonstrates each.
- Score: 0.3–0.5 = moderate signal, 0.6–0.8 = strong signal. Vary scores by strength of evidence — avoid identical scores for all risks.

Schema (strict):
{
  "leader": {"name": "string", "position": "string"},
  "participants": [
    {
      "speaker": "string",
      "agreement_confidence": 1,
      "points": [{"topic": "string", "stance": "support|mixed|oppose|unclear", "evidence": ["quote"]}],
      "risks": [{"type": "hedging|concession_flip|vagueness|deflection|inconsistency|no_ownership", "score": 0.0, "evidence": ["quote"]}],
      "summary": "One concise sentence: X shows [pattern]. Omit if no risks. Do not repeat the same evidence multiple times."
    }
  ]
}

agreement_confidence: 1–5 scale. 1 = not agree at all, 5 = fully agree with leader. Required for each participant.
MUST be consistent with points: if most/all points are "oppose" → 1–2; if most "support" → 4–5; if "mixed" → 3.
Never output 4/5 when points show opposition. Never output 1/2 when points show support.

CRITICAL — Speaker attribution:
- Each participant's points and risks must use ONLY quotes from that speaker's own turns. Before adding any evidence, verify: does this exact quote appear in the transcript under THIS speaker's name?
- WRONG: Putting Budi's quote under Rina's entry, or Rina's quote under Budi's. RIGHT: Only use quotes from the speaker's own "Name: text" blocks.
- Process one speaker at a time: list their turns from the transcript, then extract points/risks from those turns only. Do not mix speakers.

Rules:
- Exclude leader from participants.
- ONE ENTRY PER PERSON: Each speaker appears exactly ONCE in participants. Combine ALL their opinions, points, and risks into that single entry. Do not split by opinion — group by person.
- points: all topic-level stances for this person in one array. At least one per participant.
- risks: all observed risks for this person in one array. score 0–1. evidence: exact quotes.
- summary: one brief narrative when risks exist. Keep concise; avoid repeating the same evidence multiple times. Omit if empty.
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

CRITICAL — Deferral is NOT opposition:
- "Saya ikut keputusan manajemen saja", "siap menyesuaikan", "ikuti arahan", "ikut keputusan" = speaker defers to others. Classify as "mixed" (not oppose). Flag as deflection/hedging risk if applicable.
- Opposition requires explicit disagreement ("tidak setuju", "menolak", "kurang setuju"). Deferral or "ikut saja" is NOT opposition.

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
    const formData = await request.formData();
    const apiKey = (formData.get("groqApiKey") as string)?.trim();
    const file = formData.get("file");
    const leaderName = (formData.get("leaderName") as string)?.trim() ?? "";
    const leaderPosition =
      (formData.get("leaderPosition") as string)?.trim() ?? "";

    if (!apiKey) {
      return NextResponse.json(
        { error: "Groq API key is required. Get one at https://console.groq.com" },
        { status: 400 }
      );
    }

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
    const resolvedAudioMime = resolveAudioMimeType(file.type, fileName);
    const isAudio =
      isAudioMimeType(resolvedAudioMime) || isAudioFileName(fileName);
    const isDocument =
      isSupportedMimeType(resolvedMime) || isSupportedFileName(fileName);

    if (!isAudio && !isDocument) {
      return NextResponse.json(
        {
          error:
            "Unsupported file type. Supported: PDF, DOCX, DOC, TXT, RTF, ODT, SRT, MP3, WAV, M4A, WebM, FLAC, OGG.",
        },
        { status: 400 }
      );
    }

    const maxSize = isAudio ? MAX_AUDIO_SIZE_BYTES : MAX_FILE_SIZE_BYTES;
    const maxSizeMB = maxSize / (1024 * 1024);
    if (file.size > maxSize) {
      return NextResponse.json(
        {
          error: `File exceeds ${maxSizeMB} MB${isAudio ? " (audio limit for free tier)" : ""}.`,
        },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let text: string;
    if (isAudio) {
      text = await transcribeWithGroq(buffer, apiKey, {
        language: "id",
        fileName,
      });
    } else {
      const ocrFallback =
        resolvedMime === "application/pdf" ? createOcrFallback(apiKey) : undefined;
      text = await extractText(buffer, resolvedMime, {
        ocrFallback,
      });
    }

    if (!text.trim()) {
      return NextResponse.json(
        {
          error: isAudio
            ? "No speech could be transcribed from the audio. Try a different file."
            : resolvedMime === "application/pdf"
              ? "No text could be extracted. The PDF may be scanned—OCR failed. Try a different file."
              : "No text could be extracted from the document.",
        },
        { status: 400 }
      );
    }

    // Whisper returns continuous text without speaker labels; wrap as single speaker for meeting analysis
    const speakerPattern = /^[^:\n]+\s*:\s*.+$/;
    const hasSpeakerTurns = text.split("\n").some((line) => speakerPattern.test(line.trim()));
    if (!hasSpeakerTurns) {
      text = `Speaker: ${text}`;
    }

    if (text.length > MAX_TEXT_LENGTH) {
      text =
        text.slice(0, MAX_TEXT_LENGTH) + "\n\n[Text truncated for length.]";
    }

    text = normalizeTranscript(text);

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

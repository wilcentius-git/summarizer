import { NextRequest, NextResponse } from "next/server";

import {
  extractText,
  isSupportedFileName,
  isSupportedMimeType,
  resolveMimeType,
} from "@/lib/extract-text";
import {
  buildMeetingUserPrompt,
  fixSpeakerAttribution,
  MEETING_SYSTEM_PROMPT,
  mergeParticipantsBySpeaker,
  normalizeSpeakerName,
  normalizeTranscript,
  parseMeetingJsonResponse,
  type ParticipantShape,
} from "@/lib/meeting-analysis";
import {
  createOcrFallback,
  deduplicateParagraphs,
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

    if (isAudio) {
      text = deduplicateParagraphs(text);
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

    const { transcript, turns } = normalizeTranscript(text);

    const userPrompt = buildMeetingUserPrompt(
      leaderName,
      leaderPosition || "(tidak disebutkan)",
      transcript
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
          { role: "system", content: MEETING_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 8192,
        temperature: 0,
        response_format: { type: "json_object" },
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
      analysis = parseMeetingJsonResponse(rawContent);
    } catch (parseErr) {
      console.error("Meeting analysis JSON parse error:", parseErr);
      console.error("Raw content (first 800 chars):", rawContent.slice(0, 800));
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
    raw.participants = fixSpeakerAttribution(raw.participants, turns);
    raw.participants = raw.participants.filter(
      (p) => normalizeSpeakerName(p.speaker) !== normalizeSpeakerName(leaderName)
    );

    return NextResponse.json({ analysis });
  } catch (err) {
    console.error("Summarize meeting error:", err);
    const message =
      err instanceof Error ? err.message : "Meeting analysis failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

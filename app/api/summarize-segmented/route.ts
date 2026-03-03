import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync } from "fs";
import { writeFile, unlink } from "fs/promises";

import {
  extractText,
  isSupportedFileName,
  isSupportedMimeType,
  resolveMimeType,
} from "@/lib/extract-text";
import {
  createOcrFallback,
  deduplicateParagraphs,
  fixCommonTypos,
  GROQ_API_URL,
  GROQ_MODEL,
  MAX_FILE_SIZE_BYTES,
  MAX_TEXT_LENGTH,
  parseRetryAfterMs,
  splitIntoChunks,
  sleep,
  SUMMARIZE_CHUNK_DELAY_MS,
} from "@/lib/groq";
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
  isAudioFileName,
  isAudioMimeType,
  MAX_AUDIO_SIZE_BYTES,
  resolveAudioMimeType,
  transcribeWithGroq,
} from "@/lib/transcribe-audio";

/** Allow long-running diarization (40 min audio can take 1–2 hours on CPU). 2 hours max. Vercel caps by plan. */
export const maxDuration = 7200;

const NO_SEGMENTED_FORMAT = "no segmented opinion format";
/** Max chars per chunk to stay under Groq TPM (~6000 tokens). ~4 chars/token ≈ 18000 chars. */
const SEGMENTED_CHUNK_SIZE = 18000;

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

const SEGMENTED_SUMMARIZE_PROMPT = `Teks berikut memiliki format label dan opini (transkrip percakapan dengan pembicara). Tugas Anda:

1. Identifikasi TOPIK-TOPIK yang dibahas dalam percakapan.
2. Untuk setiap topik, rangkum opini tiap pembicara dan beri label STANCE mereka terhadap pembicara lain atau gagasan yang dibahas:
   - **pro**: mendukung, setuju, memuji, atau menyetujui
   - **con**: menentang, tidak setuju, mengkritik, atau menolak
   - **performative**: netral, formal, sopan, atau lebih bersifat pertunjukan/tidak menunjukkan posisi jelas

Format output (WAJIB ikuti):
**Topik: [nama topik]**
- [Label pembicara]: [Rangkuman opini] — [pro/con/performative]
- [Label pembicara]: [Rangkuman opini] — [pro/con/performative]

**Topik: [topik berikutnya]**
- ...

Aturan:
- Kelompokkan per topik, bukan per pembicara.
- Setiap pembicara yang berpendapat tentang topik tersebut harus dicantumkan dengan opini ringkas dan stance.
- Pisahkan setiap topik dengan baris kosong.
- Tanpa pembukaan lain, langsung rangkuman per topik.

Teks:

`;

function runDiarizeScript(
  audioPath: string,
  hfToken: string
): Promise<{ transcript: string; error?: string; device?: string }> {
  return new Promise((resolve) => {
    const scriptPath = join(process.cwd(), "scripts", "diarize_transcribe.py");
    const venvPython =
      process.platform === "win32"
        ? join(process.cwd(), "summarizer_venv", "Scripts", "python.exe")
        : join(process.cwd(), "summarizer_venv", "bin", "python");
    const python = existsSync(venvPython) ? venvPython : process.platform === "win32" ? "python" : "python3";
    if (!existsSync(venvPython)) {
      console.warn("[diarize] summarizer_venv not found at", venvPython, "- using system python");
    }
    const proc = spawn(python, ["-u", scriptPath, audioPath, hfToken], {
      cwd: process.cwd(),
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      try {
        // Python logs (INFO/ERROR) may mix into stdout; extract the JSON line (last line starting with {)
        const combined = stdout + "\n" + stderr;
        const jsonLine = combined
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.startsWith("{") && s.endsWith("}"))
          .pop();
        const parsed = jsonLine ? JSON.parse(jsonLine) : JSON.parse(stdout.trim());
        if (parsed.error) {
          resolve({ transcript: "", error: parsed.error, device: parsed.device });
        } else {
          resolve({
            transcript: parsed.transcript || "",
            error: undefined,
            device: parsed.device,
          });
        }
      } catch {
        resolve({
          transcript: "",
          error: stderr || stdout || `Script exited with code ${code}`,
        });
      }
    });

    proc.on("error", (err) => {
      resolve({ transcript: "", error: err.message });
    });
  });
}

function sendStreamLine(controller: ReadableStreamDefaultController<Uint8Array>, obj: object) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
}

async function checkFormatAndSummarize(text: string, apiKey: string, send?: (obj: object) => void): Promise<{ summary: string } | { error: string }> {
  const trimmed = text.trim().slice(0, MAX_TEXT_LENGTH);
  if (!trimmed) {
    return { error: "No text to process." };
  }

  const chunks = splitIntoChunks(trimmed, SEGMENTED_CHUNK_SIZE);
  const formatCheckChunk = chunks[0];

  let formatRes: Response | null = null;
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
    return { error: `Format check failed: ${r.status}. ${errBody}` };
  }

  const json = (await formatRes!.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const reply = (json.choices?.[0]?.message?.content ?? "").trim();

  if (reply.toLowerCase().includes(NO_SEGMENTED_FORMAT) || reply.toLowerCase().includes("no segmented")) {
    return { error: NO_SEGMENTED_FORMAT };
  }

  if (!reply.toUpperCase().includes("VALID")) {
    return { error: NO_SEGMENTED_FORMAT };
  }

  const summaries: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
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
          max_tokens: 4096,
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
      return { error: `Summarization failed: ${r.status}. ${errBody}` };
    }

    const sumJson = (await sumRes!.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const part = sumJson.choices?.[0]?.message?.content?.trim() ?? "";
    if (part) summaries.push(part);

    if (i < chunks.length - 1) {
      await sleep(SUMMARIZE_CHUNK_DELAY_MS);
    }
  }

  const summary = fixCommonTypos(summaries.join("\n\n") || "Rangkuman tidak dapat dibuat.");
  return { summary };
}

async function runMeetingAnalysis(
  text: string,
  apiKey: string,
  leaderName: string,
  leaderPosition: string,
  send?: (obj: object) => void
): Promise<{ analysis: { leader?: { name: string; position: string }; participants: ParticipantShape[] } } | { error: string }> {
  const trimmed = text.trim().slice(0, MAX_TEXT_LENGTH);
  const speakerPattern = /^[^:\n]+\s*:\s*.+$/;
  const hasSpeakerTurns = trimmed.split("\n").some((line) => speakerPattern.test(line.trim()));
  const normalizedText = hasSpeakerTurns ? trimmed : `Speaker: ${trimmed}`;

  const { transcript, turns } = normalizeTranscript(normalizedText);
  const userPrompt = buildMeetingUserPrompt(leaderName, leaderPosition || "(tidak disebutkan)", transcript);

  send?.({
    type: "progress",
    step: 4,
    stepLabel: "Analisis rapat",
    message: "Menganalisis stances dan risiko alignment…",
  });

  const r = await fetch(GROQ_API_URL, {
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

  if (!r.ok) {
    const errBody = await r.text();
    return { error: `Meeting analysis failed: ${r.status}. ${errBody}` };
  }

  const json = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const rawContent = json.choices?.[0]?.message?.content?.trim() ?? "";

  let analysis: unknown;
  try {
    analysis = parseMeetingJsonResponse(rawContent);
  } catch {
    return { error: "Failed to parse meeting analysis JSON." };
  }

  const hasParticipants =
    analysis &&
    typeof analysis === "object" &&
    Array.isArray((analysis as { participants?: unknown }).participants);
  if (!hasParticipants) {
    return { error: "Invalid analysis: missing participants array." };
  }

  const raw = analysis as { leader?: { name: string; position: string }; participants: ParticipantShape[] };
  raw.participants = mergeParticipantsBySpeaker(raw.participants);
  raw.participants = fixSpeakerAttribution(raw.participants, turns);
  raw.participants = raw.participants.filter(
    (p) => normalizeSpeakerName(p.speaker) !== normalizeSpeakerName(leaderName)
  );

  return { analysis: { leader: raw.leader, participants: raw.participants } };
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const apiKey = (formData.get("groqApiKey") as string)?.trim();
    const hfToken = (formData.get("hfToken") as string)?.trim();
    const leaderName = (formData.get("leaderName") as string)?.trim() ?? "";
    const leaderPosition = (formData.get("leaderPosition") as string)?.trim() ?? "";
    const file = formData.get("file");

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

    const fileName = file instanceof File ? file.name : "file";
    const resolvedMime = resolveMimeType(file.type, fileName);
    const resolvedAudioMime = resolveAudioMimeType(file.type, fileName);
    const isAudio = isAudioMimeType(resolvedAudioMime) || isAudioFileName(fileName);
    const isDocument = isSupportedMimeType(resolvedMime) || isSupportedFileName(fileName);

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

    const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => {
        try {
          sendStreamLine(controller, obj);
        } catch {
          // Client may have disconnected
        }
      };

      try {
        send({
          type: "progress",
          step: 1,
          stepLabel: isAudio ? "Transkripsi" : "Ekstraksi",
          message: isAudio ? "Mempersiapkan audio…" : "Membaca file…",
        });

        const buffer = Buffer.from(await file.arrayBuffer());
        let text = "";
        let diarized: boolean | undefined;
        let diarizeDevice: string | undefined;

        if (isAudio) {
          diarized = false;
          if (hfToken) {
            send({
              type: "progress",
              step: 1,
              stepLabel: "Diarisasi",
              message: "Menyimpan file ke disk…",
            });
            const ext = fileName.toLowerCase().slice(fileName.lastIndexOf(".")) || ".mp3";
            const tmpPath = join(tmpdir(), `segmented-${Date.now()}${ext}`);
            try {
              await writeFile(tmpPath, buffer);
              send({
                type: "progress",
                step: 1,
                stepLabel: "Diarisasi",
                message: "Menjalankan pyannote (identifikasi pembicara)…",
              });
              const result = await runDiarizeScript(tmpPath, hfToken);
              await unlink(tmpPath).catch(() => {});
              if (!result.error && result.transcript?.trim()) {
                text = result.transcript;
                diarized = true;
                diarizeDevice = result.device;
              } else if (result.error) {
                console.error("[diarize] PyAnote/WhisperX failed, falling back to Groq Whisper:", result.error);
                send({
                  type: "progress",
                  step: 1,
                  stepLabel: "Transkripsi",
                  message: `Diarisasi gagal (${result.error.slice(0, 80)}…). Menggunakan Groq Whisper…`,
                });
              }
            } catch (e) {
              console.error("[diarize] Exception running diarize script:", e);
              await unlink(tmpPath).catch(() => {});
            }
          }
          if (!diarized) {
            send({
              type: "progress",
              step: 1,
              stepLabel: "Transkripsi",
              message: "Mempersiapkan transkripsi Groq Whisper…",
            });
            text = await transcribeWithGroq(buffer, apiKey, {
              language: "id",
              fileName,
              onChunkProgress: (current, total) => {
                send({
                  type: "progress",
                  step: 1,
                  stepLabel: "Transkripsi",
                  message:
                    total > 1
                      ? `Mentranskripsi bagian ${current} dari ${total}…`
                      : "Mentranskripsi dengan Groq Whisper…",
                });
              },
            });
            text = deduplicateParagraphs(text);
            if (!text.trim()) {
              send({ type: "error", message: "No speech could be transcribed from the audio. Try a different file." });
              controller.close();
              return;
            }
            text = `Speaker: ${text}`;
          }
        } else {
          diarized = undefined;
          const sendProgress = (msg: string) =>
            send({ type: "progress", step: 1, stepLabel: "Ekstraksi", message: msg });
          const ocrFallback =
            resolvedMime === "application/pdf"
              ? createOcrFallback(apiKey, sendProgress)
              : undefined;
          text = await extractText(buffer, resolvedMime, {
            ocrFallback,
            onProgress: sendProgress,
          });
        }

        if (!text.trim()) {
          send({
            type: "error",
            message: isAudio
              ? "No speech could be transcribed from the audio."
              : "No text could be extracted from the document.",
          });
          controller.close();
          return;
        }

        send({
          type: "progress",
          step: 2,
          stepLabel: "Cek format",
          message: "Memeriksa format label dan opini…",
        });

        const result = await checkFormatAndSummarize(text, apiKey, send);

        if ("error" in result) {
          send({ type: "error", message: result.error });
          controller.close();
          return;
        }

        send({
          type: "progress",
          step: 3,
          stepLabel: "Rangkuman",
          message: "Merangkum per segmen…",
        });

        send({ type: "summary", text: result.summary, diarized, device: diarizeDevice });

        if (leaderName) {
          const analysisResult = await runMeetingAnalysis(
            text,
            apiKey,
            leaderName,
            leaderPosition,
            send
          );
          if (!("error" in analysisResult)) {
            send({ type: "analysis", analysis: analysisResult.analysis });
          }
          // If analysis fails, summary is still available; we don't overwrite with error
        }
      } catch (err) {
        console.error("Segmented summarize error:", err);
        const message = err instanceof Error ? err.message : "Segmented summarization failed.";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("Segmented summarize route error:", err);
    const message = err instanceof Error ? err.message : "Segmented summarization failed.";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

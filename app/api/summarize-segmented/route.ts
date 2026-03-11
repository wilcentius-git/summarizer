import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync } from "fs";
import { writeFile, unlink } from "fs/promises";
import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import {
  extractText,
  isSupportedFileName,
  isSupportedMimeType,
  resolveMimeType,
} from "@/lib/extract-text";
import {
  createOcrFallback,
  deduplicateParagraphs,
  getGroqUserFriendlyError,
  GROQ_API_URL,
  GROQ_MODEL,
  MAX_FILE_SIZE_BYTES,
  MAX_TEXT_LENGTH,
  sleep,
  SUMMARIZE_CHUNK_DELAY_MS,
} from "@/lib/groq";
import { checkFormatAndSummarize } from "@/lib/segmented-summarize";
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

function toFileType(fileName: string, isAudio: boolean): "mp3" | "pdf" | "docx" {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf("."));
  if (isAudio || [".mp3", ".wav", ".m4a", ".webm", ".flac", ".ogg"].includes(ext)) return "mp3";
  if (ext === ".pdf") return "pdf";
  return "docx";
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
    const friendly = getGroqUserFriendlyError(r.status);
    return { error: friendly ?? `Meeting analysis failed: ${r.status}. ${errBody}` };
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
    const cookieStore = await cookies();
    const token = cookieStore.get("auth-token")?.value;
    const payload = token ? await verifyToken(token) : null;
    if (!payload) {
      return NextResponse.json({ error: "Unauthorized. Please log in." }, { status: 401 });
    }

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

    const job = await prisma.summaryJob.create({
      data: {
        userId: payload.userId,
        filename: fileName,
        fileType: toFileType(fileName, isAudio),
        status: "pending",
        progressPercentage: 0,
        groqAttempts: 0,
      },
    });

    const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => {
        try {
          sendStreamLine(controller, obj);
        } catch {
          // Client may have disconnected
        }
      };

      const RETRY_AFTER_HOURS = 1;

      const updateJob = async (updates: {
        status?: string;
        progressPercentage?: number;
        summaryText?: string;
        errorMessage?: string;
        retryAfter?: Date;
        extractedTextForRetry?: string;
        jobRetryContext?: string;
        totalChunks?: number;
        processedChunks?: number;
        partialSummary?: string;
      }) => {
        try {
          await prisma.summaryJob.update({
            where: { id: job.id },
            data: updates,
          });
        } catch (e) {
          console.error("SummaryJob update failed:", e);
        }
      };

      try {
        await updateJob({ status: "processing", progressPercentage: 5 });
        send({
          type: "job",
          jobId: job.id,
        });
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
              await updateJob({ status: "failed", errorMessage: "No speech could be transcribed from the audio. Try a different file." });
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
          await updateJob({
            status: "failed",
            errorMessage: isAudio
              ? "No speech could be transcribed from the audio."
              : "No text could be extracted from the document.",
          });
          send({
            type: "error",
            message: isAudio
              ? "No speech could be transcribed from the audio."
              : "No text could be extracted from the document.",
          });
          controller.close();
          return;
        }

        await updateJob({
          progressPercentage: 40,
          extractedTextForRetry: text,
          jobRetryContext: JSON.stringify({
            flow: "segmented",
            leaderName,
            leaderPosition,
          }),
        });
        send({
          type: "progress",
          step: 2,
          stepLabel: "Cek format",
          message: "Memeriksa format label dan opini…",
        });

        const accumulatedSummaries: string[] = [];
        const result = await checkFormatAndSummarize(text, apiKey, send, {
          startFromChunk: 0,
          initialSummaries: [],
          onChunkComplete: async (chunkIndex, part, totalChunks) => {
            accumulatedSummaries.push(part);
            await updateJob({
              processedChunks: chunkIndex + 1,
              totalChunks,
              partialSummary: JSON.stringify(accumulatedSummaries),
            });
          },
        });

        if ("error" in result) {
          if (result.isRateLimit) {
            const retryAfter = new Date(Date.now() + RETRY_AFTER_HOURS * 60 * 60 * 1000);
            await updateJob({
              status: "waiting_rate_limit",
              retryAfter,
              extractedTextForRetry: text,
              jobRetryContext: JSON.stringify({
                flow: "segmented",
                leaderName,
                leaderPosition,
              }),
            });
            send({
              type: "waiting_rate_limit",
              message: "Groq rate limit reached. Job will retry automatically in about 1 hour.",
              retryAfter: retryAfter.toISOString(),
            });
            controller.close();
            return;
          }
          await updateJob({ status: "failed", errorMessage: result.error });
          send({ type: "error", message: result.error });
          controller.close();
          return;
        }

        await updateJob({ progressPercentage: 90, summaryText: result.summary });
        send({
          type: "progress",
          step: 3,
          stepLabel: "Rangkuman",
          message: "Merangkum per segmen…",
        });

        await updateJob({ status: "completed", progressPercentage: 100 });
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
        await updateJob({ status: "failed", errorMessage: message });
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

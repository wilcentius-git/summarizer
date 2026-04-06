import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import {
  extractText,
  isSupportedFileName,
  isSupportedMimeType,
  resolveMimeType,
} from "@/lib/extract-text";
import { isJobCancelled } from "@/lib/check-cancelled";
import {
  createOcrFallback,
  deduplicateParagraphs,
  deduplicateSummaryPoints,
  isGroqRateLimitError,
  MAX_FILE_SIZE_BYTES,
  mergeSummaries,
  sleep,
  SUMMARIZE_CHUNK_DELAY_MS,
  SUMMARIZE_CHUNK_SIZE,
  SUMMARIZE_MERGE_PRE_DELAY_MS,
  splitIntoChunks,
  summarizeWithGroq,
} from "@/lib/groq";
import { truncateSummarySections } from "@/lib/summary-format";
import {
  isAudioFileName,
  isAudioMimeType,
  MAX_AUDIO_SIZE_BYTES,
  resolveAudioMimeType,
  TranscribeCancelledError,
  transcribeWithGroq,
} from "@/lib/transcribe-audio";
import { deleteAudio, saveAudio } from "@/lib/audio-storage";

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

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth-token")?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload) {
    return NextResponse.json({ error: "Unauthorized. Please log in." }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }
  const apiKey = (formData.get("groqApiKey") as string)?.trim();
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
        groqAttempts?: number;
        retryAfter?: Date;
        extractedTextForRetry?: string;
        jobRetryContext?: string;
        totalChunks?: number;
        processedChunks?: number;
        partialSummary?: string;
        processedTranscribeChunks?: number;
        partialTranscript?: string;
        audioPath?: string;
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
          phase: "extracting",
          current: 0,
          total: 1,
          message: isAudio ? "Mempersiapkan audio…" : "Mengekstrak teks…",
          step: 1,
          stepLabel: isAudio ? "Persiapan" : "Ekstraksi",
        });

        const buffer = Buffer.from(await file.arrayBuffer());
        let text: string;

        let audioPathToCleanup: string | null = null;
        if (isAudio) {
          const savedPath = await saveAudio(job.id, fileName, buffer);
          audioPathToCleanup = savedPath;
          await updateJob({ progressPercentage: 15, audioPath: savedPath });
          send({
            type: "progress",
            phase: "transcribing",
            current: 0,
            total: 1,
            message: "Mengirim ke Groq Whisper untuk transkripsi…",
            step: 1,
            stepLabel: "Transkripsi",
          });
          try {
            text = await transcribeWithGroq(buffer, apiKey, {
              language: "id",
              fileName,
              isCancelled: () => isJobCancelled(job.id),
              onChunkProgress: (current, total) => {
                send({
                  type: "progress",
                  phase: "transcribing",
                  current,
                  total,
                  message:
                    total > 1
                    ? `Transkripsi bagian ${current} dari ${total}…`
                    : "Mengirim ke Groq Whisper untuk transkripsi…",
                  step: 1,
                  stepLabel: "Transkripsi",
                });
              },
              onChunkDone: async (chunkIndex, _transcript, transcriptsSoFar) => {
                await updateJob({
                  processedTranscribeChunks: chunkIndex,
                  partialTranscript: JSON.stringify(transcriptsSoFar),
                });
              },
            });
          } catch (transcribeErr) {
            if (transcribeErr instanceof TranscribeCancelledError) {
              await updateJob({ status: "cancelled" });
              send({ type: "cancelled", message: "Dibatalkan." });
              controller.close();
              return;
            }
            throw transcribeErr;
          }
        } else {
          const ocrFallback =
            resolvedMime === "application/pdf" ? createOcrFallback(apiKey) : undefined;
          text = await extractText(buffer, resolvedMime, {
            ocrFallback,
          });
        }

        if (!text.trim()) {
          const msg = isAudio
            ? "No speech could be transcribed from the audio. Try a different file."
            : resolvedMime === "application/pdf"
              ? "No text could be extracted. The PDF may be scanned—OCR failed. Try a different file."
              : "No text could be extracted from the document.";
          await updateJob({ status: "failed", errorMessage: msg });
          send({ type: "error", message: msg });
          controller.close();
          return;
        }

        if (isAudio) {
          text = deduplicateParagraphs(text);
        }

        await updateJob({
          extractedTextForRetry: text,
          jobRetryContext: JSON.stringify({ flow: "summarize", isAudio }),
        });

        let summary: string;

        if (isAudio) {
          send({
            type: "progress",
            phase: "cooldown",
            current: 0,
            total: 1,
            message: "Transkripsi selesai. Menunggu sebelum merangkum…",
            step: 2,
            stepLabel: "Menunggu",
          });
          await sleep(30_000);
        }

        try {
          if (text.length <= SUMMARIZE_CHUNK_SIZE) {
            await updateJob({ progressPercentage: 60 });
            send({
              type: "progress",
              phase: "summarizing",
              current: 1,
              total: 1,
              message: isAudio ? "Transkrip selesai. Merangkum…" : "Merangkum dokumen…",
              step: isAudio ? 2 : 1,
              stepLabel: "Rangkuman",
            });
            summary = await summarizeWithGroq(text, apiKey);
          } else {
            await updateJob({ progressPercentage: 60 });
            const chunks = splitIntoChunks(text, SUMMARIZE_CHUNK_SIZE);
            const total = chunks.length;
            await updateJob({ totalChunks: total });
            send({
              type: "progress",
              phase: "chunks",
              current: 0,
              total,
              message: `Merangkum bagian 1 dari ${total}…`,
              step: isAudio ? 2 : 1,
              stepLabel: "Rangkuman",
            });

            const chunkSummaries: string[] = [];
            for (let i = 0; i < chunks.length; i++) {
              if (await isJobCancelled(job.id)) {
                controller.close();
                return;
              }
              const part = await summarizeWithGroq(chunks[i], apiKey, {
                isChunk: true,
              });
              chunkSummaries.push(part);
              await updateJob({
                processedChunks: i + 1,
                partialSummary: JSON.stringify(chunkSummaries),
              });
              send({
                type: "progress",
                phase: "chunks",
                current: i + 1,
                total,
                message: `Bagian ${i + 1} dari ${total} selesai`,
                step: isAudio ? 2 : 1,
                stepLabel: "Rangkuman",
              });
              if (i < chunks.length - 1) {
                await sleep(SUMMARIZE_CHUNK_DELAY_MS);
              }
            }

            if (await isJobCancelled(job.id)) {
              controller.close();
              return;
            }
            send({
              type: "progress",
              phase: "merge",
              current: 0,
              total: 1,
              message: "Mempersiapkan penggabungan…",
              step: isAudio ? 2 : 1,
              stepLabel: "Gabung",
            });
            await sleep(SUMMARIZE_MERGE_PRE_DELAY_MS);
            summary = await mergeSummaries(chunkSummaries, apiKey, (cur, tot) => {
              send({
                type: "progress",
                phase: "merge",
                current: cur,
                total: tot,
                message: tot > 1 ? `Menggabungkan bagian ${cur} dari ${tot}…` : "Menggabungkan rangkuman…",
                step: isAudio ? 2 : 1,
                stepLabel: "Gabung",
              });
            });
          }

          if (!summary) summary = "Rangkuman tidak dapat dibuat.";
          summary = deduplicateSummaryPoints(summary);
          summary = truncateSummarySections(summary, 40);
          await updateJob({
            status: "completed",
            progressPercentage: 100,
            summaryText: summary,
          });
          if (audioPathToCleanup) deleteAudio(audioPathToCleanup);
          send({ type: "summary", text: summary });
        } catch (groqErr) {
          if (isGroqRateLimitError(groqErr)) {
            const retryAfter = new Date(Date.now() + RETRY_AFTER_HOURS * 60 * 60 * 1000);
            await updateJob({
              status: "waiting_rate_limit",
              retryAfter,
              extractedTextForRetry: text,
              jobRetryContext: JSON.stringify({ flow: "summarize", isAudio }),
            });
            if (audioPathToCleanup) deleteAudio(audioPathToCleanup);
            send({
              type: "waiting_rate_limit",
              message: "Groq rate limit reached. Job will retry automatically in about 1 hour.",
              retryAfter: retryAfter.toISOString(),
            });
            return;
          }
          throw groqErr;
        }
      } catch (err) {
        console.error("Summarize error:", err);
        const message =
          err instanceof Error ? err.message : "Summarization failed.";
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
}

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
  sleepChunkPacingFromGroqHeaders,
  splitIntoChunks,
  summarizeWithGroq,
  SUMMARIZE_PIPELINE_STANDARD,
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
import { resolveGroqApiKey } from "@/lib/resolve-groq-api-key";

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
  const apiKey = resolveGroqApiKey(formData.get("groqApiKey") as string | null | undefined);
  const glossary = ((formData.get("glossary") as string | null) ?? "").trim();
  const pipeline = SUMMARIZE_PIPELINE_STANDARD;
  const file = formData.get("file");

  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Groq API key is required. Set GROQ_API_KEY in .env.local on the server, or enter your key under kunci groq sendiri (opsional).",
      },
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
        error: `File exceeds ${maxSizeMB} MB${isAudio ? " (audio limit)" : ""}.`,
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
      const pipelineJobStart = Date.now();
      let transcribeStartMs: number | undefined;
      let transcribeEndMs: number | undefined;
      let summarizeStartMs: number | undefined;
      let summarizeEndMs: number | undefined;
      let mergeStartMs: number | undefined;
      let mergeEndMs: number | undefined;

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
        sourceText?: string | null;
        errorMessage?: string;
        groqAttempts?: number;
        retryAfter?: Date;
        extractedTextForRetry?: string | null;
        jobRetryContext?: string | null;
        totalChunks?: number;
        processedChunks?: number;
        partialSummary?: string | null;
        processedTranscribeChunks?: number;
        partialTranscript?: string | null;
        audioPath?: string;
        totalDurationMs?: number;
        transcribeDurationMs?: number;
        summarizeDurationMs?: number;
        mergeDurationMs?: number;
        completedAt?: Date;
      }) => {
        try {
          const result = await prisma.summaryJob.updateMany({
            where: { id: job.id },
            data: updates,
          });
          if (result.count === 0) {
            console.warn(
              "SummaryJob update skipped: no row for id (job may have been deleted).",
              job.id
            );
          }
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
            transcribeStartMs = Date.now();
            text = await transcribeWithGroq(buffer, apiKey, {
              fileName,
              prompt: [
                "Transkrip audio berikut. Jangan tambahkan teks yang tidak ada dalam audio. Jangan ulangi kata atau frasa. Jangan tambahkan 'Terima kasih' atau kalimat penutup yang tidak ada dalam audio.",
                glossary || "",
              ].filter(Boolean).join(" "),
              chunkDelayMs: pipeline.transcribeChunkDelayMs,
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
            transcribeEndMs = Date.now();
            console.log(
              `>>> [TIMING] Transcription done in ${transcribeEndMs - transcribeStartMs!}ms`
            );
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
          jobRetryContext: JSON.stringify({
            isAudio,
            summarizeChunkSize: pipeline.summarizeChunkSize,
          }),
        });
        send({ type: "sourceText", text });

        let summary: string;

        try {
          console.log(`>>> [SUMMARIZE] Starting. Text length: ${text.length} chars`);
          if (!isAudio && text.length <= pipeline.summarizeChunkSize) {
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
            summarizeStartMs = Date.now();
            summary = await summarizeWithGroq(text, apiKey, { glossary: glossary || undefined });
            summarizeEndMs = Date.now();
          } else {
            await updateJob({ progressPercentage: 60 });
            const chunks = splitIntoChunks(text, pipeline.summarizeChunkSize);
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
            const jobStart = Date.now();
            const delayMs = pipeline.summarizeChunkDelayMs;
            summarizeStartMs = Date.now();
            for (let i = 0; i < chunks.length; i++) {
              if (await isJobCancelled(job.id)) {
                controller.close();
                return;
              }
              const chunk = chunks[i];
              const chunkStart = Date.now();
              console.log(`[CHUNK ${i + 1}/${total}] Starting. Text length: ${chunk.length} chars`);

              const { content: part, headers: responseHeaders } = await summarizeWithGroq(
                chunk,
                apiKey,
                {
                  isChunk: true,
                  isAudio,
                  glossary: glossary || undefined,
                  returnHeaders: true,
                }
              );
              const result = part;
              console.log(
                `>>> [CHUNK ${i + 1}/${total}] Summary length: ${result.length} chars (~${Math.round(result.length / 4)} tokens)`
              );
              console.log(`[CHUNK ${i + 1}/${total}] Done in ${Date.now() - chunkStart}ms`);
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
                console.log(`[CHUNK ${i + 1}/${total}] Sleeping ${delayMs}ms`);
                await sleepChunkPacingFromGroqHeaders(responseHeaders, i, total);
                console.log(
                  `[CHUNK ${i + 1}/${total}] Sleep done. Total elapsed: ${Date.now() - jobStart}ms`
                );
              }
            }

            summarizeEndMs = Date.now();
            console.log(
              `>>> [TIMING] Summarization done in ${summarizeEndMs - summarizeStartMs!}ms`
            );

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
            console.log(
              `>>> [MERGE] Phase starting. Total chunks: ${chunkSummaries.length}`
            );
            mergeStartMs = Date.now();
            summary = await mergeSummaries(chunkSummaries, apiKey, {
              glossary: glossary || undefined,
              onProgress: (cur, tot) => {
                send({
                  type: "progress",
                  phase: "merge",
                  current: cur,
                  total: tot,
                  message:
                    tot > 1
                      ? `Menggabungkan bagian ${cur} dari ${tot}…`
                      : "Menggabungkan rangkuman…",
                  step: isAudio ? 2 : 1,
                  stepLabel: "Gabung",
                });
              },
              onBatchComplete: async (batchResults) => {
                await updateJob({
                  partialSummary: JSON.stringify({
                    type: "merge_checkpoint",
                    totalChunks: chunkSummaries.length,
                    batchResults,
                  }),
                });
                console.log(
                  `>>> [MERGE CHECKPOINT] Saved ${batchResults.length} batch results to DB`
                );
              },
            });
            mergeEndMs = Date.now();
            console.log(`>>> [TIMING] Merge done in ${mergeEndMs - mergeStartMs!}ms`);
          }

          if (!summary) summary = "Rangkuman tidak dapat dibuat.";
          summary = deduplicateSummaryPoints(summary);
          summary = truncateSummarySections(summary, 40);
          await updateJob({
            status: "completed",
            partialSummary: null, // clear merge checkpoint
            progressPercentage: 100,
            summaryText: summary,
            sourceText: text,
            extractedTextForRetry: null,
            jobRetryContext: null,
            partialTranscript: null,
            processedTranscribeChunks: 0,
            // Timing fields
            totalDurationMs: Date.now() - pipelineJobStart,
            transcribeDurationMs: transcribeEndMs && transcribeStartMs
              ? transcribeEndMs - transcribeStartMs
              : undefined,
            summarizeDurationMs: summarizeEndMs && summarizeStartMs
              ? summarizeEndMs - summarizeStartMs
              : undefined,
            mergeDurationMs: mergeEndMs && mergeStartMs
              ? mergeEndMs - mergeStartMs
              : undefined,
            completedAt: new Date(),
          });
          if (audioPathToCleanup) deleteAudio(audioPathToCleanup);
          send({ type: "summary", text: summary });
        } catch (groqErr) {
          console.log(`>>> [SUMMARIZE] Error:`, groqErr);
          if (isGroqRateLimitError(groqErr)) {
            const retryAfter = new Date(Date.now() + RETRY_AFTER_HOURS * 60 * 60 * 1000);
            await updateJob({
              status: "waiting_rate_limit",
              retryAfter,
              extractedTextForRetry: text,
              jobRetryContext: JSON.stringify({
                isAudio,
                summarizeChunkSize: pipeline.summarizeChunkSize,
              }),
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

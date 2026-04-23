import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import * as fs from "fs";
import { verifyToken } from "@/lib/auth";
import {
  deduplicateParagraphs,
  isGroqRateLimitError,
  mergeSummaries,
  sleepChunkPacingFromGroqHeaders,
  splitIntoChunks,
  summarizeWithGroq,
  SUMMARIZE_PIPELINE_STANDARD,
  type SummarizePipelineConfig,
} from "@/lib/groq";
import { isJobCancelled } from "@/lib/check-cancelled";
import {
  TranscribeCancelledError,
  transcribeWithGroq,
} from "@/lib/transcribe-audio";
import { audioExists, deleteAudio } from "@/lib/audio-storage";
import { truncateSummarySections } from "@/lib/summary-format";
import { resolveGroqApiKey } from "@/lib/resolve-groq-api-key";

/** Job with fields needed for resume (Prisma client may be out of sync with schema). */
type ResumableJob = {
  id: string;
  status: string;
  filename: string;
  fileType: string;
  summaryText?: string | null;
  extractedTextForRetry: string | null;
  jobRetryContext: string | null;
  partialSummary?: string | null;
  partialTranscript?: string | null;
  processedChunks?: number;
  processedTranscribeChunks?: number;
  audioPath?: string | null;
};

/** Allow long-running summarization. */
export const maxDuration = 7200;

function sendStreamLine(controller: ReadableStreamDefaultController<Uint8Array>, obj: object) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth-token")?.value;
    const payload = token ? await verifyToken(token) : null;
    if (!payload) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: jobId } = await params;

    const job = await prisma.summaryJob.findFirst({
      where: { id: jobId, userId: payload.userId },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const resumableJob = job as ResumableJob;

    if (resumableJob.status === "completed") {
      return NextResponse.json({ message: "Rangkuman selesai." }, { status: 200 });
    }

    if (resumableJob.summaryText?.trim()) {
      return NextResponse.json({ message: "Rangkuman selesai." }, { status: 200 });
    }

    if (resumableJob.status === "processing") {
      return NextResponse.json(
        {
          error:
            "Pekerjaan ini sedang diproses. Tunggu hingga selesai atau batalkan jika macet.",
        },
        { status: 409 }
      );
    }

    let text: string | null = resumableJob.extractedTextForRetry;
    const hasTranscriptionResume =
      resumableJob.audioPath && audioExists(resumableJob.audioPath);

    if (!text?.trim() && !hasTranscriptionResume) {
      return NextResponse.json(
        { error: "Job cannot be resumed: no extracted text or audio saved." },
        { status: 400 }
      );
    }

    let context: { isAudio?: boolean } = {};
    try {
      if (resumableJob.jobRetryContext) {
        context = JSON.parse(resumableJob.jobRetryContext) as {
          isAudio?: boolean;
        };
      }
    } catch {
      return NextResponse.json({ error: "Invalid job retry context." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const apiKey = resolveGroqApiKey(body.groqApiKey as string | null | undefined);
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "Groq API key is required. Set GROQ_API_KEY in .env.local on the server, or send groqApiKey in the request (kunci groq sendiri opsional).",
        },
        { status: 400 }
      );
    }

    const resumableStatuses = [
      "pending",
      "failed",
      "waiting_rate_limit",
      "cancelled",
    ] as const;

    const claimResult = await prisma.summaryJob.updateMany({
      where: {
        id: jobId,
        userId: payload.userId,
        status: { in: [...resumableStatuses] },
      },
      data: { status: "processing" },
    });

    if (claimResult.count === 0) {
      const latest = await prisma.summaryJob.findFirst({
        where: { id: jobId, userId: payload.userId },
      });
      if (!latest) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }
      if (latest.status === "completed" || latest.summaryText?.trim()) {
        return NextResponse.json({ message: "Rangkuman selesai." }, { status: 200 });
      }
      if (latest.status === "processing") {
        return NextResponse.json(
          {
            error:
              "Pekerjaan ini sedang diproses. Tunggu hingga selesai atau batalkan jika macet.",
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Tidak dapat melanjutkan pekerjaan dalam status ini." },
        { status: 400 }
      );
    }

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

        const updateJob = async (
          updates: Prisma.SummaryJobUpdateInput & {
            processedChunks?: number;
            partialSummary?: string | null;
            processedTranscribeChunks?: number;
            partialTranscript?: string | null;
            audioPath?: string | null;
            totalDurationMs?: number;
            transcribeDurationMs?: number;
            summarizeDurationMs?: number;
            mergeDurationMs?: number;
            completedAt?: Date;
          }
        ) => {
          try {
            const result = await prisma.summaryJob.updateMany({
              where: { id: jobId },
              data: updates as Record<string, unknown>,
            });
            if (result.count === 0) {
              console.warn(
                "SummaryJob resume update skipped: no row for id (job may have been deleted).",
                jobId
              );
            }
          } catch (e) {
            console.error("SummaryJob resume update failed:", e);
          }
        };

        const pipeline: SummarizePipelineConfig = SUMMARIZE_PIPELINE_STANDARD;
        const isAudioJob = context.isAudio === true || resumableJob.fileType === "mp3";
        const glossary = String((body as { glossary?: string }).glossary ?? "").trim();

        try {
          // Status already set to processing by atomic claim before the stream starts.
          let completedTranscriptionThisRun = false;

          // Resume from transcription if we have audio but no extracted text yet
          if (!text?.trim() && hasTranscriptionResume && resumableJob.audioPath) {
            let initialTranscripts: string[] = [];
            try {
              if (resumableJob.partialTranscript) {
                initialTranscripts = JSON.parse(resumableJob.partialTranscript) as string[];
              }
            } catch {
              initialTranscripts = resumableJob.partialTranscript ? [resumableJob.partialTranscript] : [];
            }
            const startFromChunk = resumableJob.processedTranscribeChunks ?? 0;
            const buffer = fs.readFileSync(resumableJob.audioPath);

            send({
              type: "progress",
              phase: "transcribing",
              current: startFromChunk,
              total: 0,
              message: `Melanjutkan transkripsi dari bagian ${startFromChunk + 1}…`,
              step: 1,
              stepLabel: "Transkripsi",
            });

            try {
              transcribeStartMs = Date.now();
              text = await transcribeWithGroq(buffer, apiKey, {
                fileName: resumableJob.filename,
                prompt: [
                  "Transkrip audio berikut. Jangan tambahkan teks yang tidak ada dalam audio. Jangan ulangi kata atau frasa. Jangan tambahkan 'Terima kasih' atau kalimat penutup yang tidak ada dalam audio.",
                  glossary || "",
                ].filter(Boolean).join(" "),
                startFromChunk,
                initialTranscripts,
                chunkDelayMs: pipeline.transcribeChunkDelayMs,
                isCancelled: () => isJobCancelled(jobId),
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
                onChunkDone: async (chunkIndex, _t, transcriptsSoFar) => {
                  await updateJob({
                    processedTranscribeChunks: chunkIndex,
                    partialTranscript: JSON.stringify(transcriptsSoFar),
                  });
                },
              });
              transcribeEndMs = Date.now();
            } catch (transcribeErr) {
              if (transcribeErr instanceof TranscribeCancelledError) {
                controller.close();
                return;
              }
              throw transcribeErr;
            }

            if (!text?.trim()) {
              await updateJob({ status: "failed", errorMessage: "No speech could be transcribed." });
              send({ type: "error", message: "No speech could be transcribed from the audio." });
              controller.close();
              return;
            }
            text = deduplicateParagraphs(text);
            await updateJob({
              extractedTextForRetry: text,
              jobRetryContext: JSON.stringify({
                isAudio: true,
                summarizeChunkSize: pipeline.summarizeChunkSize,
              }),
            });
            completedTranscriptionThisRun = true;
          }

          const finalText = text!.trim();
          if (!finalText) {
            await updateJob({ status: "failed", errorMessage: "No text to summarize." });
            send({ type: "error", message: "No text to summarize." });
            controller.close();
            return;
          }

          send({ type: "sourceText", text: finalText });

          if (!isAudioJob && finalText.length <= pipeline.summarizeChunkSize) {
              send({
                type: "progress",
                phase: "summarizing",
                current: 1,
                total: 1,
                message: isAudioJob ? "Transkrip selesai. Merangkum…" : "Merangkum dokumen…",
                step: isAudioJob ? 2 : 1,
                stepLabel: "Rangkuman",
              });
              summarizeStartMs = Date.now();
              const summary = await summarizeWithGroq(finalText, apiKey);
              summarizeEndMs = Date.now();
              let finalSummary = deduplicateParagraphs(summary || "Rangkuman tidak dapat dibuat.");
              finalSummary = truncateSummarySections(finalSummary, 40);
              await updateJob({
                status: "completed",
                partialSummary: null, // clear merge checkpoint
                progressPercentage: 100,
                summaryText: finalSummary,
                sourceText: finalText,
                errorMessage: null,
                retryAfter: null,
                extractedTextForRetry: null,
                jobRetryContext: null,
                audioPath: null,
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
              if (resumableJob.audioPath) deleteAudio(resumableJob.audioPath);
              send({ type: "summary", text: finalSummary });
            } else {
              let initialSummaries: string[] = [];
              if (resumableJob.partialSummary) {
                try {
                  initialSummaries = JSON.parse(resumableJob.partialSummary) as string[];
                } catch {
                  initialSummaries = resumableJob.partialSummary ? [resumableJob.partialSummary] : [];
                }
              }
              const startFromChunk = resumableJob.processedChunks ?? 0;
              const chunks = splitIntoChunks(finalText, pipeline.summarizeChunkSize);
              const total = chunks.length;

              send({
                type: "progress",
                phase: "chunks",
                current: startFromChunk,
                total,
                message: `Melanjutkan dari bagian ${startFromChunk + 1}…`,
                step: isAudioJob ? 2 : 1,
                stepLabel: "Rangkuman",
              });

              const accumulatedSummaries = [...initialSummaries];
              summarizeStartMs = Date.now();
              for (let i = startFromChunk; i < chunks.length; i++) {
                if (await isJobCancelled(jobId)) {
                  controller.close();
                  return;
                }
                const chunk = chunks[i];

                const { content: part, headers: responseHeaders } = await summarizeWithGroq(
                  chunk,
                  apiKey,
                  {
                    isChunk: true,
                    isAudio: context.isAudio === true,
                    returnHeaders: true,
                  }
                );
                accumulatedSummaries.push(part);
                await updateJob({
                  processedChunks: i + 1,
                  partialSummary: JSON.stringify(accumulatedSummaries),
                });
                send({
                  type: "progress",
                  phase: "chunks",
                  current: i + 1,
                  total,
                  message: `Bagian ${i + 1} dari ${total} selesai`,
                  step: isAudioJob ? 2 : 1,
                  stepLabel: "Rangkuman",
                });
                if (i < chunks.length - 1) {
                  await sleepChunkPacingFromGroqHeaders(responseHeaders, i, total);
                }
              }

              summarizeEndMs = Date.now();

              if (await isJobCancelled(jobId)) {
                controller.close();
                return;
              }

              // Check if merge was interrupted mid-way
              let mergeStartSummaries = accumulatedSummaries; // default: all chunk summaries

              if (resumableJob.partialSummary) {
                try {
                  const parsed = JSON.parse(resumableJob.partialSummary) as {
                    type?: string;
                    totalChunks?: number;
                    batchResults?: string[];
                  };
                  if (
                    parsed?.type === "merge_checkpoint" &&
                    parsed?.totalChunks === accumulatedSummaries.length &&
                    Array.isArray(parsed?.batchResults) &&
                    parsed.batchResults.length > 0
                  ) {
                    // Merge was interrupted — resume from saved batch results
                    mergeStartSummaries = parsed.batchResults;
                  }
                } catch {
                  // Not a merge checkpoint — use full chunk summaries
                }
              }

              send({
                type: "progress",
                phase: "merge",
                current: 0,
                total: 1,
                message: "Mempersiapkan penggabungan…",
                step: isAudioJob ? 2 : 1,
                stepLabel: "Gabung",
              });
              mergeStartMs = Date.now();
              const summary = await mergeSummaries(mergeStartSummaries, apiKey, {
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
                    step: isAudioJob ? 2 : 1,
                    stepLabel: "Gabung",
                  });
                },
                onBatchComplete: async (batchResults) => {
                  await updateJob({
                    partialSummary: JSON.stringify({
                      type: "merge_checkpoint",
                      totalChunks: accumulatedSummaries.length,
                      batchResults,
                    }),
                  });
                },
              });
              mergeEndMs = Date.now();
              let finalSummary = deduplicateParagraphs(summary || "Rangkuman tidak dapat dibuat.");
              finalSummary = truncateSummarySections(finalSummary, 40);
              await updateJob({
                status: "completed",
                partialSummary: null, // clear merge checkpoint
                progressPercentage: 100,
                summaryText: finalSummary,
                sourceText: finalText,
                errorMessage: null,
                retryAfter: null,
                extractedTextForRetry: null,
                jobRetryContext: null,
                audioPath: null,
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
              if (resumableJob.audioPath) deleteAudio(resumableJob.audioPath);
              send({ type: "summary", text: finalSummary });
            }
        } catch (err) {
          console.error("Resume summarization error:", err);
          if (isGroqRateLimitError(err)) {
            const retryAfterMs = Math.max(err.retryAfterMs, 60 * 60 * 1000);
            const retryAfter = new Date(Date.now() + retryAfterMs);
            await updateJob({
              status: "waiting_rate_limit",
              retryAfter,
              errorMessage: null,
            });
            send({
              type: "waiting_rate_limit",
              message:
                "Groq rate limit reached. Job will retry automatically in about 1 hour.",
              retryAfter: retryAfter.toISOString(),
            });
            return;
          }
          const message = err instanceof Error ? err.message : "Resume failed.";
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
    console.error("Resume route error:", err);
    const message = err instanceof Error ? err.message : "Resume failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

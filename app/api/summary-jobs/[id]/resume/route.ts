import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Job with fields needed for resume (Prisma client may be out of sync with schema). */
type ResumableJob = {
  id: string;
  status: string;
  filename: string;
  extractedTextForRetry: string | null;
  jobRetryContext: string | null;
  partialSummary?: string | null;
  partialTranscript?: string | null;
  processedChunks?: number;
  processedTranscribeChunks?: number;
  audioPath?: string | null;
};
import * as fs from "fs";
import { verifyToken } from "@/lib/auth";
import {
  deduplicateSummaryPoints,
  isGroqRateLimitError,
  mergeSummaries,
  sleep,
  SUMMARIZE_CHUNK_DELAY_MS,
  SUMMARIZE_CHUNK_SIZE,
  SUMMARIZE_MERGE_PRE_DELAY_MS,
  splitIntoChunks,
  summarizeWithGroq,
} from "@/lib/groq";
import { isJobCancelled } from "@/lib/check-cancelled";
import {
  TranscribeCancelledError,
  transcribeWithGroq,
} from "@/lib/transcribe-audio";
import { audioExists, deleteAudio } from "@/lib/audio-storage";
import { deduplicateParagraphs } from "@/lib/groq";
import { truncateSummarySections } from "@/lib/summary-format";

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
      return NextResponse.json({ error: "Job already completed" }, { status: 400 });
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

    let context: { flow?: string; isAudio?: boolean } = {};
    try {
      if (resumableJob.jobRetryContext) {
        context = JSON.parse(resumableJob.jobRetryContext) as { flow?: string };
      }
    } catch {
      return NextResponse.json({ error: "Invalid job retry context." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const apiKey = (body.groqApiKey as string)?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: "Groq API key is required in request body." },
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

        const updateJob = async (
          updates: Prisma.SummaryJobUpdateInput & {
            processedChunks?: number;
            partialSummary?: string;
            processedTranscribeChunks?: number;
            partialTranscript?: string | null;
            audioPath?: string | null;
          }
        ) => {
          try {
            await prisma.summaryJob.update({
              where: { id: jobId },
              data: updates as Record<string, unknown>,
            });
          } catch (e) {
            console.error("SummaryJob resume update failed:", e);
          }
        };

        try {
          await updateJob({ status: "processing" });

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
            });

            try {
              text = await transcribeWithGroq(buffer, apiKey, {
                language: "id",
                fileName: resumableJob.filename,
                startFromChunk,
                initialTranscripts,
                isCancelled: () => isJobCancelled(jobId),
                onChunkProgress: (current, total) => {
                  send({
                    type: "progress",
                    phase: "transcribing",
                    current,
                    total,
                    message: `Transkripsi bagian ${current} dari ${total}…`,
                  });
                },
                onChunkDone: async (chunkIndex, _t, transcriptsSoFar) => {
                  await updateJob({
                    processedTranscribeChunks: chunkIndex,
                    partialTranscript: JSON.stringify(transcriptsSoFar),
                  });
                },
              });
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
              jobRetryContext: JSON.stringify({ flow: "summarize", isAudio: true }),
            });
          }

          const finalText = text!.trim();
          if (!finalText) {
            await updateJob({ status: "failed", errorMessage: "No text to summarize." });
            send({ type: "error", message: "No text to summarize." });
            controller.close();
            return;
          }

          // All jobs use summarize flow (chunk + merge). Segmented flow removed.
          if (finalText.length <= SUMMARIZE_CHUNK_SIZE) {
              send({ type: "progress", phase: "summarizing", message: "Merangkum…" });
              const summary = await summarizeWithGroq(finalText, apiKey);
              let finalSummary = deduplicateSummaryPoints(summary || "Rangkuman tidak dapat dibuat.");
              finalSummary = truncateSummarySections(finalSummary, 40);
              await updateJob({
                status: "completed",
                progressPercentage: 100,
                summaryText: finalSummary,
                errorMessage: null,
                retryAfter: null,
                extractedTextForRetry: null,
                jobRetryContext: null,
                audioPath: null,
                partialTranscript: null,
                processedTranscribeChunks: 0,
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
              const chunks = splitIntoChunks(finalText, SUMMARIZE_CHUNK_SIZE);
              const total = chunks.length;

              send({
                type: "progress",
                phase: "chunks",
                current: startFromChunk,
                total,
                message: `Melanjutkan dari bagian ${startFromChunk + 1}…`,
              });

              const accumulatedSummaries = [...initialSummaries];
              for (let i = startFromChunk; i < chunks.length; i++) {
                if (await isJobCancelled(jobId)) {
                  controller.close();
                  return;
                }
                const part = await summarizeWithGroq(chunks[i], apiKey, { isChunk: true });
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
                });
                if (i < chunks.length - 1) {
                  await sleep(SUMMARIZE_CHUNK_DELAY_MS);
                }
              }

              if (await isJobCancelled(jobId)) {
                controller.close();
                return;
              }
              send({ type: "progress", phase: "merge", message: "Menggabungkan rangkuman…" });
              await sleep(SUMMARIZE_MERGE_PRE_DELAY_MS);
              const summary = await mergeSummaries(
                accumulatedSummaries,
                apiKey,
                (cur, tot) => {
                  send({
                    type: "progress",
                    phase: "merge",
                    current: cur,
                    total: tot,
                    message:
                      tot > 1
                        ? `Menggabungkan bagian ${cur} dari ${tot}…`
                        : "Menggabungkan rangkuman…",
                  });
                }
              );
              let finalSummary = deduplicateSummaryPoints(summary || "Rangkuman tidak dapat dibuat.");
              finalSummary = truncateSummarySections(finalSummary, 40);
              await updateJob({
                status: "completed",
                progressPercentage: 100,
                summaryText: finalSummary,
                errorMessage: null,
                retryAfter: null,
                extractedTextForRetry: null,
                jobRetryContext: null,
                audioPath: null,
                partialTranscript: null,
                processedTranscribeChunks: 0,
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

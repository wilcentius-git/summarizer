import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Job with fields needed for resume (Prisma client may be out of sync with schema). */
type ResumableJob = {
  id: string;
  status: string;
  extractedTextForRetry: string | null;
  jobRetryContext: string | null;
  partialSummary?: string | null;
  processedChunks?: number;
};
import { verifyToken } from "@/lib/auth";
import {
  deduplicateSummaryPoints,
  mergeSummaries,
  sleep,
  SUMMARIZE_CHUNK_DELAY_MS,
  SUMMARIZE_CHUNK_SIZE,
  SUMMARIZE_MERGE_PRE_DELAY_MS,
  splitIntoChunks,
  summarizeWithGroq,
} from "@/lib/groq";
import { checkFormatAndSummarize } from "@/lib/segmented-summarize";

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

    const text = resumableJob.extractedTextForRetry;
    if (!text?.trim()) {
      return NextResponse.json(
        { error: "Job cannot be resumed: no extracted text saved." },
        { status: 400 }
      );
    }

    let context: { flow?: string } = {};
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
          }
        ) => {
          try {
            await prisma.summaryJob.update({
              where: { id: jobId },
              data: updates as Prisma.SummaryJobUpdateInput,
            });
          } catch (e) {
            console.error("SummaryJob resume update failed:", e);
          }
        };

        try {
          await updateJob({ status: "processing" });

          if (context.flow === "summarize") {
            if (text.length <= SUMMARIZE_CHUNK_SIZE) {
              send({ type: "progress", phase: "summarizing", message: "Merangkum…" });
              const summary = await summarizeWithGroq(text, apiKey);
              const finalSummary = deduplicateSummaryPoints(summary || "Rangkuman tidak dapat dibuat.");
              await updateJob({
                status: "completed",
                progressPercentage: 100,
                summaryText: finalSummary,
                errorMessage: { set: null },
                retryAfter: { set: null },
                extractedTextForRetry: { set: null },
                jobRetryContext: { set: null },
              });
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
              const chunks = splitIntoChunks(text, SUMMARIZE_CHUNK_SIZE);
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

              send({ type: "progress", phase: "merge", message: "Menggabungkan rangkuman…" });
              await sleep(SUMMARIZE_MERGE_PRE_DELAY_MS);
              const summary = await mergeSummaries(accumulatedSummaries, apiKey);
              const finalSummary = deduplicateSummaryPoints(summary || "Rangkuman tidak dapat dibuat.");
              await updateJob({
                status: "completed",
                progressPercentage: 100,
                summaryText: finalSummary,
                errorMessage: { set: null },
                retryAfter: { set: null },
                extractedTextForRetry: { set: null },
                jobRetryContext: { set: null },
              });
              send({ type: "summary", text: finalSummary });
            }
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

            send({
              type: "progress",
              step: 3,
              stepLabel: "Rangkuman",
              message: `Melanjutkan dari bagian ${startFromChunk + 1}…`,
            });

            const accumulatedSummaries = [...initialSummaries];
            const result = await checkFormatAndSummarize(text, apiKey, send, {
              startFromChunk,
              initialSummaries,
              onChunkComplete: async (chunkIndex, part, totalChunks) => {
                accumulatedSummaries.push(part);
                await updateJob({
                  processedChunks: chunkIndex + 1,
                  partialSummary: JSON.stringify(accumulatedSummaries),
                });
              },
            });

            if ("error" in result) {
              if (result.isRateLimit) {
                const retryAfter = new Date(Date.now() + 60 * 60 * 1000);
                await prisma.summaryJob.update({
                  where: { id: jobId },
                  data: { status: "waiting_rate_limit", retryAfter },
                });
                send({
                  type: "waiting_rate_limit",
                  message: "Groq rate limit reached. Job will retry automatically in about 1 hour.",
                  retryAfter: retryAfter.toISOString(),
                });
              } else {
                await updateJob({ status: "failed", errorMessage: result.error });
                send({ type: "error", message: result.error });
              }
              controller.close();
              return;
            }

            await updateJob({
              status: "completed",
              progressPercentage: 100,
              summaryText: result.summary,
              errorMessage: { set: null },
              retryAfter: { set: null },
              extractedTextForRetry: { set: null },
              jobRetryContext: { set: null },
            });
            send({ type: "summary", text: result.summary });
          }
        } catch (err) {
          console.error("Resume summarization error:", err);
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

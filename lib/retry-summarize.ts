/**
 * Retry logic for jobs that hit Groq rate limit (waiting_rate_limit).
 * Used by the rate-limit worker.
 */

import type { SummaryJob } from "@prisma/client";

import {
  deduplicateParagraphs,
  isGroqRateLimitError,
  mergeSummaries,
  sleep,
  sleepChunkPacingFromGroqHeaders,
  splitIntoChunks,
  summarizeWithGroq,
  SUMMARIZE_PIPELINE_STANDARD,
} from "@/lib/groq";
import { truncateSummarySections } from "@/lib/summary-format";

export async function processRateLimitedJob(
  job: SummaryJob,
  apiKey: string
): Promise<{ success: true; summary: string } | { success: false; error: string }> {
  const text = job.extractedTextForRetry;
  if (!text?.trim()) {
    return { success: false, error: "No extracted text for retry." };
  }

  let isAudio = false;
  try {
    if (job.jobRetryContext) {
      const ctx = JSON.parse(job.jobRetryContext) as { isAudio?: boolean };
      isAudio = ctx.isAudio === true;
    }
  } catch {
    // ignore invalid context
  }

  try {
    let summary: string;
    if (text.length <= SUMMARIZE_PIPELINE_STANDARD.summarizeChunkSize) {
      summary = await summarizeWithGroq(text, apiKey);
    } else {
      let initialSummaries: string[] = [];
      if (job.partialSummary) {
        try {
          initialSummaries = JSON.parse(job.partialSummary) as string[];
        } catch {
          initialSummaries = job.partialSummary ? [job.partialSummary] : [];
        }
      }
      const startFromChunk = job.processedChunks ?? 0;
      const chunks = splitIntoChunks(text, SUMMARIZE_PIPELINE_STANDARD.summarizeChunkSize);
      const chunkSummaries = [...initialSummaries];
      for (let i = startFromChunk; i < chunks.length; i++) {
        const { content: part, headers: responseHeaders } = await summarizeWithGroq(
          chunks[i],
          apiKey,
          {
            isChunk: true,
            isAudio,
            returnHeaders: true,
          }
        );
        chunkSummaries.push(part);
        await sleepChunkPacingFromGroqHeaders(responseHeaders, i, chunks.length);
      }
      await sleep(SUMMARIZE_PIPELINE_STANDARD.mergePreDelayMs);
      summary = await mergeSummaries(chunkSummaries, apiKey);
    }
    summary = deduplicateParagraphs(summary || "Rangkuman tidak dapat dibuat.");
    summary = truncateSummarySections(summary, 40);
    return { success: true, summary };
  } catch (err) {
    if (isGroqRateLimitError(err)) {
      return { success: false, error: "Rate limit hit again during retry." };
    }
    throw err;
  }
}

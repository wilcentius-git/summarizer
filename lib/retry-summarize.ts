/**
 * Retry logic for jobs that hit Groq rate limit (waiting_rate_limit).
 * Used by the rate-limit worker.
 */

import type { SummaryJob } from "@prisma/client";

import { prisma } from "@/lib/prisma";
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
import { checkFormatAndSummarize } from "@/lib/segmented-summarize";

type JobRetryContext = {
  flow: "summarize" | "segmented";
  isAudio?: boolean;
  leaderName?: string;
  leaderPosition?: string;
};

export async function processRateLimitedJob(
  job: SummaryJob,
  apiKey: string
): Promise<{ success: true; summary: string } | { success: false; error: string }> {
  const text = job.extractedTextForRetry;
  if (!text?.trim()) {
    return { success: false, error: "No extracted text for retry." };
  }

  let context: JobRetryContext = { flow: "summarize" };
  try {
    if (job.jobRetryContext) {
      context = JSON.parse(job.jobRetryContext) as JobRetryContext;
    }
  } catch {
    return { success: false, error: "Invalid job retry context." };
  }

  if (context.flow === "segmented") {
    let initialSummaries: string[] = [];
    if (job.partialSummary) {
      try {
        initialSummaries = JSON.parse(job.partialSummary) as string[];
      } catch {
        initialSummaries = job.partialSummary ? [job.partialSummary] : [];
      }
    }
    const startFromChunk = job.processedChunks ?? 0;
    const result = await checkFormatAndSummarize(text, apiKey, undefined, {
      startFromChunk,
      initialSummaries,
    });
    if ("error" in result) {
      if (result.isRateLimit) {
        return { success: false, error: "Rate limit hit again during retry." };
      }
      return { success: false, error: result.error };
    }
    return { success: true, summary: result.summary };
  }

  // flow === "summarize"
  try {
    let summary: string;
    if (text.length <= SUMMARIZE_CHUNK_SIZE) {
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
      const chunks = splitIntoChunks(text, SUMMARIZE_CHUNK_SIZE);
      const chunkSummaries = [...initialSummaries];
      for (let i = startFromChunk; i < chunks.length; i++) {
        const part = await summarizeWithGroq(chunks[i], apiKey, { isChunk: true });
        chunkSummaries.push(part);
        if (i < chunks.length - 1) {
          await sleep(SUMMARIZE_CHUNK_DELAY_MS);
        }
      }
      await sleep(SUMMARIZE_MERGE_PRE_DELAY_MS);
      summary = await mergeSummaries(chunkSummaries, apiKey);
    }
    summary = deduplicateSummaryPoints(summary || "Rangkuman tidak dapat dibuat.");
    return { success: true, summary };
  } catch (err) {
    if (isGroqRateLimitError(err)) {
      return { success: false, error: "Rate limit hit again during retry." };
    }
    throw err;
  }
}

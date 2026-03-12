/**
 * Retry logic for jobs that hit Groq rate limit (waiting_rate_limit).
 * Used by the rate-limit worker.
 */

import type { SummaryJob } from "@prisma/client";

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
import { truncateSummarySections } from "@/lib/summary-format";

export async function processRateLimitedJob(
  job: SummaryJob,
  apiKey: string
): Promise<{ success: true; summary: string } | { success: false; error: string }> {
  const text = job.extractedTextForRetry;
  if (!text?.trim()) {
    return { success: false, error: "No extracted text for retry." };
  }

  // All jobs use summarize flow (chunk + merge). Segmented flow removed.
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
    summary = truncateSummarySections(summary, 40);
    return { success: true, summary };
  } catch (err) {
    if (isGroqRateLimitError(err)) {
      return { success: false, error: "Rate limit hit again during retry." };
    }
    throw err;
  }
}

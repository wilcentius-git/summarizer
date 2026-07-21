/**
 * Retry logic for jobs that hit Groq rate limit (waiting_rate_limit).
 * Used by the rate-limit worker.
 */

import type { SummaryJob } from "@prisma/client";

import { isJobCancelled } from "@/lib/check-cancelled";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
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
import {
  loadAllGlossaryTerms,
  resolveGlossaryForContent,
  type GlossaryContext,
} from "@/lib/glossary";

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
    const allGlossaryTerms = await loadAllGlossaryTerms();
    const glossaryContext: GlossaryContext = { allTerms: allGlossaryTerms };

    let summary: string;
    if (!isAudio && text.length <= SUMMARIZE_PIPELINE_STANDARD.summarizeChunkSize) {
      await prisma.summaryJob.update({
        where: { id: job.id },
        data: { progressPercentage: 30 },
      });
      if (await isJobCancelled(job.id)) {
        return { success: false, error: "Job was cancelled." };
      }
      summary = await summarizeWithGroq(text, apiKey, {
        glossary: resolveGlossaryForContent(allGlossaryTerms, text),
      });
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
      await prisma.summaryJob.update({
        where: { id: job.id },
        data: {
          totalChunks: chunks.length,
          processedChunks: 0,
          progressPercentage: 30,
        },
      });
      logger.warn("[DB WRITE] Pre-loop update done for job", job.id);
      const chunkSummaries = [...initialSummaries];
      for (let i = startFromChunk; i < chunks.length; i++) {
        if (await isJobCancelled(job.id)) {
          return { success: false, error: "Job was cancelled." };
        }
        const { content: part, headers: responseHeaders } = await summarizeWithGroq(
          chunks[i],
          apiKey,
          {
            isChunk: true,
            isAudio,
            chunkIndex: i,
            chunkTotal: chunks.length,
            glossary: resolveGlossaryForContent(allGlossaryTerms, chunks[i]),
            returnHeaders: true,
          }
        );
        chunkSummaries.push(part);
        await prisma.summaryJob.update({
          where: { id: job.id },
          data: {
            processedChunks: i + 1,
            partialSummary: JSON.stringify(chunkSummaries),
            progressPercentage: Math.round(30 + ((i + 1) / chunks.length) * 50),
          },
        });
        await sleepChunkPacingFromGroqHeaders(responseHeaders, i, chunks.length);
      }
      await prisma.summaryJob.update({
        where: { id: job.id },
        data: { progressPercentage: 80 },
      });
      await sleep(SUMMARIZE_PIPELINE_STANDARD.mergePreDelayMs);
      if (await isJobCancelled(job.id)) {
        return { success: false, error: "Job was cancelled." };
      }
      summary = await mergeSummaries(chunkSummaries, apiKey, { glossaryContext });
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

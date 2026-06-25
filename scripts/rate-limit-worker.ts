#!/usr/bin/env npx tsx
/**
 * Background worker that retries jobs stuck in waiting_rate_limit.
 * Checks every 60 seconds for jobs where retry_after has passed.
 * Requires GROQ_API_KEY in env or per satuan kerja for API calls.
 *
 * Run: npm run worker
 * Or: npx tsx scripts/rate-limit-worker.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { prisma } from "../lib/prisma";
import { decryptApiKey } from "../lib/crypto";
import { processRateLimitedJob } from "../lib/retry-summarize";
import { processTranscriptionJob } from "../lib/transcribe-job";
import { resolveGroqApiKey } from "../lib/resolve-groq-api-key";
import { logger } from "../lib/logger";

const CHECK_INTERVAL_MS = 5 * 1000; // 5 seconds
const RETRY_AFTER_HOURS = 1;

async function resolveGroqApiKeyForJob(userId: string): Promise<string> {
  let satuanKerjaGroqKey: string | null = null;
  try {
    const entry = await prisma.whitelist.findUnique({
      where: { nip: userId },
      include: { satuanKerja: { select: { groqApiKey: true } } },
    });
    const encryptedKey = entry?.satuanKerja?.groqApiKey;
    if (encryptedKey) {
      satuanKerjaGroqKey = decryptApiKey(encryptedKey);
    }
  } catch {
    // fall through to env via resolveGroqApiKey
  }
  return resolveGroqApiKey(null, satuanKerjaGroqKey);
}

async function processQueuedTranscriptionJobs() {
  const jobs = await prisma.summaryJob.findMany({
    where: {
      status: "queued_transcription",
      audioPath: { not: null },
    },
    orderBy: { uploadTime: "asc" },
    take: 5,
  });

  for (const job of jobs) {
    try {
      const apiKey = await resolveGroqApiKeyForJob(job.userId);
      if (!apiKey) {
        logger.warn(
          `[worker] No Groq API key for job ${job.id} (user ${job.userId}). Skipping.`
        );
        continue;
      }

      await prisma.summaryJob.update({
        where: { id: job.id },
        data: { status: "processing" },
      });

      const result = await processTranscriptionJob(job, apiKey);

      if (result.success) {
        await prisma.summaryJob.update({
          where: { id: job.id },
          data: {
            status: "completed",
            progressPercentage: 100,
            summaryText: result.summary,
            sourceText: result.transcript,
            errorMessage: null,
            retryAfter: null,
            extractedTextForRetry: null,
            jobRetryContext: null,
          },
        });
        logger.log(`[worker] Job ${job.id} (${job.filename}) completed.`);
      } else if (result.rateLimited) {
        const retryAfter = new Date(Date.now() + RETRY_AFTER_HOURS * 60 * 60 * 1000);
        const saved = await prisma.summaryJob.findUnique({
          where: { id: job.id },
          select: { extractedTextForRetry: true, status: true },
        });
        await prisma.summaryJob.update({
          where: { id: job.id },
          data: {
            status: "waiting_rate_limit",
            retryAfter,
            extractedTextForRetry: saved?.extractedTextForRetry ?? job.extractedTextForRetry,
          },
        });
        logger.log(
          `[worker] Job ${job.id} hit rate limit during summarization. Retry at ${retryAfter.toISOString()}.`
        );
      } else {
        const current = await prisma.summaryJob.findUnique({
          where: { id: job.id },
          select: { status: true },
        });
        if (current?.status === "cancelled") {
          logger.log(`[worker] Job ${job.id} was cancelled.`);
          continue;
        }
        await prisma.summaryJob.update({
          where: { id: job.id },
          data: {
            status: "failed",
            errorMessage: result.error,
          },
        });
        console.error(`[worker] Job ${job.id} failed: ${result.error}`);
      }
    } catch (err) {
      console.error(`[worker] Error processing transcription job ${job.id}:`, err);
      await prisma.summaryJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          errorMessage: err instanceof Error ? err.message : "Worker error",
        },
      });
    }
  }
}

async function processWaitingRateLimitJobs() {
  const now = new Date();
  const jobs = await prisma.summaryJob.findMany({
    where: {
      status: "waiting_rate_limit",
      retryAfter: { lte: now },
      extractedTextForRetry: { not: null },
    },
    orderBy: { retryAfter: "asc" },
    take: 5,
  });

  for (const job of jobs) {
        try {
          const apiKey = await resolveGroqApiKeyForJob(job.userId);
          if (!apiKey) {
            logger.warn(
              `[worker] No Groq API key for job ${job.id} (user ${job.userId}). Skipping.`
            );
            continue;
          }

          await prisma.summaryJob.update({
            where: { id: job.id },
            data: { status: "processing" },
          });

          const result = await processRateLimitedJob(job, apiKey);

          if (result.success) {
            await prisma.summaryJob.update({
              where: { id: job.id },
              data: {
                status: "completed",
                progressPercentage: 100,
                summaryText: result.summary,
                sourceText: job.extractedTextForRetry,
                errorMessage: null,
                retryAfter: null,
                extractedTextForRetry: null,
                jobRetryContext: null,
              },
            });
            logger.log(`[worker] Job ${job.id} (${job.filename}) completed.`);
          } else {
            if (result.error.includes("Rate limit")) {
              const retryAfter = new Date(Date.now() + RETRY_AFTER_HOURS * 60 * 60 * 1000);
              await prisma.summaryJob.update({
                where: { id: job.id },
                data: {
                  status: "waiting_rate_limit",
                  retryAfter,
                },
              });
              logger.log(`[worker] Job ${job.id} hit rate limit again. Retry at ${retryAfter.toISOString()}.`);
            } else {
              await prisma.summaryJob.update({
                where: { id: job.id },
                data: {
                  status: "failed",
                  errorMessage: result.error,
                  retryAfter: null,
                  extractedTextForRetry: null,
                  jobRetryContext: null,
                },
              });
              console.error(`[worker] Job ${job.id} failed: ${result.error}`);
            }
          }
        } catch (err) {
          console.error(`[worker] Error processing job ${job.id}:`, err);
          await prisma.summaryJob.update({
            where: { id: job.id },
            data: {
              status: "failed",
              errorMessage: err instanceof Error ? err.message : "Worker error",
            },
          });
        }
      }
}

async function runWorkerLoop() {
  while (true) {
    try {
      await processQueuedTranscriptionJobs();
      await processWaitingRateLimitJobs();
    } catch (err) {
      console.error("[worker] Loop error:", err);
    }

    await new Promise((r) => setTimeout(r, CHECK_INTERVAL_MS));
  }
}

runWorkerLoop().catch((err) => {
  console.error("[worker] Fatal:", err);
  process.exit(1);
});

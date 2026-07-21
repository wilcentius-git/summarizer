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

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { decryptApiKey } from "../lib/crypto";
import { deleteAudio } from "@/lib/audio-storage";
import { processRateLimitedJob } from "../lib/retry-summarize";
import { processTranscriptionJob } from "../lib/transcribe-job";
import { resolveGroqApiKey } from "../lib/resolve-groq-api-key";
import { logger } from "../lib/logger";

const CHECK_INTERVAL_MS = 5 * 1000; // 5 seconds
const RETRY_AFTER_HOURS = 1;
const API_JOB_RETENTION_MS = 6 * 60 * 60 * 1000;
const API_JOB_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function isPrismaRecordNotFound(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025"
  );
}

async function resolveGroqApiKeyForJob(
  userId: string,
  personalGroqApiKey?: string | null
): Promise<string> {
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
  let personalKey: string | null = null;
  if (personalGroqApiKey) {
    try {
      personalKey = decryptApiKey(personalGroqApiKey);
    } catch {
      // fall through to satuan kerja / env if decryption fails
    }
  }
  return resolveGroqApiKey(personalKey, satuanKerjaGroqKey);
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
      const apiKey = await resolveGroqApiKeyForJob(job.userId, job.personalGroqApiKey);
      if (!apiKey) {
        logger.warn(
          `[worker] No Groq API key for job ${job.id} (user ${job.userId}). Skipping.`
        );
        continue;
      }

      const claimResult = await prisma.summaryJob.updateMany({
        where: { id: job.id, status: { not: "cancelled" } },
        data: { status: "processing" },
      });
      if (claimResult.count === 0) {
        logger.log(`[worker] Job ${job.id} was cancelled before processing started, skipping.`);
        continue;
      }

      const result = await processTranscriptionJob(job, apiKey);

      if (result.success) {
        try {
          const stillActive = await prisma.summaryJob.findUnique({
            where: { id: job.id },
            select: { status: true },
          });
          if (stillActive?.status === "cancelled") {
            logger.log(`[worker] Job ${job.id} was cancelled during processing, not marking completed.`);
            continue;
          }
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
              audioPath: null,
              personalGroqApiKey: null,
            },
          });
          if (job.audioPath) {
            deleteAudio(job.audioPath);
          }
          logger.log(`[worker] Job ${job.id} (${job.filename}) completed.`);
        } catch (guardErr) {
          if (isPrismaRecordNotFound(guardErr)) {
            logger.log(`[worker] Job ${job.id} no longer exists (deleted), skipping.`);
            continue;
          }
          throw guardErr;
        }
      } else if (result.rateLimited) {
        try {
          const retryAfter = new Date(Date.now() + RETRY_AFTER_HOURS * 60 * 60 * 1000);
          const saved = await prisma.summaryJob.findUnique({
            where: { id: job.id },
            select: { extractedTextForRetry: true, status: true },
          });
          if (saved?.status === "cancelled") {
            logger.log(`[worker] Job ${job.id} was cancelled, skipping status update.`);
            continue;
          }
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
        } catch (guardErr) {
          if (isPrismaRecordNotFound(guardErr)) {
            logger.log(`[worker] Job ${job.id} no longer exists (deleted), skipping.`);
            continue;
          }
          throw guardErr;
        }
      } else {
        try {
          const stillActive = await prisma.summaryJob.findUnique({
            where: { id: job.id },
            select: { status: true },
          });
          if (stillActive?.status === "cancelled") {
            logger.log(`[worker] Job ${job.id} was cancelled, skipping status update.`);
            continue;
          }
          await prisma.summaryJob.update({
            where: { id: job.id },
            data: {
              status: "failed",
              errorMessage: result.error,
              personalGroqApiKey: null,
            },
          });
          console.error(`[worker] Job ${job.id} failed: ${result.error}`);
        } catch (guardErr) {
          if (isPrismaRecordNotFound(guardErr)) {
            logger.log(`[worker] Job ${job.id} no longer exists (deleted), skipping.`);
            continue;
          }
          throw guardErr;
        }
      }
    } catch (err) {
      console.error(`[worker] Error processing transcription job ${job.id}:`, err);
      try {
        const stillActive = await prisma.summaryJob.findUnique({
          where: { id: job.id },
          select: { status: true },
        });
        if (stillActive?.status === "cancelled") {
          logger.log(`[worker] Job ${job.id} was cancelled, skipping status update.`);
          continue;
        }
        await prisma.summaryJob.update({
          where: { id: job.id },
          data: {
            status: "failed",
            errorMessage: err instanceof Error ? err.message : "Worker error",
            personalGroqApiKey: null,
          },
        });
      } catch (guardErr) {
        if (isPrismaRecordNotFound(guardErr)) {
          logger.log(`[worker] Job ${job.id} no longer exists (deleted), skipping.`);
          continue;
        }
        throw guardErr;
      }
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
          const apiKey = await resolveGroqApiKeyForJob(job.userId, job.personalGroqApiKey);
          if (!apiKey) {
            logger.warn(
              `[worker] No Groq API key for job ${job.id} (user ${job.userId}). Skipping.`
            );
            continue;
          }

          const claimResult = await prisma.summaryJob.updateMany({
            where: { id: job.id, status: { not: "cancelled" } },
            data: { status: "processing" },
          });
          if (claimResult.count === 0) {
            logger.log(`[worker] Job ${job.id} was cancelled before processing started, skipping.`);
            continue;
          }

          const result = await processRateLimitedJob(job, apiKey);

          if (result.success) {
            try {
              const stillActive = await prisma.summaryJob.findUnique({
                where: { id: job.id },
                select: { status: true },
              });
              if (stillActive?.status === "cancelled") {
                logger.log(`[worker] Job ${job.id} was cancelled during processing, not marking completed.`);
                continue;
              }
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
                  audioPath: null,
                  personalGroqApiKey: null,
                },
              });
              if (job.audioPath) {
                deleteAudio(job.audioPath);
              }
              logger.log(`[worker] Job ${job.id} (${job.filename}) completed.`);
            } catch (guardErr) {
              if (isPrismaRecordNotFound(guardErr)) {
                logger.log(`[worker] Job ${job.id} no longer exists (deleted), skipping.`);
                continue;
              }
              throw guardErr;
            }
          } else {
            if (result.error.includes("Rate limit")) {
              try {
                const retryAfter = new Date(Date.now() + RETRY_AFTER_HOURS * 60 * 60 * 1000);
                const stillActive = await prisma.summaryJob.findUnique({
                  where: { id: job.id },
                  select: { status: true },
                });
                if (stillActive?.status === "cancelled") {
                  logger.log(`[worker] Job ${job.id} was cancelled, skipping status update.`);
                  continue;
                }
                await prisma.summaryJob.update({
                  where: { id: job.id },
                  data: {
                    status: "waiting_rate_limit",
                    retryAfter,
                  },
                });
                logger.log(`[worker] Job ${job.id} hit rate limit again. Retry at ${retryAfter.toISOString()}.`);
              } catch (guardErr) {
                if (isPrismaRecordNotFound(guardErr)) {
                  logger.log(`[worker] Job ${job.id} no longer exists (deleted), skipping.`);
                  continue;
                }
                throw guardErr;
              }
            } else {
              try {
                const stillActive = await prisma.summaryJob.findUnique({
                  where: { id: job.id },
                  select: { status: true },
                });
                if (stillActive?.status === "cancelled") {
                  logger.log(`[worker] Job ${job.id} was cancelled, skipping status update.`);
                  continue;
                }
                await prisma.summaryJob.update({
                  where: { id: job.id },
                  data: {
                    status: "failed",
                    errorMessage: result.error,
                    retryAfter: null,
                    extractedTextForRetry: null,
                    jobRetryContext: null,
                    personalGroqApiKey: null,
                  },
                });
                console.error(`[worker] Job ${job.id} failed: ${result.error}`);
              } catch (guardErr) {
                if (isPrismaRecordNotFound(guardErr)) {
                  logger.log(`[worker] Job ${job.id} no longer exists (deleted), skipping.`);
                  continue;
                }
                throw guardErr;
              }
            }
          }
        } catch (err) {
          console.error(`[worker] Error processing job ${job.id}:`, err);
          try {
            const stillActive = await prisma.summaryJob.findUnique({
              where: { id: job.id },
              select: { status: true },
            });
            if (stillActive?.status === "cancelled") {
              logger.log(`[worker] Job ${job.id} was cancelled, skipping status update.`);
              continue;
            }
            await prisma.summaryJob.update({
              where: { id: job.id },
              data: {
                status: "failed",
                errorMessage: err instanceof Error ? err.message : "Worker error",
                personalGroqApiKey: null,
              },
            });
          } catch (guardErr) {
            if (isPrismaRecordNotFound(guardErr)) {
              logger.log(`[worker] Job ${job.id} no longer exists (deleted), skipping.`);
              continue;
            }
            throw guardErr;
          }
        }
      }
}

async function cleanupOldApiJobs() {
  const cutoff = new Date(Date.now() - API_JOB_RETENTION_MS);
  const staleJobs = await prisma.summaryJob.findMany({
    where: {
      isApiJob: true,
      uploadTime: { lt: cutoff },
    },
    select: { id: true, audioPath: true },
  });

  if (staleJobs.length === 0) return;

  for (const job of staleJobs) {
    if (job.audioPath) {
      deleteAudio(job.audioPath);
    }
  }

  const result = await prisma.summaryJob.deleteMany({
    where: {
      isApiJob: true,
      uploadTime: { lt: cutoff },
    },
  });

  if (result.count > 0) {
    logger.log(`[worker] Cleaned up ${result.count} old API job(s).`);
  }
}

async function runWorkerLoop() {
  let lastApiJobCleanupAt = 0;

  while (true) {
    try {
      await processQueuedTranscriptionJobs();
      await processWaitingRateLimitJobs();

      const now = Date.now();
      if (now - lastApiJobCleanupAt >= API_JOB_CLEANUP_INTERVAL_MS) {
        lastApiJobCleanupAt = now;
        try {
          await cleanupOldApiJobs();
        } catch (err) {
          console.error("[worker] API job cleanup error:", err);
        }
      }
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

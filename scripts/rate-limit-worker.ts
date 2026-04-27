#!/usr/bin/env npx tsx
/**
 * Background worker that retries jobs stuck in waiting_rate_limit.
 * Checks every 60 seconds for jobs where retry_after has passed.
 * Requires GROQ_API_KEY in env for API calls.
 *
 * Run: npm run worker
 * Or: npx tsx scripts/rate-limit-worker.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { prisma } from "../lib/prisma";
import { processRateLimitedJob } from "../lib/retry-summarize";

const CHECK_INTERVAL_MS = 60 * 1000; // 60 seconds
const RETRY_AFTER_HOURS = 1;

async function runWorkerLoop() {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[worker] GROQ_API_KEY not set. Worker will not retry jobs. Set it in .env.local to enable.");
  }

  while (true) {
    try {
      if (apiKey) {
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
              console.log(`[worker] Job ${job.id} (${job.filename}) completed.`);
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
                console.log(`[worker] Job ${job.id} hit rate limit again. Retry at ${retryAfter.toISOString()}.`);
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

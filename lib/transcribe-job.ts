/**
 * Full transcription → summarization pipeline for background worker jobs.
 */

import * as fs from "fs";

import type { SummaryJob } from "@prisma/client";

import { isJobCancelled } from "@/lib/check-cancelled";
import {
  AUDIO_CHUNK_DURATION_SEC,
  AUDIO_CHUNK_OVERLAP_SEC,
  getAudioDurationSeconds,
} from "@/lib/audio-chunking";
import { deduplicateParagraphs } from "@/lib/groq";
import { prisma } from "@/lib/prisma";
import { processRateLimitedJob } from "@/lib/retry-summarize";
import { SUMMARIZE_PIPELINE_STANDARD } from "@/lib/summarize-pipeline";
import {
  logDeduplicatedTranscript,
  TranscribeCancelledError,
  transcribeWithGroq,
} from "@/lib/transcribe-audio";

const WHISPER_PROMPT =
  "Transkrip audio berikut. Jangan tambahkan teks yang tidak ada dalam audio. Jangan ulangi kata atau frasa. Jangan tambahkan 'Terima kasih' atau kalimat penutup yang tidak ada dalam audio.";

export async function processTranscriptionJob(
  job: SummaryJob,
  apiKey: string
): Promise<
  | { success: true; summary: string; transcript: string }
  | { success: false; error: string; rateLimited?: boolean }
> {
  if (!job.audioPath || !fs.existsSync(job.audioPath)) {
    return { success: false, error: "Audio file not found" };
  }

  const buffer = fs.readFileSync(job.audioPath);
  const pipeline = SUMMARIZE_PIPELINE_STANDARD;

  let initialTranscripts: string[] = [];
  try {
    if (job.partialTranscript) {
      initialTranscripts = JSON.parse(job.partialTranscript) as string[];
    }
  } catch {
    initialTranscripts = job.partialTranscript ? [job.partialTranscript] : [];
  }
  const startFromChunk = job.processedTranscribeChunks ?? 0;

  const durationSec = await getAudioDurationSeconds(job.audioPath);
  const step = AUDIO_CHUNK_DURATION_SEC - AUDIO_CHUNK_OVERLAP_SEC;
  const totalChunks = Math.ceil(durationSec / step);
  await prisma.summaryJob.update({
    where: { id: job.id },
    data: { totalChunks },
  });

  let transcript: string;
  try {
    transcript = await transcribeWithGroq(buffer, apiKey, {
      fileName: job.filename,
      prompt: WHISPER_PROMPT,
      startFromChunk,
      initialTranscripts,
      chunkDelayMs: pipeline.transcribeChunkDelayMs,
      isCancelled: () => isJobCancelled(job.id),
      onChunkDone: async (chunkIndex, _transcript, transcriptsSoFar) => {
        await prisma.summaryJob.update({
          where: { id: job.id },
          data: {
            processedTranscribeChunks: chunkIndex,
            partialTranscript: JSON.stringify(transcriptsSoFar),
          },
        });
      },
    });
  } catch (err) {
    if (err instanceof TranscribeCancelledError) {
      return { success: false, error: "Transcription cancelled" };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Transcription failed",
    };
  }

  if (!transcript.trim()) {
    return { success: false, error: "No speech could be transcribed from the audio." };
  }

  transcript = deduplicateParagraphs(transcript);
  logDeduplicatedTranscript(transcript);

  await prisma.summaryJob.update({
    where: { id: job.id },
    data: {
      extractedTextForRetry: transcript,
      jobRetryContext: JSON.stringify({
        isAudio: true,
        summarizeChunkSize: pipeline.summarizeChunkSize,
      }),
    },
  });

  const jobForSummarize: SummaryJob = {
    ...job,
    extractedTextForRetry: transcript,
    jobRetryContext: JSON.stringify({
      isAudio: true,
      summarizeChunkSize: pipeline.summarizeChunkSize,
    }),
  };

  try {
    const summaryResult = await processRateLimitedJob(jobForSummarize, apiKey);
    if (summaryResult.success) {
      return { success: true, summary: summaryResult.summary, transcript };
    }
    if (summaryResult.error.includes("Rate limit")) {
      return { success: false, error: "Rate limit", rateLimited: true };
    }
    return { success: false, error: summaryResult.error };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Summarization failed",
    };
  }
}

/**
 * Summarize / merge / transcribe pacing and chunk sizes.
 * Separate from groq.ts so client hooks can import without pulling API helpers.
 */

export type SummarizePipelineConfig = {
  summarizeChunkSize: number;
  summarizeChunkDelayMs: number;
  mergeChunkSize: number;
  mergeChunkDelayMs: number;
  mergeThreshold: number;
  mergePreDelayMs: number;
  mergeRateLimitBackoffMs: number;
  mergeRateLimitMaxAttempts: number;
  transcribeChunkDelayMs: number;
  /** Pause after audio transcription before chat summarization (rate-limit spacing). */
  postTranscribeCooldownMs: number;
};

/** Default pacing (safer for Groq free tier: fewer 429/413 failures). */
export const SUMMARIZE_PIPELINE_STANDARD: SummarizePipelineConfig = {
  summarizeChunkSize: 4500,
  summarizeChunkDelayMs: 6000,
  mergeChunkSize: 2000,
  mergeChunkDelayMs: 10_000,
  mergeThreshold: 7000,
  mergePreDelayMs: 8000,
  mergeRateLimitBackoffMs: 72_000,
  mergeRateLimitMaxAttempts: 5,
  transcribeChunkDelayMs: 3000,
  postTranscribeCooldownMs: 30_000,
};

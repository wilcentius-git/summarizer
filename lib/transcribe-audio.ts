/**
 * Groq Whisper speech-to-text transcription.
 * Supports MP3, WAV, M4A, WebM, FLAC, OGG, MP4, MPEG, MPGA.
 * Long audio is chunked to avoid 524 timeout; retries on 524 and 429 (rate limit).
 */

import { chunkAudioBuffer } from "@/lib/audio-chunking";
import { sleep } from "@/lib/groq";

export const GROQ_TRANSCRIPTION_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";
export const GROQ_WHISPER_MODEL = "whisper-large-v3-turbo";
/** Max uploaded audio file size. Long files are chunked before each Groq transcription request. */
export const MAX_AUDIO_SIZE_BYTES = 200 * 1024 * 1024;

export const AUDIO_MIME_TYPES = [
  "audio/mpeg", // mp3
  "audio/mp3",
  "audio/mp4",
  "audio/mpga",
  "audio/wav",
  "audio/webm",
  "audio/flac",
  "audio/ogg",
  "audio/x-m4a",
  "audio/m4a",
] as const;

export const AUDIO_EXTENSIONS = [
  ".mp3",
  ".mp4",
  ".mpeg",
  ".mpga",
  ".m4a",
  ".wav",
  ".webm",
  ".flac",
  ".ogg",
] as const;

const EXT_TO_MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".mp4": "audio/mp4",
  ".mpeg": "audio/mpeg",
  ".mpga": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
};

export function isAudioMimeType(mime: string): boolean {
  return AUDIO_MIME_TYPES.includes(mime as (typeof AUDIO_MIME_TYPES)[number]);
}

export function isAudioFileName(name: string): boolean {
  const ext = name.toLowerCase().slice(name.lastIndexOf("."));
  return AUDIO_EXTENSIONS.includes(ext as (typeof AUDIO_EXTENSIONS)[number]);
}

export function resolveAudioMimeType(mimeType: string, fileName?: string): string {
  if (isAudioMimeType(mimeType)) return mimeType;
  if (fileName) {
    const ext = fileName.toLowerCase().slice(fileName.lastIndexOf("."));
    const inferred = EXT_TO_MIME[ext];
    if (inferred) return inferred;
  }
  return mimeType;
}

const WHISPER_RETRY_ATTEMPTS = 3;
const WHISPER_RETRY_DELAY_MS = 5000;
/** Extra retries for 429 rate limit (API suggests wait time). */
const WHISPER_RATE_LIMIT_RETRY_ATTEMPTS = 5;
/** Default delay between transcription chunks (overridable via {@link TranscribeOptions.chunkDelayMs}). */
export const TRANSCRIBE_CHUNK_DELAY_MS = 3000;

/** Parse "Please try again in 58.5s" from Groq error body. Returns ms or null. */
function parseRetryAfterMs(errBody: string, res?: Response): number | null {
  const header = res?.headers?.get?.("Retry-After");
  if (header) {
    const sec = parseInt(header, 10);
    if (!isNaN(sec)) return sec * 1000;
  }
  const match = errBody.match(/try again in (\d+(?:\.\d+)?)\s*s/i);
  if (match) return Math.ceil(parseFloat(match[1]) * 1000);
  return null;
}

/**
 * Transcribe a single audio buffer using Groq Whisper API.
 * Retries on 524 (Cloudflare timeout) and 429 (rate limit), using API-suggested wait time for 429.
 */
async function transcribeSingleChunk(
  buffer: Buffer,
  apiKey: string,
  options: { language?: string; fileName: string; prompt?: string }
): Promise<string> {
  const fileName = options.fileName;
  const mime =
    fileName.endsWith(".wav") ? "audio/wav" :
    fileName.endsWith(".m4a") ? "audio/mp4" :
    fileName.endsWith(".flac") ? "audio/flac" :
    fileName.endsWith(".ogg") ? "audio/ogg" :
    fileName.endsWith(".webm") ? "audio/webm" :
    "audio/mpeg";

  const formData = new FormData();
  const blob = new Blob([new Uint8Array(buffer)], { type: mime });
  formData.append("file", blob, fileName);
  formData.append("model", GROQ_WHISPER_MODEL);
  formData.append("response_format", "text");
  if (options.language) {
    formData.append("language", options.language);
  }
  if (options.prompt) {
    formData.append("prompt", options.prompt);
  }

  let lastError: Error | null = null;
  const maxAttempts = Math.max(WHISPER_RETRY_ATTEMPTS, WHISPER_RATE_LIMIT_RETRY_ATTEMPTS);
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    try {
      const WHISPER_TIMEOUT_MS = 30_000;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, WHISPER_TIMEOUT_MS);

      let res: Response;
      try {
        res = await fetch(GROQ_TRANSCRIPTION_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: formData,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        if (
          fetchErr instanceof Error &&
          (fetchErr.name === "AbortError" ||
            fetchErr.message.includes("aborted"))
        ) {
          // Treat timeout as a retryable network error
          lastError = new Error(`Whisper chunk timed out after ${WHISPER_TIMEOUT_MS}ms`);
          if (attempt < maxAttempts) {
            console.log(
              `>>> [WHISPER] Timeout on attempt ${attempt + 1}. Retrying after ${WHISPER_RETRY_DELAY_MS}ms...`
            );
            await sleep(WHISPER_RETRY_DELAY_MS);
            continue;
          }
          throw lastError;
        }
        throw fetchErr;
      }

      if (res.ok) {
        return res.text();
      }

      const errBody = await res.text();
      lastError = new Error(`Groq Whisper error: ${res.status}. ${errBody}`);

      const maxRetries =
        res.status === 429 ? WHISPER_RATE_LIMIT_RETRY_ATTEMPTS : WHISPER_RETRY_ATTEMPTS;
      if ((res.status === 524 || res.status === 429) && attempt < maxRetries) {
        let delayMs = WHISPER_RETRY_DELAY_MS;
        if (res.status === 429) {
          const parsed = parseRetryAfterMs(errBody, res);
          if (parsed) delayMs = parsed;
        }
        await sleep(delayMs);
        continue;
      }
      throw lastError;
    } catch (err) {
      const isRetryable =
        err instanceof TypeError ||
        (err instanceof Error &&
          (/fetch|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up/i.test(err.message) ||
            (err as Error & { cause?: Error }).cause?.message?.includes("ECONNRESET")));
      lastError = err instanceof Error ? err : new Error(String(err));
      if (isRetryable && attempt < maxAttempts) {
        await sleep(WHISPER_RETRY_DELAY_MS);
        continue;
      }
      throw lastError;
    }
  }
  throw lastError;
}

/** Thrown when transcription is stopped due to job cancellation. */
export class TranscribeCancelledError extends Error {
  constructor(public readonly partialTranscripts: string[]) {
    super("Transcription cancelled");
    this.name = "TranscribeCancelledError";
  }
}

export interface TranscribeOptions {
  language?: string;
  fileName?: string;
  /** Optional vocabulary/context hint passed to Whisper to improve technical term recognition. */
  prompt?: string;
  /** Called when chunk N of total is being transcribed (for progress UI). */
  onChunkProgress?: (current: number, total: number) => void;
  /** Called after each chunk is transcribed (for saving partial progress). */
  onChunkDone?: (chunkIndex: number, transcript: string, transcriptsSoFar: string[]) => void | Promise<void>;
  /** If true, stop and throw TranscribeCancelledError with partial transcripts. */
  isCancelled?: () => Promise<boolean>;
  /** Skip chunks before this index (for resume). */
  startFromChunk?: number;
  /** Pre-filled transcripts from previous run (for resume). */
  initialTranscripts?: string[];
  /** Pause between Whisper requests; lower = faster, higher TPM burst risk. */
  chunkDelayMs?: number;
}

/**
 * Transcribe audio buffer using Groq Whisper API.
 * Long audio (>5 min or >8 MB) is chunked to avoid 524 timeout.
 * @param buffer - Raw audio file buffer
 * @param apiKey - Groq API key
 * @param options - Optional language hint, filename, progress callback, cancellation check
 */
export async function transcribeWithGroq(
  buffer: Buffer,
  apiKey: string,
  options?: TranscribeOptions
): Promise<string> {
  const fileName = options?.fileName ?? "audio.mp3";
  const startFrom = options?.startFromChunk ?? 0;
  const initialTranscripts = options?.initialTranscripts ?? [];

  let chunks: { buffer: Buffer }[];
  let cleanup: () => void = () => {};

  try {
    const result = await chunkAudioBuffer(buffer, fileName);
    chunks = result.chunks;
    cleanup = result.cleanup;
  } catch (chunkErr) {
    console.warn("Audio chunking failed, sending whole file:", chunkErr);
    chunks = [{ buffer }];
  }

  const chunkDelayMs = options?.chunkDelayMs ?? TRANSCRIBE_CHUNK_DELAY_MS;

  try {
    const transcripts = [...initialTranscripts];
    const total = chunks.length;
    for (let i = startFrom; i < chunks.length; i++) {
      if (options?.isCancelled && (await options.isCancelled())) {
        throw new TranscribeCancelledError(transcripts);
      }
      const chunk = chunks[i];
      console.log(
        `>>> [WHISPER ${i + 1}/${total}] Starting. Chunk size: ${chunk.buffer.length} bytes`
      );
      const whisperStart = Date.now();
      options?.onChunkProgress?.(i + 1, total);
      const chunkFileName =
        chunks.length > 1 ? `chunk-${i + 1}.mp3` : fileName;
      const text = await transcribeSingleChunk(chunk.buffer, apiKey, {
        language: options?.language,
        fileName: chunkFileName,
        prompt: options?.prompt,
      });
      console.log(`>>> [WHISPER ${i + 1}/${total}] Done in ${Date.now() - whisperStart}ms`);
      console.log(`>>> [WHISPER ${i + 1}/${total}] Transcript length: ${text.length} chars`);
      if (text.trim()) {
        transcripts.push(text.trim());
      }
      await options?.onChunkDone?.(i + 1, text.trim(), [...transcripts]);
      if (i < chunks.length - 1) {
        console.log(`>>> [WHISPER ${i + 1}/${total}] Sleeping ${chunkDelayMs}ms`);
        await sleep(chunkDelayMs);
      }
    }
    return transcripts.join("\n\n");
  } finally {
    cleanup();
  }
}

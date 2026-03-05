/**
 * Groq Whisper speech-to-text transcription.
 * Supports MP3, WAV, M4A, WebM, FLAC, OGG, MP4, MPEG, MPGA.
 * Long audio is chunked to avoid 524 timeout; retries on 524 and 429 (rate limit).
 */

import { chunkAudioBuffer } from "@/lib/audio-chunking";

export const GROQ_TRANSCRIPTION_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";
export const GROQ_WHISPER_MODEL = "whisper-large-v3-turbo";
/** Groq free tier max audio file size (25 MB). */
export const MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024;

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
/** Delay between transcription chunks to avoid bursting rate limits. */
export const TRANSCRIBE_CHUNK_DELAY_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

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
  options: { language?: string; fileName: string }
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

  let lastError: Error | null = null;
  const maxAttempts = Math.max(WHISPER_RETRY_ATTEMPTS, WHISPER_RATE_LIMIT_RETRY_ATTEMPTS);
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(GROQ_TRANSCRIPTION_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });

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

export interface TranscribeOptions {
  language?: string;
  fileName?: string;
  /** Called when chunk N of total is being transcribed (for progress UI). */
  onChunkProgress?: (current: number, total: number) => void;
}

/**
 * Transcribe audio buffer using Groq Whisper API.
 * Long audio (>5 min or >8 MB) is chunked to avoid 524 timeout.
 * @param buffer - Raw audio file buffer
 * @param apiKey - Groq API key
 * @param options - Optional language hint, filename, and progress callback
 */
export async function transcribeWithGroq(
  buffer: Buffer,
  apiKey: string,
  options?: TranscribeOptions
): Promise<string> {
  const fileName = options?.fileName ?? "audio.mp3";

  let chunks: { buffer: Buffer }[];
  let cleanup: () => void = () => {};

  try {
    const result = await chunkAudioBuffer(buffer, fileName);
    chunks = result.chunks;
    cleanup = result.cleanup;
  } catch {
    // Fallback: ffmpeg unavailable or failed, send whole file
    chunks = [{ buffer }];
  }

  try {
    const transcripts: string[] = [];
    const total = chunks.length;
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) await sleep(TRANSCRIBE_CHUNK_DELAY_MS);
      options?.onChunkProgress?.(i + 1, total);
      const chunk = chunks[i];
      const chunkFileName =
        chunks.length > 1 ? `chunk-${i + 1}.mp3` : fileName;
      const text = await transcribeSingleChunk(chunk.buffer, apiKey, {
        language: options?.language,
        fileName: chunkFileName,
      });
      if (text.trim()) {
        transcripts.push(text.trim());
      }
    }
    return transcripts.join("\n\n");
  } finally {
    cleanup();
  }
}

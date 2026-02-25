/**
 * Groq Whisper speech-to-text transcription.
 * Supports MP3, WAV, M4A, WebM, FLAC, OGG, MP4, MPEG, MPGA.
 */

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

/**
 * Transcribe audio buffer using Groq Whisper API.
 * @param buffer - Raw audio file buffer
 * @param apiKey - Groq API key
 * @param options - Optional language hint (e.g. "id" for Indonesian) and filename for format detection
 */
export async function transcribeWithGroq(
  buffer: Buffer,
  apiKey: string,
  options?: { language?: string; fileName?: string }
): Promise<string> {
  const fileName = options?.fileName ?? "audio.mp3";
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
  if (options?.language) {
    formData.append("language", options.language);
  }

  const res = await fetch(GROQ_TRANSCRIPTION_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Groq Whisper error: ${res.status}. ${errBody}`);
  }

  return res.text();
}

/**
 * Splits long audio into smaller chunks to avoid Groq Whisper 524 timeout.
 * Uses ffmpeg to extract segments. Chunks are ~4 min with 2 sec overlap.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

const ffmpegPath = process.env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";
const ffprobePath = process.env.FFPROBE_PATH ?? (ffprobeInstaller as { path: string }).path;

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

/** Chunk duration in seconds (~4 min). Keeps each request under Cloudflare ~100s timeout. */
export const AUDIO_CHUNK_DURATION_SEC = 240;
/** Overlap in seconds to avoid cutting words at boundaries. */
export const AUDIO_CHUNK_OVERLAP_SEC = 2;
/** Chunk if duration exceeds this (seconds). */
export const AUDIO_CHUNK_THRESHOLD_SEC = 300; // 5 min
/** Chunk if file size exceeds this (bytes). ~8 MB. */
export const AUDIO_CHUNK_THRESHOLD_BYTES = 8 * 1024 * 1024;

export interface AudioChunk {
  buffer: Buffer;
  startSec: number;
  endSec: number;
}

/**
 * Get audio duration in seconds using ffprobe.
 */
export function getAudioDurationSeconds(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const dur = metadata.format.duration;
      resolve(typeof dur === "number" ? dur : parseFloat(String(dur)) || 0);
    });
  });
}

/**
 * Extract an audio segment to a buffer.
 */
function extractSegment(
  inputPath: string,
  startSec: number,
  durationSec: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = ffmpeg(inputPath)
      .setStartTime(startSec)
      .setDuration(durationSec)
      .format("mp3")
      .audioCodec("libmp3lame")
      .audioBitrate("64k")
      .audioChannels(1)
      .audioFrequency(16000)
      .on("error", reject)
      .pipe();

    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

/**
 * Split audio file into chunks. Returns array of { buffer, startSec, endSec }.
 * Uses temp file; caller should ensure inputPath exists.
 */
export async function splitAudioIntoChunks(
  inputPath: string,
  durationSec: number
): Promise<AudioChunk[]> {
  const step = AUDIO_CHUNK_DURATION_SEC - AUDIO_CHUNK_OVERLAP_SEC;
  const chunks: AudioChunk[] = [];
  let start = 0;

  while (start < durationSec) {
    const duration = Math.min(AUDIO_CHUNK_DURATION_SEC, durationSec - start);
    const end = start + duration;
    const buffer = await extractSegment(inputPath, start, duration);
    chunks.push({ buffer, startSec: start, endSec: end });
    start += step;
  }

  return chunks;
}

/**
 * Check if audio should be chunked (long duration or large file).
 */
export function shouldChunkAudio(
  durationSec: number,
  fileSizeBytes: number
): boolean {
  return (
    durationSec > AUDIO_CHUNK_THRESHOLD_SEC ||
    fileSizeBytes > AUDIO_CHUNK_THRESHOLD_BYTES
  );
}

/**
 * Chunk a buffer into smaller audio segments for transcription.
 * Writes buffer to temp file, splits, returns chunk buffers.
 * Caller is responsible for cleaning up (temp dir is auto-removed after use).
 */
export async function chunkAudioBuffer(
  buffer: Buffer,
  fileName: string
): Promise<{ chunks: AudioChunk[]; cleanup: () => void }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-chunk-"));
  const inputPath = path.join(tmpDir, path.basename(fileName) || "audio.mp3");

  const cleanup = () => {
    try {
      fs.unlinkSync(inputPath);
      fs.rmdirSync(tmpDir);
    } catch {
      /* ignore */
    }
  };

  try {
    fs.writeFileSync(inputPath, buffer);
    const durationSec = await getAudioDurationSeconds(inputPath);

    if (!shouldChunkAudio(durationSec, buffer.length)) {
      return {
        chunks: [{ buffer, startSec: 0, endSec: durationSec }],
        cleanup,
      };
    }

    const chunks = await splitAudioIntoChunks(inputPath, durationSec);
    return { chunks, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}

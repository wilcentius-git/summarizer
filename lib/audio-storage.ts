/**
 * Store and retrieve audio files for resume-from-transcription.
 * Files are stored under uploads/jobs/{jobId}/
 */

import * as fs from "fs";
import * as path from "path";

const UPLOADS_DIR = path.join(process.cwd(), "uploads", "jobs");

export function getAudioPath(jobId: string, fileName: string): string {
  const ext = path.extname(fileName) || ".mp3";
  const safeName = `audio${ext}`;
  return path.join(UPLOADS_DIR, jobId, safeName);
}

export async function saveAudio(jobId: string, fileName: string, buffer: Buffer): Promise<string> {
  const dir = path.join(UPLOADS_DIR, jobId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = getAudioPath(jobId, fileName);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

export function deleteAudio(audioPath: string | null): void {
  if (!audioPath) return;
  try {
    if (fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
      const dir = path.dirname(audioPath);
      if (fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
      }
    }
  } catch (cleanupErr) {
    console.error("Audio cleanup failed:", cleanupErr);
  }
}

export function audioExists(audioPath: string | null): boolean {
  return !!audioPath && fs.existsSync(audioPath);
}

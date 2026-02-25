import { NextRequest, NextResponse } from "next/server";

import {
  extractText,
  isSupportedFileName,
  isSupportedMimeType,
  resolveMimeType,
} from "@/lib/extract-text";
import {
  createOcrFallback,
  MAX_FILE_SIZE_BYTES,
  sleep,
  SUMMARIZE_CHUNK_DELAY_MS,
  SUMMARIZE_CHUNK_SIZE,
  splitIntoChunks,
  summarizeWithGroq,
} from "@/lib/groq";
import {
  isAudioFileName,
  isAudioMimeType,
  MAX_AUDIO_SIZE_BYTES,
  resolveAudioMimeType,
  transcribeWithGroq,
} from "@/lib/transcribe-audio";

async function mergeSummaries(
  summaries: string[],
  apiKey: string
): Promise<string> {
  const combined = summaries.join("\n\n");
  if (combined.length <= SUMMARIZE_CHUNK_SIZE) {
    return summarizeWithGroq(combined, apiKey, { isMerge: true });
  }
  const chunks = splitIntoChunks(combined, SUMMARIZE_CHUNK_SIZE);
  const merged: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    merged.push(await summarizeWithGroq(chunks[i], apiKey, { isMerge: true }));
    if (i < chunks.length - 1) {
      await sleep(SUMMARIZE_CHUNK_DELAY_MS);
    }
  }
  return mergeSummaries(merged, apiKey);
}

function sendStreamLine(controller: ReadableStreamDefaultController<Uint8Array>, obj: object) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const apiKey = (formData.get("groqApiKey") as string)?.trim();
  const file = formData.get("file");

  if (!apiKey) {
    return NextResponse.json(
      { error: "Groq API key is required. Get one at https://console.groq.com" },
      { status: 400 }
    );
  }

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json(
      { error: "No document file provided." },
      { status: 400 }
    );
  }

  const fileName = file instanceof File ? file.name : "file";
  const resolvedMime = resolveMimeType(file.type, fileName);
  const resolvedAudioMime = resolveAudioMimeType(file.type, fileName);
  const isAudio =
    isAudioMimeType(resolvedAudioMime) || isAudioFileName(fileName);
  const isDocument =
    isSupportedMimeType(resolvedMime) || isSupportedFileName(fileName);

  if (!isAudio && !isDocument) {
    return NextResponse.json(
      {
        error:
          "Unsupported file type. Supported: PDF, DOCX, DOC, TXT, RTF, ODT, SRT, MP3, WAV, M4A, WebM, FLAC, OGG.",
      },
      { status: 400 }
    );
  }

  const maxSize = isAudio ? MAX_AUDIO_SIZE_BYTES : MAX_FILE_SIZE_BYTES;
  const maxSizeMB = maxSize / (1024 * 1024);
  if (file.size > maxSize) {
    return NextResponse.json(
      {
        error: `File exceeds ${maxSizeMB} MB${isAudio ? " (audio limit for free tier)" : ""}.`,
      },
      { status: 400 }
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => {
        try {
          sendStreamLine(controller, obj);
        } catch {
          // Client may have disconnected
        }
      };

      try {
        send({
          type: "progress",
          phase: "extracting",
          current: 0,
          total: 1,
          message: isAudio ? "Mempersiapkan audio…" : "Mengekstrak teks…",
          step: 1,
          stepLabel: isAudio ? "Persiapan" : "Ekstraksi",
        });

        const buffer = Buffer.from(await file.arrayBuffer());
        let text: string;

        if (isAudio) {
          send({
            type: "progress",
            phase: "transcribing",
            current: 0,
            total: 1,
            message: "Mengirim ke Groq Whisper untuk transkripsi…",
            step: 1,
            stepLabel: "Transkripsi",
          });
          text = await transcribeWithGroq(buffer, apiKey, {
            language: "id",
            fileName,
          });
        } else {
          const ocrFallback =
            resolvedMime === "application/pdf" ? createOcrFallback(apiKey) : undefined;
          text = await extractText(buffer, resolvedMime, {
            ocrFallback,
          });
        }

        if (!text.trim()) {
          const msg = isAudio
            ? "No speech could be transcribed from the audio. Try a different file."
            : resolvedMime === "application/pdf"
              ? "No text could be extracted. The PDF may be scanned—OCR failed. Try a different file."
              : "No text could be extracted from the document.";
          send({ type: "error", message: msg });
          controller.close();
          return;
        }

        let summary: string;

        if (text.length <= SUMMARIZE_CHUNK_SIZE) {
          send({
            type: "progress",
            phase: "summarizing",
            current: 1,
            total: 1,
            message: isAudio ? "Transkrip selesai. Merangkum…" : "Merangkum dokumen…",
            step: isAudio ? 2 : 1,
            stepLabel: "Rangkuman",
          });
          summary = await summarizeWithGroq(text, apiKey);
        } else {
          const chunks = splitIntoChunks(text, SUMMARIZE_CHUNK_SIZE);
          const total = chunks.length;
          send({
            type: "progress",
            phase: "chunks",
            current: 0,
            total,
            message: `Merangkum bagian 1 dari ${total}…`,
            step: isAudio ? 2 : 1,
            stepLabel: "Rangkuman",
          });

          const chunkSummaries: string[] = [];
          for (let i = 0; i < chunks.length; i++) {
            const part = await summarizeWithGroq(chunks[i], apiKey, {
              isChunk: true,
            });
            chunkSummaries.push(`[Bagian ${i + 1}]\n${part}`);
            send({
              type: "progress",
              phase: "chunks",
              current: i + 1,
              total,
              message: `Bagian ${i + 1} dari ${total} selesai`,
              step: isAudio ? 2 : 1,
              stepLabel: "Rangkuman",
            });
            if (i < chunks.length - 1) {
              await sleep(SUMMARIZE_CHUNK_DELAY_MS);
            }
          }

          send({
            type: "progress",
            phase: "merge",
            current: 0,
            total: 1,
            message: "Menggabungkan rangkuman…",
            step: isAudio ? 2 : 1,
            stepLabel: "Gabung",
          });
          summary = await mergeSummaries(chunkSummaries, apiKey);
        }

        if (!summary) summary = "Rangkuman tidak dapat dibuat.";
        send({ type: "summary", text: summary });
      } catch (err) {
        console.error("Summarize error:", err);
        const message =
          err instanceof Error ? err.message : "Summarization failed.";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

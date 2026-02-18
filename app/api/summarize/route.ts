import { NextRequest, NextResponse } from "next/server";

import {
  extractText,
  isSupportedFileName,
  isSupportedMimeType,
  resolveMimeType,
} from "@/lib/extract-text";
import { pdfPagesToImages, type PdfPageImage } from "@/lib/pdf-to-images";

const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB
const MAX_TEXT_LENGTH = 30000; // truncate for context limit (multi-page OCR)
const MIN_TEXT_FOR_SKIP_OCR = 50; // if less, try OCR fallback
const GROQ_IMAGES_PER_REQUEST = 1; // 1 per request to avoid last-image bias, ensure all pages extracted

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.1-8b-instant";
const GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

async function callVisionApi(
  images: PdfPageImage[],
  prompt: string,
  apiKey: string
): Promise<string> {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [{ type: "text", text: prompt }];
  for (const img of images) {
    content.push({ type: "image_url", image_url: { url: img.base64 } });
  }

  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_VISION_MODEL,
      messages: [{ role: "user", content }],
      max_tokens: 8192,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Groq Vision error: ${res.status}. ${errBody}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

async function extractTextFromImages(
  images: PdfPageImage[],
  apiKey: string,
  totalPages: number
): Promise<string> {
  const pageLabel =
    images.length === 1
      ? ` Ini Halaman ${images[0].pageNum} dari ${totalPages}.`
      : "";
  const mainPrompt =
    `Ekstrak SEMUA teks dari gambar halaman PDF ini.${pageLabel}
WAJIB berikan output untuk halaman ini - jangan kembalikan kosong.
Prioritaskan konten utama (badan dokumen). Abaikan header/footer/kop surat yang berulang.
Jika ada bagan, diagram, tabel, atau flowchart: ekstrak semua teks dan label, jelaskan strukturnya.
Pertahankan urutan. Kembalikan sebagai teks biasa dalam Bahasa Indonesia.`;

  let extracted = await callVisionApi(images, mainPrompt, apiKey);

  // Retry with simpler prompt if model returned empty (common for complex layouts)
  if (!extracted.trim() && images.length === 1) {
    const fallbackPrompt = `Deskripsikan SEMUA yang terlihat di halaman PDF ini (Halaman ${images[0].pageNum} dari ${totalPages}). Sertakan teks, label, elemen bagan/diagram/tabel. Tulis dalam Bahasa Indonesia. WAJIB berikan deskripsi - jangan kosong.`;
    extracted = await callVisionApi(images, fallbackPrompt, apiKey);
  }

  return extracted;
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Groq API key is not configured. Set GROQ_API_KEY in .env.local." },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "No document file provided." },
        { status: 400 }
      );
    }

    const fileName = file instanceof File ? file.name : "file";
    const resolvedMime = resolveMimeType(file.type, fileName);
    if (!isSupportedMimeType(resolvedMime) && !isSupportedFileName(fileName)) {
      return NextResponse.json(
        {
          error:
            "Unsupported file type. Supported: PDF, DOCX, DOC, TXT, RTF, ODT.",
        },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File exceeds ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB.` },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const ocrFallback =
      resolvedMime === "application/pdf"
        ? async (images: PdfPageImage[]) => {
            const chunks: string[] = [];
            const totalPages = images.length;
            for (let i = 0; i < images.length; i += GROQ_IMAGES_PER_REQUEST) {
              const batch = images.slice(i, i + GROQ_IMAGES_PER_REQUEST);
              const extracted = await extractTextFromImages(batch, apiKey, totalPages);
              const pageNum = batch[0].pageNum;
              // Always include page marker so summarizer sees full document structure
              chunks.push(
                extracted.trim()
                  ? `[Halaman ${pageNum}]\n${extracted}`
                  : `[Halaman ${pageNum}]\n(Konten halaman ini tidak dapat diekstrak.)`
              );
            }
            return chunks.join("\n\n");
          }
        : undefined;

    let text = await extractText(buffer, resolvedMime, {
      ocrFallback,
    });

    if (!text.trim()) {
      return NextResponse.json(
        {
          error:
            resolvedMime === "application/pdf"
              ? "No text could be extracted. The PDF may be scanned—OCR failed. Try a different file."
              : "No text could be extracted from the document.",
        },
        { status: 400 }
      );
    }

    if (text.length > MAX_TEXT_LENGTH) {
      text = text.slice(0, MAX_TEXT_LENGTH) + "\n\n[Text truncated for length.]";
    }

    const prompt =
      `Anda adalah asisten yang merangkum dokumen. Aturan:
- Tulis rangkuman dalam Bahasa Indonesia.
- Istilah teknis (misalnya: API, PDF, database, framework, dll.) tetap gunakan istilah aslinya, jangan diterjemahkan.
- Awali rangkuman dengan kalimat deskripsi dokumen, contoh: "Dokumen ini berisi hal tentang [topik utama dokumen]."
- Setelah itu, lanjutkan dengan poin-poin penting secara ringkas.
- PENTING: Gunakan konten dari SEMUA halaman dokumen (Halaman 1 sampai terakhir). Jangan hanya merangkum halaman terakhir - sertakan poin penting dari halaman awal dan tengah.
- Jangan hanya menyatakan kesimpulan abstrak. Berikan contoh konkret dari dokumen yang mendukung kesimpulan itu.
- Jaga struktur dan poin kunci. Tanpa pembukaan lain, langsung rangkuman saja.

Dokumen:

` + text;

    const groqResponse = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1024,
        temperature: 0.3,
      }),
    });

    if (!groqResponse.ok) {
      const errBody = await groqResponse.text();
      console.error("Groq API error:", groqResponse.status, errBody);
      return NextResponse.json(
        { error: `Groq API error: ${groqResponse.status}. ${errBody}` },
        { status: 502 }
      );
    }

    const json = (await groqResponse.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    const summary = content ?? "Rangkuman tidak dapat dibuat.";

    return NextResponse.json({ summary });
  } catch (err) {
    console.error("Summarize error:", err);
    const message =
      err instanceof Error ? err.message : "Summarization failed.";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

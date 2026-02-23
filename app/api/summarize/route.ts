import { NextRequest, NextResponse } from "next/server";

import {
  extractText,
  isSupportedFileName,
  isSupportedMimeType,
  resolveMimeType,
} from "@/lib/extract-text";
import {
  createOcrFallback,
  GROQ_API_URL,
  GROQ_MODEL,
  MAX_FILE_SIZE_BYTES,
  MAX_TEXT_LENGTH,
} from "@/lib/groq";

export async function POST(request: NextRequest) {
  try {
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
      resolvedMime === "application/pdf" ? createOcrFallback(apiKey) : undefined;

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

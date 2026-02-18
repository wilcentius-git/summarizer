import { NextRequest, NextResponse } from "next/server";

import { pdfPagesToImages, type PdfPageImage } from "@/lib/pdf-to-images";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse");

const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB
const MAX_TEXT_LENGTH = 12000; // truncate for context limit
const MIN_TEXT_FOR_SKIP_OCR = 50; // if less, try OCR fallback
const GROQ_IMAGES_PER_REQUEST = 5; // Groq vision limit

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.1-8b-instant";
const GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

async function extractTextFromImages(
  images: PdfPageImage[],
  apiKey: string
): Promise<string> {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [
    {
      type: "text",
      text:
        "Extract all text from these PDF page images (OCR). Also describe any charts, diagrams, or figures. Preserve structure and order. Return as plain text.",
    },
  ];
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
      max_tokens: 4096,
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
        { error: "No PDF file provided." },
        { status: 400 }
      );
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "File must be a PDF." },
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
    const data = await pdfParse(buffer);
    let text: string = data?.text ?? "";

    // Fallback to OCR + vision when text extraction yields little (e.g. scanned PDFs)
    if (!text.trim() || text.length < MIN_TEXT_FOR_SKIP_OCR) {
      try {
        const images = await pdfPagesToImages(buffer, { maxPages: 20 });
        if (images.length > 0) {
          const chunks: string[] = [];
          for (let i = 0; i < images.length; i += GROQ_IMAGES_PER_REQUEST) {
            const batch = images.slice(i, i + GROQ_IMAGES_PER_REQUEST);
            const extracted = await extractTextFromImages(batch, apiKey);
            if (extracted) chunks.push(extracted);
          }
          text = chunks.join("\n\n");
        }
      } catch (ocrErr) {
        console.error("OCR fallback error:", ocrErr);
        if (!text.trim()) {
          return NextResponse.json(
            {
              error:
                "No text could be extracted. The PDF may be scanned—OCR failed. Try a different file.",
            },
            { status: 400 }
          );
        }
      }
    }

    if (!text.trim()) {
      return NextResponse.json(
        { error: "No text could be extracted from the PDF." },
        { status: 400 }
      );
    }

    if (text.length > MAX_TEXT_LENGTH) {
      text = text.slice(0, MAX_TEXT_LENGTH) + "\n\n[Text truncated for length.]";
    }

    const prompt =
      "Summarize the following document concisely. Preserve key points and structure. Respond with the summary only, no preamble.\n\n" +
      text;

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
    const summary = content ?? "No summary generated.";

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

import { describe, it, expect } from "vitest";
import {
  isSupportedMimeType,
  isSupportedFileName,
  resolveMimeType,
  extractText,
} from "@/lib/extract-text";

describe("isSupportedMimeType", () => {
  it("accepts PDF", () => {
    expect(isSupportedMimeType("application/pdf")).toBe(true);
  });

  it("accepts DOCX", () => {
    expect(isSupportedMimeType("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(true);
  });

  it("rejects unknown type", () => {
    expect(isSupportedMimeType("image/png")).toBe(false);
  });
});

describe("isSupportedFileName", () => {
  it("accepts .pdf", () => {
    expect(isSupportedFileName("file.pdf")).toBe(true);
  });

  it("accepts .docx", () => {
    expect(isSupportedFileName("doc.docx")).toBe(true);
  });

  it("rejects .jpg", () => {
    expect(isSupportedFileName("image.jpg")).toBe(false);
  });
});

describe("resolveMimeType", () => {
  it("returns known MIME type directly", () => {
    expect(resolveMimeType("application/pdf")).toBe("application/pdf");
  });

  it("infers MIME from filename when type is generic", () => {
    expect(resolveMimeType("application/octet-stream", "doc.pdf")).toBe("application/pdf");
  });

  it("returns original type when no match", () => {
    expect(resolveMimeType("application/octet-stream", "file.xyz")).toBe("application/octet-stream");
  });
});

describe("extractText", () => {
  it("extracts text from plain text buffer", async () => {
    const buffer = Buffer.from("Hello, world!");
    const result = await extractText(buffer, "text/plain");
    expect(result).toBe("Hello, world!");
  });

  it("extracts text from SRT buffer", async () => {
    const srt = `1\n00:00:01,000 --> 00:00:03,000\nHello there\n\n2\n00:00:04,000 --> 00:00:06,000\nGoodbye\n`;
    const buffer = Buffer.from(srt);
    const result = await extractText(buffer, "application/x-subrip");
    expect(result).toContain("Hello there");
    expect(result).toContain("Goodbye");
  });
});

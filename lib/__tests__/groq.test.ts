import { describe, it, expect } from "vitest";
import {
  splitIntoChunks,
  deduplicateParagraphs,
  deduplicateSummaryPoints,
  fixCommonTypos,
  parseRetryAfterMs,
  sleep,
} from "@/lib/groq";

describe("splitIntoChunks", () => {
  it("returns single chunk for short text", () => {
    const result = splitIntoChunks("Hello world", 100);
    expect(result).toEqual(["Hello world"]);
  });

  it("splits long text into multiple chunks", () => {
    const text = "A".repeat(100) + "\n\n" + "B".repeat(100);
    const chunks = splitIntoChunks(text, 120);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(120);
    }
  });

  it("splits at paragraph boundary when possible", () => {
    const text = "First paragraph.\n\nSecond paragraph.";
    const chunks = splitIntoChunks(text, 25);
    expect(chunks[0]).toBe("First paragraph.");
    expect(chunks[1]).toBe("Second paragraph.");
  });

  it("handles empty text", () => {
    const result = splitIntoChunks("", 100);
    expect(result).toEqual([""]);
  });
});

describe("deduplicateParagraphs", () => {
  it("removes duplicate paragraphs", () => {
    const text = "Hello world\n\nHello world\n\nNew paragraph";
    const result = deduplicateParagraphs(text);
    expect(result).toBe("Hello world\n\nNew paragraph");
  });

  it("keeps unique paragraphs", () => {
    const text = "First\n\nSecond\n\nThird";
    expect(deduplicateParagraphs(text)).toBe(text);
  });
});

describe("deduplicateSummaryPoints", () => {
  it("removes duplicate summary points", () => {
    const text = "Point one\n\nPoint one\n\nPoint two";
    const result = deduplicateSummaryPoints(text);
    expect(result).toBe("Point one\n\nPoint two");
  });

  it("returns empty for empty input", () => {
    expect(deduplicateSummaryPoints("  ")).toBe("  ");
  });
});

describe("fixCommonTypos", () => {
  it("fixes menafigasi to menavigasi", () => {
    expect(fixCommonTypos("menafigasi halaman")).toBe("menavigasi halaman");
  });

  it("handles case-insensitive match", () => {
    expect(fixCommonTypos("Menafigasi")).toBe("menavigasi");
  });

  it("returns empty for empty input", () => {
    expect(fixCommonTypos("")).toBe("");
  });
});

describe("parseRetryAfterMs", () => {
  it("parses milliseconds format", () => {
    const result = parseRetryAfterMs("try again in 500ms", 60000);
    expect(result).toBe(1000);
  });

  it("parses seconds format", () => {
    const result = parseRetryAfterMs("try again in 2.5s", 60000);
    expect(result).toBeGreaterThanOrEqual(3500);
  });

  it("returns default when no match", () => {
    const result = parseRetryAfterMs("some error", 60000);
    expect(result).toBe(60000);
  });
});

describe("sleep", () => {
  it("resolves after delay", async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});

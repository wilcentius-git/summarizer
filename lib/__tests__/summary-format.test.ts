import { describe, it, expect } from "vitest";
import { ensureBlankLineAfterSections, truncateSummarySections } from "@/lib/summary-format";

describe("ensureBlankLineAfterSections", () => {
  it("adds blank line after Ringkasan Eksekutif header", () => {
    const input = "**Ringkasan Eksekutif**:\nContent here";
    const result = ensureBlankLineAfterSections(input);
    expect(result).toContain("**Ringkasan Eksekutif**:\n\n");
  });

  it("does not add extra blank lines if already present", () => {
    const input = "**Ringkasan Eksekutif**:\n\nContent here";
    const result = ensureBlankLineAfterSections(input);
    expect(result).not.toContain("\n\n\n");
  });

  it("returns empty for falsy input", () => {
    expect(ensureBlankLineAfterSections("")).toBe("");
  });
});

describe("truncateSummarySections", () => {
  it("returns unchanged text without expected markers", () => {
    const input = "Some regular text";
    expect(truncateSummarySections(input)).toBe(input);
  });

  it("truncates Insight tambahan when present", () => {
    const longInsight = Array(60).fill("kata").join(" ");
    const input = `**Ringkasan Eksekutif:**\n\nShort\n\n**Rangkuman:**\n\n1. Item\n\n**Insight tambahan:**\n\n${longInsight}`;
    const result = truncateSummarySections(input, 10);
    const insightStart = result.indexOf("**Insight tambahan:**");
    const insightContent = result.slice(insightStart + "**Insight tambahan:**".length).trim();
    const wordCount = insightContent.split(/\s+/).length;
    expect(wordCount).toBeLessThanOrEqual(10);
  });
});

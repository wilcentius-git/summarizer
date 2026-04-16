"use client";

import ReactMarkdown from "react-markdown";
import { ensureBlankLineAfterSections } from "@/lib/summary-format";

/** Scroll region + element selectors for summary markdown (matches PDF-friendly section spacing). */
const summaryMarkdownBodyClasses =
  "max-h-[400px] overflow-y-auto text-gray-900 [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-2 [&_h1]:mb-1 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-base [&_h3]:font-medium [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-2 [&_li]:mb-0.5 [&_strong]:font-semibold";

type SummaryMarkdownBodyProps = {
  text: string;
  /** Layout and surface: padding, border, margin, min-height, alignment. */
  className: string;
};

export function SummaryMarkdownBody({ text, className }: SummaryMarkdownBodyProps) {
  return (
    <div className={`${className} ${summaryMarkdownBodyClasses}`}>
      <ReactMarkdown>{ensureBlankLineAfterSections(text)}</ReactMarkdown>
    </div>
  );
}

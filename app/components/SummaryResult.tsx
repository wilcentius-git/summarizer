"use client";

import { useCallback, useState } from "react";
import { RawResult } from "@/app/components/RawResult";
import { SummaryMarkdownBody } from "@/app/components/SummaryMarkdownBody";
import { prepareContentForPdf, renderPdfContent } from "@/lib/export-pdf";

function formatElapsedTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (h >= 1) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

type SummaryResultProps = {
  summary: {
    fileId: string;
    fileName: string;
    text: string;
    elapsedSeconds?: number;
    sourceText?: string;
    sourceIsAudio?: boolean;
  };
  setError: (err: string | null) => void;
};

export function SummaryResultPanel({ summary, setError }: SummaryResultProps) {
  const [copyFeedback, setCopyFeedback] = useState(false);

  const copySummary = useCallback(() => {
    if (!summary.text) return;
    navigator.clipboard.writeText(summary.text);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  }, [summary.text]);

  const exportToPdf = useCallback(async () => {
    if (!summary.text) return;

    const dateStr = new Date().toLocaleString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const content = prepareContentForPdf(summary.text);
    const baseName = summary.fileName?.replace(/\.[^.]+$/, "") ?? "document";
    const fileName = `${baseName}-summary.pdf`;

    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const margin = 20;
      const maxWidth = 210 - margin * 2;
      const lineHeight = 6;
      const paragraphSpacing = 4;
      const headingSpacing = 2;
      const pageHeight = 297;
      const maxY = pageHeight - margin;

      let y = margin;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);

      const headerMaxW = maxWidth - 20;
      const titleText = `Dokumen: ${summary.fileName ?? "—"}`;
      const titleLineCount = doc.splitTextToSize(titleText, headerMaxW).length;
      doc.text(titleText, margin, y, { maxWidth: headerMaxW });
      y += titleLineCount * lineHeight;

      doc.text(`Tanggal dibuat: ${dateStr}`, margin, y);
      y += lineHeight;
      y += 4;

      doc.setTextColor(0, 0, 0);
      y = renderPdfContent(doc, content, {
        margin,
        maxWidth,
        lineHeight,
        paragraphSpacing,
        headingSpacing,
        maxY,
        startY: y,
        fontSize: 11,
      });

      doc.save(fileName);
    } catch (err) {
      setError("Gagal mendownload PDF. Coba lagi.");
      console.error(err);
    }
  }, [summary.text, summary.fileName, setError]);

  return (
    <section className="mt-8 text-center">
      <div className="flex items-center w-full mb-2">
        <div className="flex-1" />
        <h2 className="text-base font-semibold text-kemenkum-blue">Summary</h2>
        <div className="flex-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={copySummary}
            className="px-3 py-1.5 rounded bg-kemenkum-yellow text-kemenkum-blue text-sm font-medium hover:opacity-90"
          >
            {copyFeedback ? "Tersalin!" : "Copy"}
          </button>
          <button
            type="button"
            onClick={exportToPdf}
            className="px-3 py-1.5 rounded bg-kemenkum-yellow text-kemenkum-blue text-sm font-medium hover:opacity-90"
          >
            Export to PDF
          </button>
        </div>
      </div>
      {summary.elapsedSeconds != null && (
        <p className="text-sm text-gray-500 mb-2 text-left">
          Proses selesai dalam {formatElapsedTime(summary.elapsedSeconds ?? 0)}.
        </p>
      )}
      {summary.sourceText?.trim() && (
        <RawResult
          className="mb-4"
          label={summary.sourceIsAudio ? "Transkrip mentah" : "Teks sumber"}
          text={summary.sourceText}
        />
      )}
      <SummaryMarkdownBody
        text={summary.text}
        className="w-full p-4 rounded-lg border border-gray-200 bg-gray-50 text-left min-h-[200px]"
      />
      <div aria-live="polite" className="sr-only">
        {copyFeedback ? "Rangkuman berhasil disalin ke clipboard" : ""}
      </div>
    </section>
  );
}

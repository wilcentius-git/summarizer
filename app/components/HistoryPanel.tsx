"use client";

import { useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import { prepareContentForPdf, renderPdfContent } from "@/lib/export-pdf";
import { ensureBlankLineAfterSections } from "@/lib/summary-format";
import type { SummaryJobItem } from "@/app/hooks/useHistory";

type HistoryPanelProps = {
  historyJobs: SummaryJobItem[];
  resumeLoading: string | null;
  resumeProgress: { message?: string } | null;
  onResumeJob: (job: SummaryJobItem) => void;
  onPauseResume: () => void;
  onAbortResume: () => void;
  onDeleteJob: (jobId: string) => Promise<void>;
  setError: (err: string | null) => void;
};

export function HistoryPanel({
  historyJobs,
  resumeLoading,
  resumeProgress,
  onResumeJob,
  onPauseResume,
  onAbortResume,
  onDeleteJob,
  setError,
}: HistoryPanelProps) {
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [viewingJobId, setViewingJobId] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const copyHistoryJob = useCallback((text: string, jobId: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopyFeedback(jobId);
    setTimeout(() => setCopyFeedback(null), 2000);
  }, []);

  const exportHistoryJobToPdf = useCallback(
    async (text: string, filename: string) => {
      if (!text) return;
      const content = prepareContentForPdf(text);
      const dateStr = new Date().toLocaleString("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const baseName = filename?.replace(/\.[^.]+$/, "") ?? "document";
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
        const titleText = `Dokumen: ${filename ?? "—"}`;
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
    },
    [setError]
  );

  const deleteHistoryJob = useCallback(
    async (jobId: string) => {
      try {
        await onDeleteJob(jobId);
        if (viewingJobId === jobId) setViewingJobId(null);
      } catch {
        setError("Gagal menghapus. Coba lagi.");
      }
    },
    [onDeleteJob, viewingJobId, setError]
  );

  return (
    <section className="mt-8 text-center">
      <button
        type="button"
        onClick={() => setHistoryExpanded(!historyExpanded)}
        aria-expanded={historyExpanded}
        className="flex items-center justify-start gap-2 w-full py-2 text-base font-semibold text-kemenkum-blue rounded-lg"
      >
        <span aria-hidden>{historyExpanded ? "▼" : "▶"}</span>
        Riwayat Unggahan ({historyJobs.length})
      </button>
      {historyExpanded && (
        <div className="mt-3 text-left">
          {historyJobs.length === 0 ? (
            <p className="text-sm text-gray-500 py-4">Belum ada riwayat. Unggah dan rangkum file untuk melihat riwayat di sini.</p>
          ) : (
            <ul className="space-y-2 max-h-[400px] overflow-y-auto">
              {historyJobs.map((job) => (
                <li
                  key={job.id}
                  className="p-3 rounded-lg border border-gray-200 bg-white shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 truncate">{job.filename}</p>
                      <p className="text-xs text-gray-500">
                        {new Date(job.uploadTime).toLocaleString("id-ID")} • {job.fileType.toUpperCase()}
                      </p>
                      <span
                        className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium ${
                          job.status === "completed"
                            ? "bg-emerald-100 text-emerald-800"
                            : job.status === "failed"
                              ? "bg-red-100 text-red-800"
                              : job.status === "cancelled"
                                ? "bg-gray-200 text-gray-600"
                                : job.status === "waiting_rate_limit"
                                  ? "bg-amber-100 text-amber-800"
                                  : job.status === "processing"
                                    ? "bg-blue-100 text-blue-800"
                                    : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {job.status === "completed"
                          ? "Selesai"
                          : job.status === "failed"
                            ? "Gagal"
                            : job.status === "cancelled"
                              ? "Dibatalkan"
                              : job.status === "waiting_rate_limit"
                                ? "Menunggu batas API"
                                : job.status === "processing"
                                  ? `${job.progressPercentage}%`
                                  : job.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {job.isResumable && (
                        <>
                          <button
                            type="button"
                            onClick={() => onResumeJob(job)}
                            disabled={!!resumeLoading}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
                          >
                            {resumeLoading === job.id ? "Melanjutkan…" : "Lanjutkan"}
                          </button>
                          {resumeLoading === job.id && (
                            <>
                              <button
                                type="button"
                                onClick={onPauseResume}
                                className="px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 text-sm font-medium hover:bg-amber-50"
                              >
                                Jeda
                              </button>
                              <button
                                type="button"
                                onClick={onAbortResume}
                                className="px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 text-sm font-medium hover:bg-rose-50"
                              >
                                Batalkan
                              </button>
                            </>
                          )}
                        </>
                      )}
                      {job.status === "completed" && job.summaryText && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setViewingJobId(viewingJobId === job.id ? null : job.id)
                            }
                            className="px-3 py-1.5 rounded-lg bg-kemenkum-blue text-white text-sm font-medium hover:opacity-90"
                          >
                            {viewingJobId === job.id ? "Tutup" : "Lihat"}
                          </button>
                          <button
                            type="button"
                            onClick={() => copyHistoryJob(job.summaryText!, job.id)}
                            className="px-3 py-1.5 rounded-lg bg-kemenkum-yellow text-kemenkum-blue text-sm font-medium hover:opacity-90"
                          >
                            {copyFeedback === job.id ? "Tersalin!" : "Copy"}
                          </button>
                          <button
                            type="button"
                            onClick={() => exportHistoryJobToPdf(job.summaryText!, job.filename)}
                            className="px-3 py-1.5 rounded-lg bg-kemenkum-yellow text-kemenkum-blue text-sm font-medium hover:opacity-90"
                          >
                            Export PDF
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteHistoryJob(job.id)}
                        className="px-3 py-1.5 rounded-lg border border-red-300 text-red-700 text-sm font-medium hover:bg-red-50"
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                  {viewingJobId === job.id && job.summaryText && (
                    <div className="mt-3 p-3 rounded-lg bg-gray-50 border border-gray-100 text-gray-900 max-h-[400px] overflow-y-auto [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-2 [&_h1]:mb-1 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-base [&_h3]:font-medium [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-2 [&_li]:mb-0.5 [&_strong]:font-semibold">
                      <ReactMarkdown>{ensureBlankLineAfterSections(job.summaryText)}</ReactMarkdown>
                    </div>
                  )}
                  {job.status === "failed" && job.errorMessage && (
                    <p className="mt-2 text-xs text-red-600">{job.errorMessage}</p>
                  )}
                  {job.status === "cancelled" && !job.isResumable && (
                    <p className="mt-2 text-xs text-gray-600">
                      Dibatalkan sebelum ada progres tersimpan. Tombol Lanjutkan tersedia jika dibatalkan selama transkripsi atau rangkuman.
                    </p>
                  )}
                  {job.status === "waiting_rate_limit" && (
                    <p className="mt-2 text-xs text-amber-700">
                      Batas Groq API tercapai. Job akan dicoba ulang otomatis dalam ~1 jam.
                      {job.retryAfter && (
                        <> Retry: {new Date(job.retryAfter).toLocaleString("id-ID")}</>
                      )}
                    </p>
                  )}
                  {resumeLoading === job.id && resumeProgress && (
                    <p className="mt-2 text-xs text-blue-600">
                      {resumeProgress.message ?? "Melanjutkan…"}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div aria-live="polite" className="sr-only">
        {copyFeedback ? "Rangkuman berhasil disalin ke clipboard" : ""}
      </div>
    </section>
  );
}

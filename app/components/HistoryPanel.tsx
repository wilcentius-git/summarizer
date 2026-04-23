"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RawResult } from "@/app/components/RawResult";
import { SummaryMarkdownBody } from "@/app/components/SummaryMarkdownBody";
import { useAuth } from "@/app/contexts/AuthContext";
import { prepareContentForPdf, renderPdfContent } from "@/lib/export-pdf";
import { sanitizeTitleForFilename, signAndExportPdf } from "@/lib/sign-and-export-pdf";
import { PassphraseModal } from "@/components/PassphraseModal";
import type { SummaryJobItem } from "@/app/hooks/useHistory";
import type jsPDF from "jspdf";

type HistoryPanelProps = {
  historyJobs: SummaryJobItem[];
  resumeLoading: string | null;
  resumeProgress: { message?: string; mergeRound?: number } | null;
  onResumeJob: (job: SummaryJobItem) => void;
  onPauseResume: () => void;
  onAbortResume: () => void;
  onDeleteJob: (jobId: string) => Promise<void>;
  setError: (err: string | null) => void;
  /** Increment after a job completes to expand riwayat and scroll it into view. */
  focusHistorySignal?: number;
};

function TimingTooltip({ label, phases }: { label: string; phases: string }) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLSpanElement>(null);

  const handleMouseEnter = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + 8,
        left: rect.left,
      });
    }
    setVisible(true);
  };

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setVisible(false)}
        className="cursor-default"
      >
        {label}
      </span>
      {visible && typeof window !== "undefined" && createPortal(
        <span
          style={{ top: coords.top, left: coords.left }}
          className="fixed z-[9999] px-3 py-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg pointer-events-none"
        >
          <span
            className="absolute -top-1.5 left-4 w-0 h-0"
            style={{
              borderLeft: "6px solid transparent",
              borderRight: "6px solid transparent",
              borderBottom: "6px solid #111827",
            }}
          />
          <span className="text-gray-300">{phases}</span>
        </span>,
        document.body
      )}
    </>
  );
}

export function HistoryPanel({
  historyJobs,
  resumeLoading,
  resumeProgress,
  onResumeJob,
  onPauseResume,
  onAbortResume,
  onDeleteJob,
  setError,
  focusHistorySignal = 0,
}: HistoryPanelProps) {
  const { user } = useAuth();
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [modal, setModal] = useState<{
    type: "transkrip" | "rangkuman";
    job: SummaryJobItem;
  } | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [passphraseModalKey, setPassphraseModalKey] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (focusHistorySignal <= 0) return;
    setHistoryExpanded(true);
    requestAnimationFrame(() => {
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [focusHistorySignal]);

  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModal(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modal]);

  const buildHistoryJobJsPdf = useCallback(
    async (
      text: string,
      filename: string,
      exportType: "transkrip" | "rangkuman" = "rangkuman"
    ): Promise<jsPDF | null> => {
      if (!text) return null;
      const content = prepareContentForPdf(text);
      const dateStr = new Date().toLocaleString("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
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
      renderPdfContent(doc, content, {
        margin,
        maxWidth,
        lineHeight,
        paragraphSpacing,
        headingSpacing,
        maxY,
        startY: y,
        fontSize: 11,
      });

      return doc;
    },
    []
  );

  const onPassphraseExportConfirm = useCallback(
    async (passphrase: string) => {
      if (!modal) {
        setIsModalOpen(false);
        return;
      }
      if (!user) {
        window.alert("Sesi tidak valid. Silakan masuk kembali.");
        setIsModalOpen(false);
        return;
      }
      setIsLoading(true);
      try {
        const text =
          modal.type === "rangkuman" ? modal.job.summaryText! : modal.job.sourceText!;
        const doc = await buildHistoryJobJsPdf(text, modal.job.filename, modal.type);
        if (!doc) {
          throw new Error("Tidak ada teks untuk diekspor.");
        }
        const fileStem = sanitizeTitleForFilename(modal.job.filename);
        const outPdf =
          modal.type === "transkrip" ? `transkrip-${fileStem}.pdf` : `rangkuman-${fileStem}.pdf`;
        await signAndExportPdf(doc, passphrase, user.id, outPdf);
        setIsModalOpen(false);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Gagal mengekspor PDF. Coba lagi.";
        window.alert(msg);
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    },
    [modal, user, buildHistoryJobJsPdf]
  );

  const deleteHistoryJob = useCallback(
    async (jobId: string) => {
      try {
        await onDeleteJob(jobId);
        if (modal?.job.id === jobId) setModal(null);
      } catch {
        setError("Gagal menghapus. Coba lagi.");
      }
    },
    [onDeleteJob, modal?.job.id, setError]
  );

  return (
    <section ref={sectionRef} className="mt-8 text-center scroll-mt-4">
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
            <ul className="space-y-2 max-h-[400px] overflow-y-auto overflow-x-visible">
              {historyJobs.map((job) => (
                <li
                  key={job.id}
                  className="p-3 rounded-lg borderra border-gray-200 bg-white shadow-sm overflow-visible"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 truncate">{job.filename}</p>
                      <p className="text-xs text-gray-500">
                        {new Date(job.uploadTime).toLocaleString("id-ID")} • {job.fileType.toUpperCase()}
                      </p>
                      <span
                        className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium group cursor-default ${
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
                          ? job.totalDurationMs != null
                            ? (() => {
                                const totalSec = Math.floor(job.totalDurationMs / 1000);
                                const minutes = Math.floor(totalSec / 60);
                                const seconds = totalSec % 60;
                                const totalLabel = minutes > 0
                                  ? `${minutes}m ${seconds}d`
                                  : `${seconds}d`;
                                const phases = [
                                  job.transcribeDurationMs != null && `Transkripsi: ${Math.floor(job.transcribeDurationMs / 1000)}d`,
                                  job.summarizeDurationMs != null && `Rangkum: ${Math.floor(job.summarizeDurationMs / 1000)}d`,
                                  job.mergeDurationMs != null && `Gabung: ${Math.floor(job.mergeDurationMs / 1000)}d`,
                                ].filter(Boolean).join(" • ");
                                return (
                                  <TimingTooltip
                                    label={`Selesai dalam ${totalLabel}`}
                                    phases={phases}
                                  />
                                );
                              })()
                            : "Selesai"
                          : job.status === "failed"
                            ? "Gagal"
                            : job.status === "cancelled"
                              ? job.isResumable
                                ? "Dijeda"
                                : "Dibatalkan"
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
                        </>
                      )}
                      {job.sourceText?.trim() && (
                        <button
                          type="button"
                          onClick={() => setModal({ type: "transkrip", job })}
                          className="px-3 py-1.5 rounded-lg bg-kemenkum-blue text-white text-sm font-medium hover:opacity-90"
                        >
                          Transkrip
                        </button>
                      )}
                      {job.status === "completed" && job.summaryText && (
                        <button
                          type="button"
                          onClick={() => setModal({ type: "rangkuman", job })}
                          className="px-3 py-1.5 rounded-lg bg-kemenkum-blue text-white text-sm font-medium hover:opacity-90"
                        >
                          Rangkuman
                        </button>
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
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {modal && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setModal(null)}
          />
          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-[calc(100%-2rem)] max-w-xl mx-auto max-h-[90vh] my-8 flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
                <h2 className="text-base font-semibold text-gray-800">
                  {modal.type === "transkrip" ? "Transkrip" : "Rangkuman"}
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!user) {
                        window.alert("Sesi tidak valid. Silakan masuk kembali.");
                        return;
                      }
                      if (user.isAdmin) {
                        if (!modal) return;
                        setIsLoading(true);
                        try {
                          const text =
                            modal.type === "rangkuman"
                              ? modal.job.summaryText!
                              : modal.job.sourceText!;
                          const doc = await buildHistoryJobJsPdf(
                            text,
                            modal.job.filename,
                            modal.type
                          );
                          if (!doc) {
                            throw new Error("Tidak ada teks untuk diekspor.");
                          }
                          const fileStem = sanitizeTitleForFilename(modal.job.filename);
                          const outPdf =
                            modal.type === "transkrip"
                              ? `transkrip-${fileStem}.pdf`
                              : `rangkuman-${fileStem}.pdf`;
                          doc.save(outPdf);
                        } catch (e) {
                          const msg =
                            e instanceof Error ? e.message : "Gagal mengekspor PDF. Coba lagi.";
                          window.alert(msg);
                          console.error(e);
                        } finally {
                          setIsLoading(false);
                        }
                        return;
                      }
                      setPassphraseModalKey((k) => k + 1);
                      setIsModalOpen(true);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-yellow-400 text-gray-900 text-sm font-medium hover:opacity-90"
                  >
                    Export PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-sm font-medium hover:bg-gray-200"
                  >
                    Tutup
                  </button>
                </div>
              </div>
              {/* Content */}
              <div
                className="overflow-y-auto p-5 flex-1 select-none"
                onCopy={(e) => e.preventDefault()}
                onCut={(e) => e.preventDefault()}
                onContextMenu={(e) => e.preventDefault()}
              >
                {modal.type === "transkrip" ? (
                  <>
                    <RawResult
                      label=""
                      text={modal.job.sourceText!}
                    />
                    {user?.isAdmin && (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(modal.job.sourceText!);
                        }}
                        className="mt-3 flex items-center gap-2 rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
                      >
                        Salin Transkrip
                      </button>
                    )}
                  </>
                ) : (
                  <div className="text-left [&_*]:text-left">
                    <SummaryMarkdownBody
                      text={modal.job.summaryText!}
                      className="rounded-lg bg-gray-50"
                    />
                    {user?.isAdmin && (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(modal.job.summaryText!);
                        }}
                        className="mt-3 flex items-center gap-2 rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
                      >
                        Salin Rangkuman
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
      <PassphraseModal
        key={passphraseModalKey}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConfirm={onPassphraseExportConfirm}
        isLoading={isLoading}
      />
    </section>
  );
}

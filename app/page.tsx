"use client";

import Image from "next/image";
import { useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";

import kemenkumLogo from "@/assets/kemenkum_logo.png";

type MeetingPoint = {
  topic: string;
  stance: "support" | "mixed" | "oppose" | "unclear";
  evidence: string[];
};

type MeetingRisk = {
  type: string;
  score: number;
  evidence: string[];
};

type MeetingParticipant = {
  speaker: string;
  agreement_confidence?: number;
  points: MeetingPoint[];
  risks: MeetingRisk[];
  summary?: string;
};

type MeetingAnalysis = {
  leader: { name: string; position: string };
  participants: MeetingParticipant[];
};

const MAX_FILE_SIZE_MB = 500;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const ACCEPTED_FILE_TYPES =
  ".pdf,.docx,.doc,.txt,.rtf,.odt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,text/plain,application/rtf,text/rtf,application/vnd.oasis.opendocument.text";

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "application/rtf",
  "text/rtf",
  "application/vnd.oasis.opendocument.text",
]);

const STANCE_STYLES: Record<string, string> = {
  support: "bg-emerald-100 text-emerald-800",
  oppose: "bg-rose-100 text-rose-800",
  mixed: "bg-amber-100 text-amber-800",
  unclear: "bg-slate-100 text-slate-600",
};

const STANCE_LABELS: Record<string, string> = {
  support: "Mendukung",
  oppose: "Menentang",
  mixed: "Campuran",
  unclear: "Tidak jelas",
};

const RISK_LABELS: Record<string, string> = {
  hedging: "Hedging",
  concession_flip: "Setuju + pemblokir",
  vagueness: "Kesepakatan samar",
  deflection: "Defleksi / penghindaran",
  inconsistency: "Ketidakonsistenan",
  no_ownership: "Tanpa kepemilikan",
};

function MeetingAnalysisDisplay({
  fileName,
  data,
}: {
  fileName: string;
  data: MeetingAnalysis;
}) {
  const { leader, participants } = data;
  const list = participants ?? [];

  return (
    <section className="mt-8 text-left">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-kemenkum-blue">Analisis Rapat</h2>
        <p className="text-sm text-slate-500 mt-1">{fileName}</p>
        <p className="text-sm text-slate-600 mt-1">
          Pemimpin: <strong>{leader.name}</strong>
          {leader.position && ` — ${leader.position}`}
        </p>
      </div>

      <div className="space-y-4">
        {list.map((p, i) => (
          <article
            key={i}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <h3 className="font-semibold text-kemenkum-blue">{p.speaker}</h3>
              {p.agreement_confidence != null && (
                <span
                  className={`text-sm px-2.5 py-0.5 rounded-full font-medium ${
                    p.agreement_confidence <= 2
                      ? "bg-rose-100 text-rose-800"
                      : p.agreement_confidence <= 3
                        ? "bg-amber-100 text-amber-800"
                        : "bg-emerald-100 text-emerald-800"
                  }`}
                  title="1 = tidak setuju sama sekali, 5 = sangat setuju"
                >
                  Kesepakatan: {p.agreement_confidence}/5
                </span>
              )}
            </div>

            {p.points?.length ? (
              <div className="mb-4">
                <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                  Posisi per topik
                </h4>
                <ul className="space-y-2">
                  {p.points.map((pt, j) => (
                    <li key={j} className="flex flex-wrap items-baseline gap-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          STANCE_STYLES[pt.stance] ?? STANCE_STYLES.unclear
                        }`}
                      >
                        {STANCE_LABELS[pt.stance] ?? pt.stance}
                      </span>
                      <span className="text-sm text-slate-700">{pt.topic}</span>
                      {pt.evidence?.length ? (
                        <span className="text-xs text-slate-500 italic">
                          — &quot;{pt.evidence[0]}&quot;
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {p.risks?.length ? (
              <div>
                <h4 className="text-xs font-medium text-amber-700 uppercase tracking-wide mb-2">
                  Indikator risiko alignment
                </h4>
                <ul className="space-y-2">
                  {p.risks.map((r, j) => (
                    <li key={j} className="flex flex-wrap items-baseline gap-2 text-sm">
                      <span className="text-amber-700">
                        {RISK_LABELS[r.type] ?? r.type}
                      </span>
                      <span className="text-slate-500">{(r.score * 100).toFixed(0)}%</span>
                      {r.evidence?.length ? (
                        <span className="text-slate-600">
                          — {r.evidence.map((e) => `"${e}"`).join(", ")}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {p.summary ? (
              <p className="mt-4 pt-4 border-t border-slate-100 text-sm text-slate-600 italic">
                {p.summary}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function isSupportedFile(file: File): boolean {
  if (SUPPORTED_MIME_TYPES.has(file.type)) return true;
  // Fallback: check extension when MIME is generic
  if (file.type === "application/octet-stream" || !file.type) {
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    return [".pdf", ".docx", ".doc", ".txt", ".rtf", ".odt"].includes(ext);
  }
  return false;
}

type FileItem = {
  id: string;
  file: File;
  name: string;
  size: number;
};

export default function Home() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [summarizeLoading, setSummarizeLoading] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    fileId: string;
    fileName: string;
    text: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [meetingModalState, setMeetingModalState] = useState<{
    fileId: string;
    leaderName: string;
    leaderPosition: string;
  } | null>(null);
  const [meetingLoading, setMeetingLoading] = useState<string | null>(null);
  const [meetingAnalysis, setMeetingAnalysis] = useState<{
    fileId: string;
    fileName: string;
    data: MeetingAnalysis;
  } | null>(null);

  const addFiles = useCallback((newFiles: FileList | null) => {
    if (!newFiles?.length) return;
    setError(null);
    const added: FileItem[] = [];
    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i];
      if (!isSupportedFile(file)) {
        setError(
          "Unsupported file type. Supported: PDF, DOCX, DOC, TXT, RTF, ODT."
        );
        continue;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setError(`File ${file.name} exceeds ${MAX_FILE_SIZE_MB} MB.`);
        continue;
      }
      added.push({
        id: `${file.name}-${file.size}-${Date.now()}-${i}`,
        file,
        name: file.name,
        size: file.size,
      });
    }
    setFiles((prev) => [...prev, ...added]);
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    if (summary?.fileId === id) setSummary(null);
    if (meetingAnalysis?.fileId === id) setMeetingAnalysis(null);
    if (meetingModalState?.fileId === id) setMeetingModalState(null);
    setError(null);
  }, [summary?.fileId, meetingAnalysis?.fileId, meetingModalState?.fileId]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === "dragenter" || e.type === "dragover");
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const handleSummarize = useCallback(async (item: FileItem) => {
    setError(null);
    setSummarizeLoading(item.id);
    try {
      const formData = new FormData();
      formData.append("file", item.file);
      const res = await fetch("/api/summarize", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Summarize failed: ${res.status}`);
      }
      const data = await res.json();
      setSummary({ fileId: item.id, fileName: item.name, text: data.summary ?? "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Summarize failed.");
    } finally {
      setSummarizeLoading(null);
    }
  }, []);

  const copySummary = useCallback(() => {
    if (!summary?.text) return;
    navigator.clipboard.writeText(summary.text);
  }, [summary?.text]);

  const exportToPdf = useCallback(async () => {
    if (!summary?.text) return;
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const margin = 15;
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const maxW = pageW - 2 * margin;
    const lineHeight = 6;
    let y = margin;

    const dateStr = new Date().toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    pdf.setFontSize(10);
    pdf.setTextColor(100, 100, 100);
    pdf.text(`Dokumen: ${summary.fileName ?? "—"}`, margin, y);
    y += lineHeight;
    pdf.text(`Tanggal dibuat: ${dateStr}`, margin, y);
    y += lineHeight * 1.5;
    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(11);

    const stripMarkdown = (s: string) =>
      s
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/\*(.+?)\*/g, "$1")
        .replace(/^#+\s*/gm, "")
        .replace(/^\s*[-*]\s+/gm, "• ")
        .replace(/^\s*\d+\.\s+/gm, "");

    const addPageIfNeeded = (needed: number) => {
      if (y + needed > pageH - margin) {
        pdf.addPage();
        y = margin;
      }
    };

    const lines = stripMarkdown(summary.text).split(/\r?\n/);
    pdf.setFontSize(11);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        y += lineHeight * 0.5;
        continue;
      }
      const wrapped = pdf.splitTextToSize(trimmed, maxW);
      addPageIfNeeded(wrapped.length * lineHeight);
      pdf.text(wrapped, margin, y);
      y += wrapped.length * lineHeight;
    }

    const baseName = (summary.fileName ?? "document").replace(/\.[^/.]+$/, "");
    pdf.save(`${baseName}_summary.pdf`);
  }, [summary?.text, summary?.fileName]);

  const openMeetingModal = useCallback((item: FileItem) => {
    setError(null);
    setMeetingModalState({
      fileId: item.id,
      leaderName: "",
      leaderPosition: "",
    });
  }, []);

  const closeMeetingModal = useCallback(() => {
    setMeetingModalState(null);
  }, []);

  const handleMeetingSubmit = useCallback(
    async () => {
      const state = meetingModalState;
      if (!state) return;
      const item = files.find((f) => f.id === state.fileId);
      if (!item) return;
      if (!state.leaderName.trim()) {
        setError("Nama wajib diisi.");
        return;
      }
      setError(null);
      setMeetingLoading(item.id);
      try {
        const formData = new FormData();
        formData.append("file", item.file);
        formData.append("leaderName", state.leaderName.trim());
        formData.append("leaderPosition", state.leaderPosition.trim());
        const res = await fetch("/api/summarize-meeting", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Meeting analysis failed: ${res.status}`);
        }
        const data = await res.json();
        const analysis = data.analysis as MeetingAnalysis;
        if (!analysis?.participants) {
          throw new Error("Invalid analysis response.");
        }
        setMeetingAnalysis({
          fileId: item.id,
          fileName: item.name,
          data: analysis,
        });
        setMeetingModalState(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Meeting analysis failed.");
      } finally {
        setMeetingLoading(null);
      }
    },
    [meetingModalState, files]
  );

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <main className="min-h-screen bg-kemenkum-blue py-8 px-4 flex justify-center items-center overflow-y-auto">
      <div
        className={`w-full bg-white rounded-lg shadow-lg px-8 py-10 mx-auto ${
          meetingAnalysis ? "max-w-4xl" : "max-w-2xl"
        } text-center`}
      >
        <div className="flex items-center justify-center gap-3 mb-2">
          <Image src={kemenkumLogo} alt="Kemenkum" width={48} height={48} />
          <h1 className="text-2xl font-bold text-kemenkum-blue">Kemenkum Summarizer</h1>
        </div>
        <p className="text-gray-600 mb-8">
          Unggah dokumen (PDF, DOCX, TXT, RTF, ODT) untuk diringkas.
        </p>

        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={`flex flex-col items-center gap-4 transition-colors rounded-2xl py-4 ${
            dragActive ? "bg-kemenkum-yellow/10" : ""
          }`}
        >
          <label className="cursor-pointer">
            <input
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            <span className="inline-block px-10 py-3 rounded-2xl bg-kemenkum-blue text-white font-medium text-base hover:opacity-90">
              Pilih file dokumen
            </span>
          </label>
          <p className="text-sm text-gray-600">
            atau jatuhkan file di sini (PDF, DOCX, TXT, RTF, ODT)
          </p>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm text-center" role="alert">
            {error}
          </div>
        )}

        {meetingModalState && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="meeting-modal-title"
          >
            <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
              <h2 id="meeting-modal-title" className="text-lg font-semibold text-kemenkum-blue mb-4">
                Siapa Anda dalam percakapan ini?
              </h2>
              <div className="space-y-4">
                <div>
                  <label htmlFor="leader-name" className="block text-sm font-medium text-gray-700 mb-1">
                    Nama Anda *
                  </label>
                  <input
                    id="leader-name"
                    type="text"
                    value={meetingModalState.leaderName}
                    onChange={(e) =>
                      setMeetingModalState((prev) =>
                        prev ? { ...prev, leaderName: e.target.value } : null
                      )
                    }
                    placeholder="Contoh: Budi"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue"
                    autoFocus
                  />
                </div>
                <div>
                  <label htmlFor="leader-position" className="block text-sm font-medium text-gray-700 mb-1">
                    Posisi / usulan Anda (opsional)
                  </label>
                  <input
                    id="leader-position"
                    type="text"
                    value={meetingModalState.leaderPosition}
                    onChange={(e) =>
                      setMeetingModalState((prev) =>
                        prev ? { ...prev, leaderPosition: e.target.value } : null
                      )
                    }
                    placeholder="Contoh: Mendukung opsi A dengan deadline 2 minggu"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue"
                  />
                </div>
              </div>
              <div className="mt-6 flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={closeMeetingModal}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm font-medium hover:bg-gray-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleMeetingSubmit}
                  disabled={!!meetingLoading}
                  className="px-4 py-2 rounded-lg bg-kemenkum-blue text-white text-sm font-medium hover:opacity-90 disabled:opacity-60"
                >
                  {meetingLoading ? "Menganalisis…" : "Lanjutkan"}
                </button>
              </div>
            </div>
          </div>
        )}

        {files.length > 0 && (
          <section className="mt-8 text-center">
            <h2 className="text-base font-semibold text-kemenkum-blue mb-3">Files</h2>
            <ul className="space-y-3">
              {files.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-center gap-3 p-3 rounded-lg border border-gray-200 bg-white shadow-sm"
                >
                  <div className="flex-1 min-w-0 text-center">
                    <p className="font-medium text-gray-900 truncate">{item.name}</p>
                    <p className="text-sm text-gray-500">{formatSize(item.size)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSummarize(item)}
                      disabled={!!summarizeLoading}
                      className="px-4 py-2 rounded-lg bg-kemenkum-blue text-white text-sm font-medium hover:opacity-90 disabled:opacity-60"
                    >
                      {summarizeLoading === item.id ? "Summarizing…" : "Summarize"}
                    </button>
                    <button
                      type="button"
                      onClick={() => openMeetingModal(item)}
                      disabled={!!meetingLoading}
                      className="px-4 py-2 rounded-lg bg-kemenkum-blue text-white text-sm font-medium hover:opacity-90 disabled:opacity-60"
                    >
                      {meetingLoading === item.id ? "Analyzing…" : "Summarize Meeting"}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFile(item.id)}
                      className="px-3 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {summary && (
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
                  Copy
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
            <div className="w-full p-4 rounded-lg border border-gray-200 bg-gray-50 text-gray-900 text-left min-h-[200px] max-h-[400px] overflow-y-auto [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-2 [&_h1]:mb-1 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-base [&_h3]:font-medium [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-2 [&_li]:mb-0.5 [&_strong]:font-semibold">
              <ReactMarkdown>{summary.text}</ReactMarkdown>
            </div>
          </section>
        )}

        {meetingAnalysis && (
          <MeetingAnalysisDisplay
            fileName={meetingAnalysis.fileName}
            data={meetingAnalysis.data}
          />
        )}
      </div>
    </main>
  );
}

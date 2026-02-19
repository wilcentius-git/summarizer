"use client";

import Image from "next/image";
import { useCallback, useState } from "react";

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
/** Typical compression ratio for Ghostscript /ebook; 40% of original is a reasonable estimate */
const ESTIMATED_COMPRESSION_RATIO = 0.4;

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

function isPdf(file: File): boolean {
  return file.type === "application/pdf";
}

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
  const [compressLoading, setCompressLoading] = useState<string | null>(null);
  const [summarizeLoading, setSummarizeLoading] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ fileId: string; text: string } | null>(null);
  const [compressSuccess, setCompressSuccess] = useState<string | null>(null);
  const [compressedSizes, setCompressedSizes] = useState<Record<string, number>>({});
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
    if (compressSuccess === id) setCompressSuccess(null);
    if (meetingAnalysis?.fileId === id) setMeetingAnalysis(null);
    if (meetingModalState?.fileId === id) setMeetingModalState(null);
    setCompressedSizes((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setError(null);
  }, [summary?.fileId, compressSuccess, meetingAnalysis?.fileId, meetingModalState?.fileId]);

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

  const handleCompress = useCallback(async (item: FileItem) => {
    setError(null);
    setCompressSuccess(null);
    setCompressLoading(item.id);
    try {
      const formData = new FormData();
      formData.append("file", item.file);
      const res = await fetch("/api/compress", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Compress failed: ${res.status}`);
      }
      const blob = await res.blob();
      setCompressedSizes((prev) => ({ ...prev, [item.id]: blob.size }));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.name.replace(/\.pdf$/i, "_compressed.pdf");
      a.click();
      URL.revokeObjectURL(url);
      setCompressSuccess(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Compress failed.");
    } finally {
      setCompressLoading(null);
    }
  }, []);

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
      setSummary({ fileId: item.id, text: data.summary ?? "" });
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
          Unggah dokumen (PDF, DOCX, TXT, RTF, ODT) untuk diringkas atau dikompresi.
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
                    <p className="text-sm text-gray-500">
                      {formatSize(item.size)}
                      {isPdf(item.file) && (
                        <span className="text-gray-400 ml-1">
                          (
                          {compressedSizes[item.id] != null
                            ? `~${formatSize(compressedSizes[item.id])} after compression`
                            : `est. ~${formatSize(Math.round(item.size * ESTIMATED_COMPRESSION_RATIO))} after compression`}
                          )
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCompress(item)}
                      disabled={!!compressLoading || !isPdf(item.file)}
                      title={
                        !isPdf(item.file)
                          ? "Compression is only available for PDF files"
                          : undefined
                      }
                      className="px-4 py-2 rounded-lg bg-kemenkum-blue text-white text-sm font-medium hover:opacity-90 disabled:opacity-60"
                    >
                      {compressLoading === item.id ? "Compressing…" : "Compress"}
                    </button>
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
                  {compressSuccess === item.id && (
                    <span className="w-full text-sm text-green-600">Download started.</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {summary && (
          <section className="mt-8 text-center">
            <h2 className="text-base font-semibold text-kemenkum-blue mb-2">Summary</h2>
            <div className="relative">
              <textarea
                readOnly
                value={summary.text}
                rows={10}
                className="w-full p-4 rounded-lg border border-gray-200 bg-gray-50 text-gray-900 resize-y text-center"
              />
              <button
                type="button"
                onClick={copySummary}
                className="absolute top-2 right-2 px-3 py-1.5 rounded bg-kemenkum-yellow text-kemenkum-blue text-sm font-medium hover:opacity-90"
              >
                Copy
              </button>
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

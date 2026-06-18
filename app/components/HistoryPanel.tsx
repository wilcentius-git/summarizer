"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Undo2, Redo2 } from "lucide-react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { BulletList, OrderedList, ListItem, ListKeymap } from "@tiptap/extension-list";
import { TextStyle, FontSize } from "@tiptap/extension-text-style";
import { RawResult } from "@/app/components/RawResult";
import { SummaryMarkdownBody } from "@/app/components/SummaryMarkdownBody";
import { useAuth } from "@/app/contexts/AuthContext";
import { buildJobPdf } from "@/lib/export-pdf";
import { htmlToMarkdown, markdownToHtml } from "@/lib/markdown-editor";
import { sanitizeTitleForFilename, signAndExportPdf } from "@/lib/sign-and-export-pdf";
import { PassphraseModal } from "@/components/PassphraseModal";
import type { SummaryJobItem } from "@/app/hooks/useHistory";

type SummaryEditorPanelProps = {
  summaryText: string;
  isSaving: boolean;
  onCancel: () => void;
  onSave: (markdown: string) => void;
};

function SummaryEditorPanel({
  summaryText,
  isSaving,
  onCancel,
  onSave,
}: SummaryEditorPanelProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
      }),
      BulletList,
      OrderedList,
      ListItem,
      TextStyle,
      FontSize,
    ],
    content: markdownToHtml(summaryText),
    immediatelyRender: false,
  });

  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const update = () => forceUpdate((n) => n + 1);
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);

  const toolbarButtonClass = (active: boolean) =>
    `rounded-md p-1.5 transition-colors disabled:opacity-60 ${
      active
        ? "bg-gray-200 text-gray-900"
        : "text-gray-700 hover:bg-gray-200"
    }`;

  if (!editor) {
    return <p className="text-sm text-gray-600">Memuat editor…</p>;
  }

  return (
    <>
      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-gray-200 bg-white p-2 shadow-sm">
          {/* Undo / Redo */}
          <button type="button" onClick={() => editor.chain().focus().undo().run()} disabled={isSaving || !editor.can().undo()} className={toolbarButtonClass(!editor.can().undo())} title="Undo">
            <Undo2 size={16} />
          </button>
          <button type="button" onClick={() => editor.chain().focus().redo().run()} disabled={isSaving || !editor.can().redo()} className={toolbarButtonClass(!editor.can().redo())} title="Redo">
            <Redo2 size={16} />
          </button>

          <div className="mx-1 h-5 w-px bg-gray-300" />

          {/* Bold / Italic / Underline */}
          <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} disabled={isSaving} className={toolbarButtonClass(editor.isActive("bold") || editor.isActive("heading"))} title="Bold">
            <Bold size={16} />
          </button>
          <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} disabled={isSaving} className={toolbarButtonClass(editor.isActive("italic"))} title="Italic">
            <Italic size={16} />
          </button>

          <div className="mx-1 h-5 w-px bg-gray-300" />

          {/* Lists */}
          <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} disabled={isSaving} className={toolbarButtonClass(editor.isActive("bulletList"))} title="Bullet List">
            <List size={16} />
          </button>
          <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} disabled={isSaving} className={toolbarButtonClass(editor.isActive("orderedList"))} title="Ordered List">
            <ListOrdered size={16} />
          </button>

          <div className="mx-1 h-5 w-px bg-gray-300" />

          {/* Font Size — only two sizes: normal (14px) and large (18px) */}
          <button type="button" onClick={() => editor.chain().focus().setFontSize("16px").run()} disabled={isSaving} className={toolbarButtonClass(editor.isActive("textStyle", { fontSize: "16px" }) || editor.isActive("heading"))} title="Large text">
            <span className="text-base font-bold">A</span>
          </button>
          <button type="button" onClick={() => editor.chain().focus().setFontSize("14px").run()} disabled={isSaving} className={toolbarButtonClass(!editor.isActive("textStyle", { fontSize: "16px" }) && !editor.isActive("heading"))} title="Normal text">
            <span className="text-xs font-bold">A</span>
          </button>
        </div>
        <div className="overflow-y-auto max-h-[400px]">
          <EditorContent
            editor={editor}
            spellCheck={false}
            className="bg-gray-50 p-4 text-left text-sm text-gray-900 [&_.ProseMirror]:min-h-[180px] [&_.ProseMirror]:outline-none [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6 [&_.ProseMirror_ol]:my-2 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ul]:my-2 [&_.ProseMirror_li]:my-1 [&_.ProseMirror_h3]:font-bold [&_.ProseMirror_h3]:text-base [&_.ProseMirror_h3]:mt-4 [&_.ProseMirror_h3]:mb-2"
          />
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-sm font-medium hover:bg-gray-200 disabled:opacity-60"
        >
          Batal
        </button>
        <button
          type="button"
          onClick={() => onSave(htmlToMarkdown(editor.getHTML()))}
          disabled={isSaving}
          className="px-3 py-1.5 rounded-lg bg-kemenkum-blue text-white text-sm font-medium hover:opacity-90 disabled:opacity-60"
        >
          {isSaving ? "Menyimpan…" : "Simpan"}
        </button>
      </div>
    </>
  );
}

type HistoryPanelProps = {
  historyJobs: SummaryJobItem[];
  resumeLoading: string | null;
  resumeProgress: { message?: string; mergeRound?: number } | null;
  onResumeJob: (job: SummaryJobItem) => void;
  onPauseResume: () => void;
  onAbortResume: () => void;
  onDeleteJob: (jobId: string) => Promise<void>;
  setError: (err: string | null) => void;
  fetchHistory?: () => Promise<void>;
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
      {visible && createPortal(
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

type JobWithTotalDuration = SummaryJobItem & { totalDurationMs: number };

function TimingLabel({ job }: { job: JobWithTotalDuration }) {
  const totalSec = Math.floor(job.totalDurationMs / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  const totalLabel = minutes > 0 ? `${minutes}m ${seconds}d` : `${seconds}d`;
  const phases = [
    job.transcribeDurationMs != null && `Transkripsi: ${Math.floor(job.transcribeDurationMs / 1000)}d`,
    job.summarizeDurationMs != null && `Rangkum: ${Math.floor(job.summarizeDurationMs / 1000)}d`,
    job.mergeDurationMs != null && `Gabung: ${Math.floor(job.mergeDurationMs / 1000)}d`,
  ]
    .filter(Boolean)
    .join(" • ");
  return <TimingTooltip label={`Selesai dalam ${totalLabel}`} phases={phases} />;
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
  fetchHistory,
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
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (focusHistorySignal <= 0) return;
    setHistoryExpanded(true);
    requestAnimationFrame(() => {
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [focusHistorySignal]);

  useEffect(() => {
    if (!modal) {
      setIsEditing(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModal(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modal]);

  const handleSaveSummary = useCallback(
    async (markdown: string) => {
      if (!modal || modal.type !== "rangkuman") return;

      setIsSaving(true);
      try {
        const res = await fetch(
          `/api/summary-jobs/${encodeURIComponent(modal.job.id)}/edit`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ summaryText: markdown }),
          }
        );
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          window.alert(data.error || "Gagal menyimpan rangkuman.");
          return;
        }

        setModal((prev) =>
          prev
            ? { ...prev, job: { ...prev.job, summaryText: markdown } }
            : null
        );
        await fetchHistory?.();
        setIsEditing(false);
      } catch {
        window.alert("Gagal menyimpan rangkuman.");
      } finally {
        setIsSaving(false);
      }
    },
    [modal, fetchHistory]
  );

  const buildExportDoc = useCallback(async () => {
    if (!modal) return null;
    const text =
      modal.type === "rangkuman" ? modal.job.summaryText! : modal.job.sourceText!;
    const doc = await buildJobPdf(text, modal.job.filename);
    if (!doc) throw new Error("Tidak ada teks untuk diekspor.");
    const fileStem = sanitizeTitleForFilename(modal.job.filename);
    const outPdf =
      modal.type === "transkrip" ? `transkrip-${fileStem}.pdf` : `rangkuman-${fileStem}.pdf`;
    return { doc, outPdf };
  }, [modal]);

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
        const payload = await buildExportDoc();
        if (!payload) return;
        const { doc, outPdf } = payload;
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
    [modal, user, buildExportDoc]
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
                        {job.userId && job.userId !== user?.id && job.ownerName && (
                          <> • {job.ownerName}</>
                        )}
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
                            ? <TimingLabel job={job as JobWithTotalDuration} />
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
                        <button
                          type="button"
                          onClick={() => onResumeJob(job)}
                          disabled={!!resumeLoading}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
                        >
                          {resumeLoading === job.id ? "Melanjutkan…" : "Lanjutkan"}
                        </button>
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
                  {user?.isAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        const text =
                          modal.type === "transkrip"
                            ? modal.job.sourceText!
                            : modal.job.summaryText!;
                        navigator.clipboard.writeText(text);
                      }}
                      className="flex items-center gap-2 rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
                    >
                      Salin
                    </button>
                  )}
                  {modal.type === "rangkuman" && !isEditing && (
                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200"
                    >
                      Edit
                    </button>
                  )}
                  {!isEditing && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!user) {
                        window.alert("Sesi tidak valid. Silakan masuk kembali.");
                        return;
                      }
                      if (user.isAdmin) {
                        setIsLoading(true);
                        try {
                          const { doc, outPdf } = (await buildExportDoc())!;
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
                  )}
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
                className={`overflow-y-auto p-5 flex-1 ${isEditing ? "" : "select-none"}`}
                onCopy={isEditing ? undefined : (e) => e.preventDefault()}
                onCut={isEditing ? undefined : (e) => e.preventDefault()}
                onContextMenu={isEditing ? undefined : (e) => e.preventDefault()}
              >
                {modal.type === "transkrip" ? (
                  <RawResult
                    label=""
                    text={modal.job.sourceText!}
                  />
                ) : isEditing ? (
                  <SummaryEditorPanel
                    key={modal.job.id}
                    summaryText={modal.job.summaryText!}
                    isSaving={isSaving}
                    onCancel={() => setIsEditing(false)}
                    onSave={(markdown) => {
                      void handleSaveSummary(markdown);
                    }}
                  />
                ) : (
                  <div className="text-left [&_*]:text-left">
                    <SummaryMarkdownBody
                      text={modal.job.summaryText!}
                      className="rounded-lg bg-gray-50"
                    />
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

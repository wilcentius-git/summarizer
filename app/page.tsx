"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

import kemenkumLogo from "@/assets/kemenkum_logo.png";
import { useAuth } from "@/app/contexts/AuthContext";
import {
  prepareContentForPdf,
  renderPdfContent,
} from "@/lib/export-pdf";
import { ensureBlankLineAfterSections } from "@/lib/summary-format";

const GROQ_API_KEY_CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour
const GROQ_API_KEY_CACHE_KEY = "groqApiKeyCache";

const MAX_FILE_SIZE_MB = 500;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_AUDIO_SIZE_MB = 25; // Groq free tier limit
const MAX_AUDIO_SIZE_BYTES = MAX_AUDIO_SIZE_MB * 1024 * 1024;

const ACCEPTED_FILE_TYPES =
  ".pdf,.docx,.doc,.txt,.rtf,.odt,.srt,.mp3,.wav,.m4a,.webm,.flac,.ogg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,text/plain,application/rtf,text/rtf,application/vnd.oasis.opendocument.text,application/x-subrip,audio/mpeg,audio/mp3,audio/mp4,audio/mpga,audio/wav,audio/webm,audio/flac,audio/ogg";

const DOCUMENT_EXTENSIONS = [".pdf", ".docx", ".doc", ".txt", ".rtf", ".odt", ".srt"];
const AUDIO_EXTENSIONS = [".mp3", ".mp4", ".mpeg", ".mpga", ".m4a", ".wav", ".webm", ".flac", ".ogg"];

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "application/rtf",
  "text/rtf",
  "application/vnd.oasis.opendocument.text",
  "application/x-subrip",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/mpga",
  "audio/wav",
  "audio/webm",
  "audio/flac",
  "audio/ogg",
]);

function isSupportedFile(file: File): boolean {
  if (SUPPORTED_MIME_TYPES.has(file.type)) return true;
  // Fallback: check extension when MIME is generic
  if (file.type === "application/octet-stream" || !file.type) {
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    return [...DOCUMENT_EXTENSIONS, ...AUDIO_EXTENSIONS].includes(ext);
  }
  return false;
}

function isAudioFile(file: File): boolean {
  if (["audio/mpeg", "audio/mp3", "audio/mp4", "audio/mpga", "audio/wav", "audio/webm", "audio/flac", "audio/ogg"].includes(file.type)) return true;
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  return AUDIO_EXTENSIONS.includes(ext);
}

type FileItem = {
  id: string;
  file: File;
  name: string;
  size: number;
  /** Audio duration in seconds (loaded when file is added). */
  durationSeconds?: number;
};

/** Get audio duration in seconds using the browser's Audio API. */
function getAudioDurationInBrowser(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load audio"));
    };
    audio.src = url;
  });
}

function loadCachedGroqApiKey(): string {
  if (typeof window === "undefined") return "";
  try {
    const stored = localStorage.getItem(GROQ_API_KEY_CACHE_KEY);
    if (!stored) return "";
    const { key, expiresAt } = JSON.parse(stored) as { key?: string; expiresAt?: number };
    if (key && expiresAt && Date.now() < expiresAt) return key;
    localStorage.removeItem(GROQ_API_KEY_CACHE_KEY);
  } catch {
    localStorage.removeItem(GROQ_API_KEY_CACHE_KEY);
  }
  return "";
}

function saveGroqApiKeyToCache(key: string) {
  if (typeof window === "undefined" || !key.trim()) return;
  const cache = { key: key.trim(), expiresAt: Date.now() + GROQ_API_KEY_CACHE_DURATION_MS };
  localStorage.setItem(GROQ_API_KEY_CACHE_KEY, JSON.stringify(cache));
}

/** Rough estimate: ~45s per 50KB, minimum 30s */
function estimateSummarizeSeconds(fileSizeBytes: number): number {
  return Math.max(30, Math.ceil(fileSizeBytes / 50000) * 45);
}

/**
 * Estimate time for Groq Whisper transcription + summarization (no diarization).
 * Models: chunked transcription (~4 min/chunk, ~55s per chunk) + chunked summarization
 * (~900 chars/min transcript, 4500 chars/chunk, ~42s per chunk + merge).
 */
function estimateAudioTranscribeSeconds(durationSeconds: number | undefined, fileSizeBytes: number): number {
  const TRANSCRIBE_CHUNK_STEP_SEC = 238; // 4 min - 2 sec overlap
  const TRANSCRIBE_SEC_PER_CHUNK = 55; // ~45s API + 3s delay + buffer for rate limits
  const CHARS_PER_MIN_AUDIO = 900; // ~150 wpm * 6 chars/word
  const SUMMARIZE_CHUNK_SIZE = 4500;
  const SUMMARIZE_SEC_PER_CHUNK = 42; // ~30s API + 6s delay + buffer
  const MERGE_OVERHEAD_SEC = 60; // pre-delay + merge API

  let durationMin: number;
  if (durationSeconds != null && durationSeconds > 0) {
    durationMin = durationSeconds / 60;
  } else {
    // Fallback: ~1 MB ≈ 1 min for typical mp3
    const mb = fileSizeBytes / (1024 * 1024);
    durationMin = Math.max(1, mb);
  }

  const durationSec = durationMin * 60;
  const transChunks =
    durationSec <= 300 && fileSizeBytes <= 8 * 1024 * 1024
      ? 1
      : Math.ceil(durationSec / TRANSCRIBE_CHUNK_STEP_SEC);
  const transcriptChars = durationMin * CHARS_PER_MIN_AUDIO;
  const sumChunks = Math.max(1, Math.ceil(transcriptChars / SUMMARIZE_CHUNK_SIZE));

  const transTime = transChunks * TRANSCRIBE_SEC_PER_CHUNK;
  const sumTime = sumChunks * SUMMARIZE_SEC_PER_CHUNK + MERGE_OVERHEAD_SEC;
  return Math.max(60, Math.ceil(transTime + sumTime));
}

/** Normalize text to prevent overlapping: \r causes overwrite; remove control chars. */
function sanitizeSummaryText(s: string): string {
  if (!s) return s;
  return s
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

/** Map Groq 412/413/429 errors to user-friendly messages. */
function toUserFriendlyError(msg: string): string {
  if (/41[23]/.test(msg)) return "You used up a per-minute quota.";
  if (/429/.test(msg)) return "Wait for the rate limit window to reset (usually 1 hour).";
  return msg;
}

/** Format elapsed seconds as mm:ss (< 1h) or hh:mm:ss (≥ 1h). */
function formatElapsedTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (h >= 1) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

type SummaryJobItem = {
  id: string;
  filename: string;
  fileType: string;
  uploadTime: string;
  status: string;
  summaryText: string | null;
  progressPercentage: number;
  groqAttempts: number;
  errorMessage: string | null;
  retryAfter?: string | null;
  isResumable?: boolean;
  totalChunks?: number | null;
  processedChunks?: number;
};

export default function Home() {
  const { user, loading: authLoading, logout } = useAuth();
  const [groqApiKey, setGroqApiKey] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [historyJobs, setHistoryJobs] = useState<SummaryJobItem[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [viewingJobId, setViewingJobId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [summarizeLoading, setSummarizeLoading] = useState<string | null>(null);
  const [summarizeProgress, setSummarizeProgress] = useState<{
    phase: string;
    current: number;
    total: number;
    message?: string;
    step?: number;
    stepLabel?: string;
  } | null>(null);
  const [estimatedSeconds, setEstimatedSeconds] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const summarizeAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setGroqApiKey(loadCachedGroqApiKey());
  }, []);

  const fetchHistory = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch("/api/summary-jobs", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setHistoryJobs(data.jobs ?? []);
      }
    } catch {
      // Ignore fetch errors
    }
  }, [user]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    if (groqApiKey.trim()) saveGroqApiKeyToCache(groqApiKey);
  }, [groqApiKey]);

  useEffect(() => {
    if (!summarizeLoading) {
      setElapsedSeconds(0);
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [summarizeLoading]);
  const [summary, setSummary] = useState<{
    fileId: string;
    fileName: string;
    text: string;
    elapsedSeconds?: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [resumeLoading, setResumeLoading] = useState<string | null>(null);
  const [currentSummarizeJobId, setCurrentSummarizeJobId] = useState<string | null>(null);
  const [resumeProgress, setResumeProgress] = useState<{ message?: string } | null>(null);
  const resumeAbortRef = useRef<AbortController | null>(null);
  const resumeCardRef = useRef<HTMLDivElement | null>(null);
  const pauseResume = useCallback(async () => {
    resumeAbortRef.current?.abort();
    const jobId = resumeLoading;
    if (jobId) {
      try {
        await fetch(`/api/summary-jobs/${jobId}/cancel`, {
          method: "POST",
          credentials: "include",
        });
        fetchHistory();
      } catch {
        // Ignore
      }
    }
  }, [resumeLoading, fetchHistory]);

  const abortResume = useCallback(async () => {
    resumeAbortRef.current?.abort();
    const jobId = resumeLoading;
    if (jobId) {
      try {
        await fetch(`/api/summary-jobs/${jobId}/cancel`, {
          method: "POST",
          credentials: "include",
        });
        fetchHistory();
      } catch {
        // Ignore
      }
    }
  }, [resumeLoading, fetchHistory]);

  const handleResumeJob = useCallback(
    async (job: SummaryJobItem) => {
      const key = groqApiKey.trim();
      if (!key) {
        setError("Masukkan Groq API key terlebih dahulu. Dapatkan di console.groq.com");
        return;
      }
      if (!job.isResumable) return;
      setError(null);
      setResumeLoading(job.id);
      setResumeProgress({ message: "Melanjutkan…" });
      setHistoryExpanded(false);

      requestAnimationFrame(() => {
        resumeCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });

      const controller = new AbortController();
      resumeAbortRef.current = controller;
      const startTime = Date.now();

      try {
        const res = await fetch(`/api/summary-jobs/${job.id}/resume`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groqApiKey: key }),
          signal: controller.signal,
          credentials: "include",
        });

        if (!res.ok || !res.body) {
          const text = await res.text();
          let errMsg = `Resume failed: ${res.status}`;
          try {
            const data = JSON.parse(text);
            if (data?.error) errMsg = data.error;
          } catch {
            if (text && text.length < 200) errMsg = text;
          }
          throw new Error(errMsg);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line) as {
                type?: string;
                step?: number;
                stepLabel?: string;
                phase?: string;
                current?: number;
                total?: number;
                message?: string;
                text?: string;
              };
              if (data.type === "progress") {
                const msg =
                  data.message ??
                  (data.phase === "chunks" && data.total != null
                    ? `Bagian ${data.current ?? 0} dari ${data.total}`
                    : data.phase === "merge"
                      ? "Menggabungkan rangkuman…"
                      : "Memproses…");
                setResumeProgress({ message: msg });
              } else if (data.type === "summary") {
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                setSummary({
                  fileId: job.id,
                  fileName: job.filename,
                  text: sanitizeSummaryText(data.text ?? ""),
                  elapsedSeconds: elapsed,
                });
                fetchHistory();
              } else if (data.type === "waiting_rate_limit") {
                fetchHistory();
                setError(null);
                setResumeLoading(null);
                setResumeProgress(null);
                return;
              } else if (data.type === "error") {
                throw new Error(data.message ?? "Resume failed.");
              }
            } catch (parseErr) {
              if (parseErr instanceof SyntaxError) continue;
              throw parseErr;
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          setError("Dibatalkan.");
        } else {
          setError(toUserFriendlyError(err instanceof Error ? err.message : "Resume failed."));
        }
      } finally {
        setResumeLoading(null);
        setResumeProgress(null);
        resumeAbortRef.current = null;
      }
    },
    [groqApiKey, fetchHistory]
  );

  const addFiles = useCallback((newFiles: FileList | null) => {
    if (!newFiles?.length) return;
    setError(null);
    const added: FileItem[] = [];
    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i];
      if (!isSupportedFile(file)) {
        setError(
          "Unsupported file type. Supported: PDF, DOCX, DOC, TXT, RTF, ODT, SRT, MP3, WAV, M4A, WebM, FLAC, OGG."
        );
        continue;
      }
      const maxSize = isAudioFile(file) ? MAX_AUDIO_SIZE_BYTES : MAX_FILE_SIZE_BYTES;
      const maxSizeMB = isAudioFile(file) ? MAX_AUDIO_SIZE_MB : MAX_FILE_SIZE_MB;
      if (file.size > maxSize) {
        setError(`File ${file.name} exceeds ${maxSizeMB} MB${isAudioFile(file) ? " (audio limit)" : ""}.`);
        continue;
      }
      const id = `${file.name}-${file.size}-${Date.now()}-${i}`;
      added.push({
        id,
        file,
        name: file.name,
        size: file.size,
      });
      if (isAudioFile(file)) {
        getAudioDurationInBrowser(file)
          .then((duration) => {
            setFiles((prev) =>
              prev.map((f) => (f.id === id ? { ...f, durationSeconds: duration } : f))
            );
          })
          .catch(() => {});
      }
    }
    setFiles((prev) => [...prev, ...added]);
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    if (summary?.fileId === id) setSummary(null);
    setError(null);
  }, [summary?.fileId]);

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

  const pauseSummarize = useCallback(async () => {
    summarizeAbortRef.current?.abort();
    if (currentSummarizeJobId) {
      try {
        await fetch(`/api/summary-jobs/${currentSummarizeJobId}/cancel`, {
          method: "POST",
          credentials: "include",
        });
        fetchHistory();
      } catch {
        // Ignore
      }
    }
    setCurrentSummarizeJobId(null);
  }, [currentSummarizeJobId, fetchHistory]);

  const abortSummarize = useCallback(async () => {
    summarizeAbortRef.current?.abort();
    if (currentSummarizeJobId) {
      try {
        await fetch(`/api/summary-jobs/${currentSummarizeJobId}/cancel`, {
          method: "POST",
          credentials: "include",
        });
        fetchHistory();
      } catch {
        // Ignore
      }
    }
    setCurrentSummarizeJobId(null);
  }, [currentSummarizeJobId, fetchHistory]);

  const handleSummarize = useCallback(
    async (item: FileItem) => {
      const key = groqApiKey.trim();
      if (!key) {
        setError("Masukkan Groq API key terlebih dahulu. Dapatkan di console.groq.com");
        return;
      }
      setError(null);
      setCurrentSummarizeJobId(null);
      setSummarizeLoading(item.id);
      setSummarizeProgress({ phase: "extracting", current: 0, total: 1 });
      setEstimatedSeconds(
        isAudioFile(item.file)
          ? estimateAudioTranscribeSeconds(item.durationSeconds, item.size)
          : estimateSummarizeSeconds(item.size)
      );

      const controller = new AbortController();
      summarizeAbortRef.current = controller;
      const startTime = Date.now();

      try {
        const formData = new FormData();
        formData.append("file", item.file);
        formData.append("groqApiKey", key);
        const res = await fetch("/api/summarize", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Summarize failed: ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line) as {
                type?: string;
                jobId?: string;
                phase?: string;
                current?: number;
                total?: number;
                text?: string;
                message?: string;
                step?: number;
                stepLabel?: string;
              };
              if (data.type === "job" && data.jobId) {
                setCurrentSummarizeJobId(data.jobId);
              } else if (data.type === "progress") {
                setSummarizeProgress({
                  phase: data.phase ?? "processing",
                  current: data.current ?? 0,
                  total: data.total ?? 1,
                  message: data.message,
                  step: data.step,
                  stepLabel: data.stepLabel,
                });
              } else if (data.type === "summary") {
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                setSummary({
                  fileId: item.id,
                  fileName: item.name,
                  text: sanitizeSummaryText(data.text ?? ""),
                  elapsedSeconds: elapsed,
                });
                fetchHistory();
              } else if (data.type === "waiting_rate_limit") {
                fetchHistory();
                setError(null);
                setSummarizeLoading(null);
                setSummarizeProgress(null);
                return;
              } else if (data.type === "error") {
                throw new Error(data.message ?? "Summarization failed.");
              }
            } catch (parseErr) {
              if (parseErr instanceof SyntaxError) continue;
              throw parseErr;
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          setError("Dibatalkan.");
        } else {
          setError(toUserFriendlyError(err instanceof Error ? err.message : "Summarize failed."));
        }
      } finally {
        setSummarizeLoading(null);
        setSummarizeProgress(null);
        setEstimatedSeconds(null);
        setCurrentSummarizeJobId(null);
        summarizeAbortRef.current = null;
      }
    },
    [groqApiKey, fetchHistory]
  );

  const copySummary = useCallback(() => {
    if (!summary?.text) return;
    navigator.clipboard.writeText(summary.text);
  }, [summary?.text]);

  const exportToPdf = useCallback(async () => {
    if (!summary?.text) return;

    const dateStr = new Date().toLocaleString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const content = prepareContentForPdf(summary.text);
    const baseName =
      summary.fileName?.replace(/\.[^.]+$/, "") ?? "document";
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
      const metaLines = doc.splitTextToSize(
        `Dokumen: ${summary.fileName ?? "—"}\nTanggal dibuat: ${dateStr}`,
        maxWidth
      );
      for (const line of metaLines) {
        doc.text(line, margin, y);
        y += lineHeight;
      }
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
  }, [summary?.text, summary?.fileName]);

  const copyHistoryJob = useCallback((text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
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
        const metaLines = doc.splitTextToSize(
          `Dokumen: ${filename ?? "—"}\nTanggal dibuat: ${dateStr}`,
          maxWidth
        );
        for (const line of metaLines) {
          doc.text(line, margin, y);
          y += lineHeight;
        }
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
    []
  );

  const deleteHistoryJob = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/summary-jobs/${jobId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete");
      setHistoryJobs((prev) => prev.filter((j) => j.id !== jobId));
      if (viewingJobId === jobId) setViewingJobId(null);
    } catch {
      setError("Gagal menghapus. Coba lagi.");
    }
  }, [viewingJobId]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <main className="min-h-screen bg-kemenkum-blue py-8 px-4 flex justify-center items-center overflow-y-auto">
      <div className="w-full max-w-2xl bg-white rounded-lg shadow-lg px-4 sm:px-8 pt-4 pb-10 mx-auto overflow-x-hidden text-center">
        {user && (
          <div className="flex items-center justify-between gap-3 mb-6">
            <span className="text-base text-kemenkum-blue font-medium truncate">{user.email}</span>
            <button
              type="button"
              onClick={logout}
              title="Logout"
              className="p-2 rounded-lg text-kemenkum-blue hover:opacity-80 shrink-0"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        )}
        <div className="flex items-center justify-center gap-3 mb-2">
          <Image src={kemenkumLogo} alt="Kemenkum" width={48} height={48} />
          <h1 className="text-2xl font-bold text-kemenkum-blue">Kemenkum Summarizer</h1>
        </div>
        <p className="text-gray-600 mb-6">
          Unggah dokumen (PDF, DOCX, TXT, RTF, ODT, SRT) atau audio (MP3, WAV, M4A) untuk diringkas.
        </p>

        <div className="w-full max-w-md mx-auto mb-6 text-left">
          <label htmlFor="groq-api-key" className="block text-sm font-medium text-gray-700 mb-1">
            Groq API Key <span className="text-gray-500">(disimpan 1 jam)</span>
          </label>
          <input
            id="groq-api-key"
            type="password"
            value={groqApiKey}
            onChange={(e) => setGroqApiKey(e.target.value)}
            placeholder="gsk_..."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue"
          />
          <p className="mt-1 text-xs text-gray-500">
            Dapatkan kunci gratis di{" "}
            <a
              href="https://console.groq.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-kemenkum-blue hover:underline"
            >
              console.groq.com
            </a>
          </p>
        </div>

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
            atau jatuhkan file di sini (PDF, DOCX, TXT, RTF, ODT, SRT, MP3, WAV, M4A)
          </p>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm text-center" role="alert">
            {error}
          </div>
        )}

        {resumeLoading && resumeProgress && (() => {
          const resumingJob = historyJobs.find((j) => j.id === resumeLoading);
          if (!resumingJob) return null;
          return (
            <section ref={resumeCardRef} className="mt-8 text-center min-w-0">
              <h2 className="text-base font-semibold text-kemenkum-blue mb-3">Melanjutkan Rangkuman</h2>
              <div className="flex flex-col gap-3 p-3 rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <div className="min-w-0 flex-1 text-center sm:text-left">
                    <p className="font-medium text-gray-900 truncate">{resumingJob.filename}</p>
                    <p className="text-xs text-gray-500">Dari Riwayat Unggahan</p>
                  </div>
                </div>
                <div className="text-left">
                  <p className="text-xs text-slate-600 mb-0.5">
                    {resumeProgress.message ?? "Melanjutkan…"}
                  </p>
                  <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-kemenkum-blue animate-pulse" style={{ width: "60%" }} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 justify-end min-w-0">
                  <button
                    type="button"
                    onClick={pauseResume}
                    className="px-4 py-2 rounded-lg border border-amber-300 text-amber-700 text-sm font-medium hover:bg-amber-50 whitespace-nowrap"
                  >
                    Jeda
                  </button>
                  <button
                    type="button"
                    onClick={abortResume}
                    className="px-4 py-2 rounded-lg border border-rose-300 text-rose-700 text-sm font-medium hover:bg-rose-50 whitespace-nowrap"
                  >
                    Batalkan
                  </button>
                </div>
              </div>
            </section>
          );
        })()}

        {files.length > 0 && (
          <section className="mt-8 text-center min-w-0">
            <h2 className="text-base font-semibold text-kemenkum-blue mb-3">Files</h2>
            <ul className="space-y-3 min-w-0">
              {files.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-col gap-3 p-3 rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden"
                >
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <div className="min-w-0 flex-1 text-center sm:text-left">
                      <p className="font-medium text-gray-900 truncate">{item.name}</p>
                      <p className="text-sm text-gray-500">{formatSize(item.size)}</p>
                    </div>
                  </div>
                  {summarizeLoading === item.id && summarizeProgress && (
                    <div className="w-full min-w-0">
                        {isAudioFile(item.file) ? (
                          <div className="p-4 rounded-xl bg-gradient-to-br from-slate-50 to-blue-50 border border-slate-200">
                            <div className="flex items-center gap-3 mb-3">
                              <div className="w-10 h-10 rounded-full bg-kemenkum-blue/20 flex items-center justify-center animate-pulse">
                                <span className="text-xl" aria-hidden>🎙️</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-slate-800 truncate">
                                  {summarizeProgress.message ?? "Memproses audio…"}
                                </p>
                                <p className="text-xs text-slate-500">
                                  Langkah {summarizeProgress.step ?? 1}/2 • {formatElapsedTime(elapsedSeconds)}
                                </p>
                              </div>
                            </div>
                            <div className="flex gap-2 mb-2">
                              {["Transkripsi", "Rangkuman"].map((label, i) => {
                                const stepNum = i + 1;
                                const isDone = (summarizeProgress.step ?? 1) > stepNum;
                                const isActive = (summarizeProgress.step ?? 1) === stepNum;
                                return (
                                  <span
                                    key={label}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                                      isDone
                                        ? "bg-emerald-100 text-emerald-800"
                                        : isActive
                                          ? "bg-kemenkum-blue/20 text-kemenkum-blue ring-1 ring-kemenkum-blue/30"
                                          : "bg-slate-100 text-slate-500"
                                    }`}
                                  >
                                    {stepNum}. {label}
                                    {isDone && " ✓"}
                                  </span>
                                );
                              })}
                            </div>
                            <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-kemenkum-blue transition-all duration-300"
                                style={{
                                  width: `${Math.min(
                                    100,
                                    (summarizeProgress.current / Math.max(1, summarizeProgress.total)) * 100
                                  )}%`,
                                }}
                              />
                            </div>
                            {estimatedSeconds != null && (
                              <p className="text-xs text-slate-500 mt-2 italic">
                                Estimasi: ~
                                {estimatedSeconds < 60
                                  ? `${estimatedSeconds} detik`
                                  : `${Math.ceil(estimatedSeconds / 60)} menit`}
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="text-left">
                            <p className="text-xs text-slate-600 mb-0.5">
                              {summarizeProgress.message ??
                                (summarizeProgress.phase === "extracting"
                                  ? "Mengekstrak teks…"
                                  : summarizeProgress.phase === "transcribing"
                                    ? "Mentranskripsi audio…"
                                    : summarizeProgress.phase === "chunks"
                                      ? `Bagian ${summarizeProgress.current} dari ${summarizeProgress.total}`
                                      : summarizeProgress.phase === "merge"
                                        ? "Menggabungkan rangkuman…"
                                        : "Merangkum…")}
                            </p>
                            <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-kemenkum-blue transition-all duration-300"
                                style={{
                                  width: `${Math.min(
                                    100,
                                    (summarizeProgress.current / Math.max(1, summarizeProgress.total)) * 100
                                  )}%`,
                                }}
                              />
                            </div>
                            {estimatedSeconds && (
                              <p className="text-xs text-slate-500 mt-0.5">
                                Estimasi: ~
                                {estimatedSeconds < 60
                                  ? `${estimatedSeconds} detik`
                                  : `${Math.ceil(estimatedSeconds / 60)} menit`}
                              </p>
                            )}
                          </div>
                        )}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 justify-end min-w-0">
                    <button
                      type="button"
                      onClick={() => handleSummarize(item)}
                      disabled={!!summarizeLoading}
                      className="px-4 py-2 rounded-lg bg-kemenkum-blue text-white text-sm font-medium hover:opacity-90 disabled:opacity-60 whitespace-nowrap"
                    >
                      {summarizeLoading === item.id ? "Summarizing…" : "Summarize"}
                    </button>
                    {summarizeLoading === item.id && (
                      <>
                        <button
                          type="button"
                          onClick={pauseSummarize}
                          className="px-4 py-2 rounded-lg border border-amber-300 text-amber-700 text-sm font-medium hover:bg-amber-50 whitespace-nowrap"
                        >
                          Jeda
                        </button>
                        <button
                          type="button"
                          onClick={abortSummarize}
                          className="px-4 py-2 rounded-lg border border-rose-300 text-rose-700 text-sm font-medium hover:bg-rose-50 whitespace-nowrap"
                        >
                          Batalkan
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => removeFile(item.id)}
                      className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:border-red-400 hover:text-red-600 hover:bg-red-50 flex-shrink-0"
                      title="Remove"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
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
            {summary.elapsedSeconds != null && (
              <p className="text-sm text-gray-500 mb-2 text-left">
                Proses selesai dalam {formatElapsedTime(summary.elapsedSeconds ?? 0)}.
              </p>
            )}
            <div className="w-full p-4 rounded-lg border border-gray-200 bg-gray-50 text-gray-900 text-left min-h-[200px] max-h-[400px] overflow-y-auto [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-2 [&_h1]:mb-1 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-base [&_h3]:font-medium [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-2 [&_li]:mb-0.5 [&_strong]:font-semibold">
              <ReactMarkdown>{ensureBlankLineAfterSections(summary.text)}</ReactMarkdown>
            </div>
          </section>
        )}

        {user && (
          <section className="mt-8 text-center">
            <button
              type="button"
              onClick={() => setHistoryExpanded(!historyExpanded)}
              className="flex items-center justify-start gap-2 w-full py-2 text-base font-semibold text-kemenkum-blue rounded-lg"
            >
              <span>{historyExpanded ? "▼" : "▶"}</span>
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
                                  onClick={() => handleResumeJob(job)}
                                  disabled={!!resumeLoading}
                                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
                                >
                                  {resumeLoading === job.id ? "Melanjutkan…" : "Lanjutkan"}
                                </button>
                                {resumeLoading === job.id && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={pauseResume}
                                      className="px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 text-sm font-medium hover:bg-amber-50"
                                    >
                                      Jeda
                                    </button>
                                    <button
                                      type="button"
                                      onClick={abortResume}
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
                                  onClick={() => copyHistoryJob(job.summaryText!)}
                                  className="px-3 py-1.5 rounded-lg bg-kemenkum-yellow text-kemenkum-blue text-sm font-medium hover:opacity-90"
                                >
                                  Copy
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
          </section>
        )}

      </div>
    </main>
  );
}

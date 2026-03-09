"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

import kemenkumLogo from "@/assets/kemenkum_logo.png";

const GROQ_API_KEY_CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour
const GROQ_API_KEY_CACHE_KEY = "groqApiKeyCache";
const HF_TOKEN_CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour
const HF_TOKEN_CACHE_KEY = "hfTokenCache";

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
};

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

function loadCachedHfToken(): string {
  if (typeof window === "undefined") return "";
  try {
    const stored = localStorage.getItem(HF_TOKEN_CACHE_KEY);
    if (!stored) return "";
    const { key, expiresAt } = JSON.parse(stored) as { key?: string; expiresAt?: number };
    if (key && expiresAt && Date.now() < expiresAt) return key;
    localStorage.removeItem(HF_TOKEN_CACHE_KEY);
  } catch {
    localStorage.removeItem(HF_TOKEN_CACHE_KEY);
  }
  return "";
}

function saveHfTokenToCache(key: string) {
  if (typeof window === "undefined" || !key.trim()) return;
  const cache = { key: key.trim(), expiresAt: Date.now() + HF_TOKEN_CACHE_DURATION_MS };
  localStorage.setItem(HF_TOKEN_CACHE_KEY, JSON.stringify(cache));
}

/** Rough estimate: ~45s per 50KB, minimum 30s */
function estimateSummarizeSeconds(fileSizeBytes: number): number {
  return Math.max(30, Math.ceil(fileSizeBytes / 50000) * 45);
}

/** Rough estimate for Groq Whisper + summarization: ~30–60s for 8 min audio (~8MB). ~7s per MB. */
function estimateAudioTranscribeSeconds(fileSizeBytes: number): number {
  const mb = fileSizeBytes / (1024 * 1024);
  return Math.max(30, Math.ceil(mb) * 7);
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

function formatProcessTime(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} minutes`;
  return `${(seconds / 3600).toFixed(1)} hours`;
}

const SEGMENTED_TIPS = [
  "Diarisasi dapat memakan waktu beberapa menit untuk audio panjang.",
  "Format label+opini: setiap pembicara/topik diikuti pendapat.",
  "Tanpa HF token, audio menggunakan Groq Whisper (tanpa label pembicara).",
  "Dokumen dengan struktur jelas lebih mudah dianalisis.",
];

/** Set to true to show Hugging Face token, Analisis Rapat, and Segmented Summarize. */
const SHOW_SEGMENTED_FEATURES = false;

export default function Home() {
  const [groqApiKey, setGroqApiKey] = useState("");
  const [hfToken, setHfToken] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
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
    setHfToken(loadCachedHfToken());
  }, []);

  useEffect(() => {
    if (groqApiKey.trim()) saveGroqApiKeyToCache(groqApiKey);
  }, [groqApiKey]);

  useEffect(() => {
    if (hfToken.trim()) saveHfTokenToCache(hfToken);
  }, [hfToken]);

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
  type MeetingParticipant = {
    speaker: string;
    agreement_confidence?: number;
    points?: Array<{ topic: string; stance: string; evidence?: string[] }>;
    risks?: Array<{ type: string; score: number; evidence?: string[] }>;
    summary?: string;
  };
  const [summary, setSummary] = useState<{
    fileId: string;
    fileName: string;
    text: string;
    diarized?: boolean;
    device?: string;
    elapsedSeconds?: number;
    analysis?: { leader?: { name: string; position: string }; participants: MeetingParticipant[] };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [segmentedLoading, setSegmentedLoading] = useState<string | null>(null);
  const [segmentedProgress, setSegmentedProgress] = useState<{
    step: number;
    stepLabel: string;
    message?: string;
  } | null>(null);
  const [segmentedElapsedSeconds, setSegmentedElapsedSeconds] = useState(0);
  const segmentedAbortRef = useRef<AbortController | null>(null);

  const [leaderName, setLeaderName] = useState("");
  const [leaderPosition, setLeaderPosition] = useState("");
  const [segmentedTipIndex, setSegmentedTipIndex] = useState(0);
  useEffect(() => {
    if (!segmentedLoading) return;
    const interval = setInterval(() => {
      setSegmentedTipIndex((i) => (i + 1) % SEGMENTED_TIPS.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [segmentedLoading]);

  useEffect(() => {
    if (!segmentedLoading) {
      setSegmentedElapsedSeconds(0);
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      setSegmentedElapsedSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [segmentedLoading]);

  const cancelSegmented = useCallback(() => {
    segmentedAbortRef.current?.abort();
  }, []);

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

  const cancelSummarize = useCallback(() => {
    summarizeAbortRef.current?.abort();
  }, []);

  const handleSummarize = useCallback(
    async (item: FileItem) => {
      const key = groqApiKey.trim();
      if (!key) {
        setError("Masukkan Groq API key terlebih dahulu. Dapatkan di console.groq.com");
        return;
      }
      setError(null);
      setSummarizeLoading(item.id);
      setSummarizeProgress({ phase: "extracting", current: 0, total: 1 });
      setEstimatedSeconds(
        isAudioFile(item.file)
          ? estimateAudioTranscribeSeconds(item.size)
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
                phase?: string;
                current?: number;
                total?: number;
                text?: string;
                message?: string;
                step?: number;
                stepLabel?: string;
              };
              if (data.type === "progress") {
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
          setError(err instanceof Error ? err.message : "Summarize failed.");
        }
      } finally {
        setSummarizeLoading(null);
        setSummarizeProgress(null);
        setEstimatedSeconds(null);
        summarizeAbortRef.current = null;
      }
    },
    [groqApiKey]
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

    /** Strip markdown for PDF output; preserve numbered list (1., 2., 3.). */
    const stripMarkdown = (s: string) =>
      s
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/\*(.+?)\*/g, "$1")
        .replace(/^#+\s*/gm, "")
        .replace(/^(\s*)[-*]\s+/gm, "$1• ");

    /** Fix overlapping: \r (carriage return) can cause overwriting; normalize to \n. */
    const sanitizeForPdf = (s: string) =>
      s
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
        .replace(/\n{3,}/g, "\n\n");

    const content = sanitizeForPdf(stripMarkdown(summary.text));
    const baseName =
      summary.fileName?.replace(/\.[^.]+$/, "") ?? "document";
    const fileName = `${baseName}-summary.pdf`;

    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const margin = 20;
      const maxWidth = 210 - margin * 2;
      const lineHeight = 6;
      const pageHeight = 297;
      const maxY = pageHeight - margin;

      let y = margin;

      const addText = (text: string, fontSize = 11) => {
        doc.setFontSize(fontSize);
        const lines = doc.splitTextToSize(text, maxWidth);
        for (const line of lines) {
          if (y > maxY) {
            doc.addPage();
            y = margin;
          }
          doc.text(line, margin, y);
          y += lineHeight;
        }
      };

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      addText(`Dokumen: ${summary.fileName ?? "—"}`, 10);
      addText(`Tanggal dibuat: ${dateStr}`, 10);
      y += 4;
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(11);
      addText(content);

      doc.save(fileName);
    } catch (err) {
      setError("Gagal mendownload PDF. Coba lagi.");
      console.error(err);
    }
  }, [summary?.text, summary?.fileName]);

  const handleSegmentedSummarize = useCallback(
    async (item: FileItem) => {
      const key = groqApiKey.trim();
      if (!key) {
        setError("Masukkan Groq API key terlebih dahulu. Dapatkan di console.groq.com");
        return;
      }
      setError(null);
      setSegmentedLoading(item.id);
      setSegmentedProgress({ step: 1, stepLabel: "Memulai…", message: "Mempersiapkan…" });

      const controller = new AbortController();
      segmentedAbortRef.current = controller;
      const startTime = Date.now();

      try {
        const formData = new FormData();
        formData.append("file", item.file);
        formData.append("groqApiKey", key);
        if (hfToken.trim()) {
          formData.append("hfToken", hfToken.trim());
        }
        if (leaderName.trim()) {
          formData.append("leaderName", leaderName.trim());
          formData.append("leaderPosition", leaderPosition.trim());
        }
        const res = await fetch("/api/summarize-segmented", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const text = await res.text();
          let errMsg = `Segmented summarize failed: ${res.status}`;
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
                message?: string;
                text?: string;
                diarized?: boolean;
                device?: string;
                analysis?: { leader?: { name: string; position: string }; participants: MeetingParticipant[] };
              };
              if (data.type === "progress") {
                setSegmentedProgress({
                  step: data.step ?? 1,
                  stepLabel: data.stepLabel ?? "",
                  message: data.message,
                });
              } else if (data.type === "summary") {
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                setSummary({
                  fileId: item.id,
                  fileName: item.name,
                  text: sanitizeSummaryText(data.text ?? ""),
                  diarized: data.diarized,
                  device: data.device,
                  elapsedSeconds: elapsed,
                });
              } else if (data.type === "analysis") {
                setSummary((prev) =>
                  prev ? { ...prev, analysis: data.analysis } : prev
                );
              } else if (data.type === "error") {
                throw new Error(data.message ?? "Segmented summarization failed.");
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
        } else if (err instanceof Error && /fetch|network|connection|timeout/i.test(err.message)) {
          setError("Koneksi terputus atau waktu habis. Coba lagi atau gunakan file audio yang lebih pendek.");
        } else {
          setError(err instanceof Error ? err.message : "Segmented summarization failed.");
        }
      } finally {
        setSegmentedLoading(null);
        setSegmentedProgress(null);
        segmentedAbortRef.current = null;
      }
    },
    [groqApiKey, hfToken, leaderName, leaderPosition]
  );

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <main className="min-h-screen bg-kemenkum-blue py-8 px-4 flex justify-center items-center overflow-y-auto">
      <div className="w-full max-w-2xl bg-white rounded-lg shadow-lg px-4 sm:px-8 py-10 mx-auto overflow-x-hidden text-center">
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

        {SHOW_SEGMENTED_FEATURES && (
          <div className="w-full max-w-md mx-auto mb-6 text-left">
            <label htmlFor="hf-token" className="block text-sm font-medium text-gray-700 mb-1">
              Hugging Face Token <span className="text-gray-500">(opsional, disimpan 1 jam)</span>
            </label>
            <input
              id="hf-token"
              type="password"
              value={hfToken}
              onChange={(e) => setHfToken(e.target.value)}
              placeholder="hf_..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue"
            />
            <p className="mt-1 text-xs text-gray-500">
              Untuk Segmented Summarize pada audio: klasifikasi pembicara via pyannote. Tanpa token: Groq Whisper (tanpa label pembicara).{" "}
              <a
                href="https://huggingface.co/pyannote/speaker-diarization-3.1"
                target="_blank"
                rel="noopener noreferrer"
                className="text-kemenkum-blue hover:underline"
              >
                Terima lisensi pyannote
              </a>
            </p>
          </div>
        )}

        {SHOW_SEGMENTED_FEATURES && (
          <div className="w-full max-w-md mx-auto mb-6 text-left">
          <p className="block text-sm font-medium text-gray-700 mb-2">
            Analisis Rapat <span className="text-gray-500">(opsional, untuk Segmented Summarize)</span>
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="leader-name" className="block text-xs text-gray-500 mb-0.5">Nama Anda (leader)</label>
              <input
                id="leader-name"
                type="text"
                value={leaderName}
                onChange={(e) => setLeaderName(e.target.value)}
                placeholder="Contoh: Budi"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue text-sm"
              />
            </div>
            <div>
              <label htmlFor="leader-position" className="block text-xs text-gray-500 mb-0.5">Jabatan</label>
              <input
                id="leader-position"
                type="text"
                value={leaderPosition}
                onChange={(e) => setLeaderPosition(e.target.value)}
                placeholder="Contoh: Manajer Proyek"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue text-sm"
              />
            </div>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Jika diisi, Segmented Summarize akan menambahkan analisis stances (support/oppose/mixed), confidence score, dan bukti (evidence) per peserta.
          </p>
        </div>
        )}

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
                                  Langkah {summarizeProgress.step ?? 1}/2 • {elapsedSeconds}s
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
                  {SHOW_SEGMENTED_FEATURES && segmentedLoading === item.id && segmentedProgress && (
                    <div className="w-full min-w-0">
                      <div className="p-4 rounded-xl bg-gradient-to-br from-slate-50 to-blue-50 border border-slate-200">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-10 h-10 rounded-full bg-kemenkum-blue/20 flex items-center justify-center animate-pulse">
                            <span className="text-xl" aria-hidden>📋</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-slate-800 truncate">
                              {segmentedProgress.message ?? "Memproses segmented…"}
                            </p>
                            <p className="text-xs text-slate-500">
                              Langkah {segmentedProgress.step}/{leaderName.trim() ? 4 : 3} • {segmentedElapsedSeconds}s
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2 mb-2 flex-wrap">
                          {(leaderName.trim()
                            ? ["Ekstraksi", "Cek format", "Rangkuman", "Analisis rapat"]
                            : ["Ekstraksi", "Cek format", "Rangkuman"]
                          ).map((label, i) => {
                            const stepNum = i + 1;
                            const isDone = (segmentedProgress.step ?? 1) > stepNum;
                            const isActive = (segmentedProgress.step ?? 1) === stepNum;
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
                              width: `${Math.min(100, ((segmentedProgress.step ?? 1) / (leaderName.trim() ? 4 : 3)) * 100)}%`,
                            }}
                          />
                        </div>
                        <p className="text-xs text-slate-500 mt-2 italic">
                          {segmentedProgress.step === 1 && "Mengekstrak teks atau mengidentifikasi pembicara…"}
                          {segmentedProgress.step === 2 && "Memeriksa apakah teks memiliki format label dan opini…"}
                          {segmentedProgress.step === 3 && "Merangkum setiap segmen secara terpisah…"}
                          {segmentedProgress.step === 4 && "Menganalisis stances dan risiko alignment…"}
                        </p>
                        <p className="text-xs text-slate-600 mt-1.5 flex items-start gap-1.5">
                          <span className="text-amber-500 shrink-0" aria-hidden>💡</span>
                          <span>{SEGMENTED_TIPS[segmentedTipIndex]}</span>
                        </p>
                      </div>
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
                      <button
                        type="button"
                        onClick={cancelSummarize}
                        className="px-4 py-2 rounded-lg border border-rose-300 text-rose-700 text-sm font-medium hover:bg-rose-50 whitespace-nowrap"
                      >
                        Batalkan
                      </button>
                    )}
                    {SHOW_SEGMENTED_FEATURES && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSegmentedSummarize(item)}
                          disabled={!!segmentedLoading}
                          className="px-4 py-2 rounded-lg border border-kemenkum-blue text-kemenkum-blue bg-white text-sm font-medium hover:bg-kemenkum-blue/5 disabled:opacity-60 whitespace-nowrap"
                        >
                          {segmentedLoading === item.id ? "Processing…" : "Segmented Summarize"}
                        </button>
                        {segmentedLoading === item.id && (
                          <button
                            type="button"
                            onClick={cancelSegmented}
                            className="px-4 py-2 rounded-lg border border-rose-300 text-rose-700 text-sm font-medium hover:bg-rose-50 whitespace-nowrap"
                          >
                            Batalkan
                          </button>
                        )}
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
                Proses selesai dalam {formatProcessTime(summary.elapsedSeconds)}.
              </p>
            )}
            {summary.diarized !== undefined && (
              <p className="text-sm text-gray-600 mb-2 text-left">
                {summary.diarized
                  ? `Menggunakan pyannote (diarisasi pembicara). Rangkuman per pembicara.${summary.device ? ` [${summary.device === "cuda" ? "GPU (CUDA)" : "CPU"}]` : ""}`
                  : "Menggunakan Groq Whisper (tanpa label pembicara). Rangkuman mungkin berdasarkan topik."}
              </p>
            )}
            {summary.analysis && (
              <div className="w-full mb-4 p-4 rounded-lg border border-kemenkum-blue/30 bg-blue-50/50 text-gray-900 text-left overflow-y-auto max-h-[400px]">
                <h3 className="text-base font-semibold text-kemenkum-blue mb-3">Analisis Rapat</h3>
                {summary.analysis.leader && (
                  <p className="text-sm text-gray-600 mb-3">
                    Leader: <strong>{summary.analysis.leader.name}</strong>
                    {summary.analysis.leader.position && ` (${summary.analysis.leader.position})`}
                  </p>
                )}
                <div className="space-y-4">
                  {summary.analysis.participants.map((p) => (
                    <div key={p.speaker} className="border border-gray-200 rounded-lg p-3 bg-white">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-gray-900">{p.speaker}</span>
                        {p.agreement_confidence != null && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded ${
                              p.agreement_confidence >= 4
                                ? "bg-emerald-100 text-emerald-800"
                                : p.agreement_confidence <= 2
                                  ? "bg-rose-100 text-rose-800"
                                  : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            Confidence: {p.agreement_confidence}/5
                          </span>
                        )}
                      </div>
                      {p.summary && (
                        <p className="text-sm text-gray-600 mb-2">{p.summary}</p>
                      )}
                      {p.points && p.points.length > 0 && (
                        <div className="mb-2">
                          <p className="text-xs font-medium text-gray-500 mb-1">Poin:</p>
                          <ul className="text-sm space-y-1">
                            {p.points.map((pt, i) => (
                              <li key={i}>
                                <span
                                  className={`inline-block px-1.5 py-0.5 rounded text-xs mr-1 ${
                                    pt.stance === "support"
                                      ? "bg-emerald-100 text-emerald-800"
                                      : pt.stance === "oppose"
                                        ? "bg-rose-100 text-rose-800"
                                        : "bg-amber-100 text-amber-800"
                                  }`}
                                >
                                  {pt.stance}
                                </span>
                                {pt.topic}
                                {pt.evidence && pt.evidence.length > 0 && (
                                  <span className="text-gray-500 text-xs block mt-0.5">
                                    Bukti: &quot;{pt.evidence[0]}
                                    {pt.evidence.length > 1 ? `" +${pt.evidence.length - 1}` : '"'}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {p.risks && p.risks.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-gray-500 mb-1">Risiko:</p>
                          <ul className="text-sm space-y-1">
                            {p.risks.map((r, i) => (
                              <li key={i}>
                                <span className="text-rose-600 font-medium">{r.type}</span>
                                <span className="text-gray-500 text-xs"> (score: {r.score.toFixed(1)})</span>
                                {r.evidence && r.evidence[0] && (
                                  <span className="text-gray-500 text-xs block">
                                    &quot;{r.evidence[0]}&quot;
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="w-full p-4 rounded-lg border border-gray-200 bg-gray-50 text-gray-900 text-left min-h-[200px] max-h-[400px] overflow-y-auto [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-2 [&_h1]:mb-1 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-base [&_h3]:font-medium [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-2 [&_li]:mb-0.5 [&_strong]:font-semibold">
              <ReactMarkdown>{summary.text}</ReactMarkdown>
            </div>
          </section>
        )}

      </div>
    </main>
  );
}

"use client";

import Image from "next/image";
import { useCallback, useState } from "react";

import kemenkumLogo from "@/assets/kemenkum_logo.png";

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
    setCompressedSizes((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setError(null);
  }, [summary?.fileId, compressSuccess]);

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

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <main className="min-h-screen bg-kemenkum-blue py-8 px-4 flex justify-center items-center overflow-y-auto">
      <div className="max-w-2xl w-full bg-white rounded-lg shadow-lg px-8 py-10 text-center mx-auto">
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
      </div>
    </main>
  );
}

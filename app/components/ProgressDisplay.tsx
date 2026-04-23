"use client";

import type { SummarizeProgress } from "@/app/hooks/useSummarize";
import { isAudioFile } from "@/app/components/FileUpload";

type ProgressDisplayProps = {
  file: File;
  progress: SummarizeProgress;
};

export function ProgressDisplay({ file, progress }: ProgressDisplayProps) {
  if (isAudioFile(file)) {
    return (
      <div className="p-4 rounded-xl bg-gradient-to-br from-slate-50 to-blue-50 border border-slate-200">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-kemenkum-blue/20 flex items-center justify-center animate-pulse">
            <span className="text-xl" aria-hidden>🎙️</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-slate-800 truncate">
              {progress.message ?? "Memproses audio…"}
            </p>
            <p className="text-xs text-slate-500">Langkah {progress.step ?? 1}/2</p>
          </div>
        </div>
        <div className="flex gap-2 mb-2">
          {["Transkripsi", "Rangkuman"].map((label, i) => {
            const stepNum = i + 1;
            const isDone = (progress.step ?? 1) > stepNum;
            const isActive = (progress.step ?? 1) === stepNum;
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
                (progress.current / Math.max(1, progress.total)) * 100
              )}%`,
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="text-left">
      <p className="text-xs text-slate-600 mb-0.5">
        {progress.message ??
          (progress.phase === "extracting"
            ? "Mengekstrak teks…"
            : progress.phase === "transcribing"
              ? "Mentranskripsi audio…"
              : progress.phase === "chunks"
                ? `Bagian ${progress.current} dari ${progress.total}`
                : progress.phase === "merge"
                  ? "Menggabungkan rangkuman…"
                  : "Merangkum…")}
      </p>
      <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-kemenkum-blue transition-all duration-300"
          style={{
            width: `${Math.min(
              100,
              (progress.current / Math.max(1, progress.total)) * 100
            )}%`,
          }}
        />
      </div>
    </div>
  );
}

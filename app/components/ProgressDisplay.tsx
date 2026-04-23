"use client";

import type { SummarizeProgress } from "@/app/hooks/useSummarize";
import { formatSize } from "@/app/components/FileUpload";
import { formatElapsedTime } from "@/lib/format-time";

type ProgressDisplayProps = {
  file: File;
  progress: SummarizeProgress;
  elapsedSeconds: number;
};

function activePhaseTab(phase: string): 1 | 2 | 3 {
  if (phase === "extracting" || phase === "transcribing") return 1;
  if (phase === "merge") return 3;
  if (phase === "summarizing" || phase === "chunks") return 2;
  return 2;
}

const PHASE_TABS = [
  { num: 1, label: "Transkripsi" },
  { num: 2, label: "Merangkum" },
  { num: 3, label: "Finalisasi" },
] as const;

const secondaryTextStyle = {
  fontSize: 13,
  color: "var(--color-text-secondary, #64748b)",
} as const;

function displayMessage(progress: SummarizeProgress): string {
  if (progress.message?.trim()) return progress.message;
  if (progress.phase === "extracting") return "Mengekstrak teks…";
  if (progress.phase === "transcribing") return "Mentranskripsi audio…";
  if (progress.phase === "chunks")
    return `Bagian ${progress.current} dari ${progress.total}`;
  if (progress.phase === "merge") return "Menggabungkan rangkuman…";
  return "Merangkum…";
}

export function ProgressDisplay({ file, progress, elapsedSeconds }: ProgressDisplayProps) {
  const active = activePhaseTab(progress.phase);
  return (
    <div className="p-4 rounded-xl bg-gradient-to-br from-slate-50 to-blue-50 border border-slate-200 min-w-0">
      <div className="flex items-baseline justify-between gap-2 min-w-0 mb-3">
        <p className="font-medium text-slate-900 truncate min-w-0 text-left">{file.name}</p>
        <p className="shrink-0 text-sm text-slate-600 tabular-nums">{formatSize(file.size)}</p>
      </div>

      <div className="flex flex-wrap mb-3" style={{ gap: 8 }}>
        {PHASE_TABS.map(({ num, label }) => {
          const isDone = num < active;
          const isActive = num === active;
          return (
            <span
              key={num}
              className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? "bg-kemenkum-blue/20 text-kemenkum-blue ring-1 ring-kemenkum-blue/30"
                  : isDone
                    ? "bg-emerald-100 text-emerald-800"
                    : "text-slate-500"
              }`}
            >
              {num}. {label}
              {isDone && " ✓"}
            </span>
          );
        })}
      </div>

      <div className="w-full h-[5px] bg-slate-200 rounded-full overflow-hidden mb-2">
        <div
          className="h-full min-w-0 rounded-full bg-kemenkum-blue transition-all duration-300"
          style={{
            width: `${Math.min(
              100,
              (progress.current / Math.max(1, progress.total)) * 100
            )}%`,
          }}
        />
      </div>

      <div className="flex justify-between items-baseline gap-2 min-w-0">
        <p className="min-w-0 flex-1 truncate text-left" style={secondaryTextStyle}>
          {displayMessage(progress)}
        </p>
        <p className="shrink-0 tabular-nums" style={secondaryTextStyle}>
          {formatElapsedTime(elapsedSeconds)}
        </p>
      </div>
    </div>
  );
}

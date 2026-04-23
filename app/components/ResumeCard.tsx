"use client";

import { forwardRef } from "react";
import { ProgressDisplay } from "@/app/components/ProgressDisplay";
import type { SummarizeProgress } from "@/app/hooks/useSummarize";
import type { SummaryJobItem } from "@/app/hooks/useHistory";

function syntheticFileFromHistoryJob(filename: string, fileType: string): File {
  const mime =
    fileType === "pdf"
      ? "application/pdf"
      : fileType === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "audio/mpeg";
  return new File([], filename, { type: mime });
}

export type ResumeCardProps = {
  job: SummaryJobItem;
  progress: SummarizeProgress;
  elapsedSeconds: number;
  onPause: () => void;
  onAbort: () => void;
};

export const ResumeCard = forwardRef<HTMLElement, ResumeCardProps>(function ResumeCard(
  { job, progress, elapsedSeconds, onPause, onAbort },
  ref
) {
  return (
    <section ref={ref} className="mt-8 text-center min-w-0">
      <div className="flex flex-col gap-3 p-3 rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="font-medium text-gray-900 truncate">{job.filename}</p>
            <p className="text-sm text-gray-500">Dari Riwayat Unggahan</p>
          </div>
        </div>
        <div className="w-full min-w-0">
          <ProgressDisplay
            file={syntheticFileFromHistoryJob(job.filename, job.fileType)}
            progress={progress}
            elapsedSeconds={elapsedSeconds}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end min-w-0">
          <button
            type="button"
            onClick={onPause}
            className="px-4 py-2 rounded-lg border border-amber-300 text-amber-700 text-sm font-medium hover:bg-amber-50 whitespace-nowrap"
          >
            Jeda
          </button>
          <button
            type="button"
            onClick={onAbort}
            className="px-4 py-2 rounded-lg border border-rose-300 text-rose-700 text-sm font-medium hover:bg-rose-50 whitespace-nowrap"
          >
            Batalkan
          </button>
        </div>
      </div>
    </section>
  );
});

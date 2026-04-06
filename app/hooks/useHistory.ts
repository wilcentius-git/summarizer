"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SummaryJobItem = {
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

export function useHistory(user: { id: string } | null) {
  const [historyJobs, setHistoryJobs] = useState<SummaryJobItem[]>([]);
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

  const hasFetched = useRef(false);
  useEffect(() => {
    if (user && !hasFetched.current) {
      hasFetched.current = true;
      void (async () => {
        try {
          const res = await fetch("/api/summary-jobs", { credentials: "include" });
          if (res.ok) {
            const data = await res.json();
            setHistoryJobs(data.jobs ?? []);
          }
        } catch {
          // Ignore initial fetch errors
        }
      })();
    }
  }, [user]);

  const deleteJob = useCallback(async (jobId: string) => {
    const res = await fetch(`/api/summary-jobs/${jobId}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) throw new Error("Failed to delete");
    setHistoryJobs((prev) => prev.filter((j) => j.id !== jobId));
  }, []);

  return { historyJobs, setHistoryJobs, fetchHistory, deleteJob };
}

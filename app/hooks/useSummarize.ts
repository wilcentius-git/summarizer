"use client";

import { useCallback, useRef, useState } from "react";
import type { FileItem } from "@/app/components/FileUpload";
import { useElapsedTimer } from "@/app/hooks/useElapsedTimer";
import type { SummaryJobItem } from "@/app/hooks/useHistory";
import { sanitizeMultilineText } from "@/lib/text-utils";

function toUserFriendlyError(msg: string): string {
  if (/41[23]/.test(msg)) return "You used up a per-minute quota.";
  if (/429/.test(msg)) return "Wait for the rate limit window to reset (usually 1 hour).";
  return msg;
}

function handleStreamError(
  err: unknown,
  isPausing: boolean,
  setError: (m: string | null) => void,
  fallbackMessage: string
) {
  if (err instanceof Error && err.name === "AbortError" && !isPausing) {
    setError("Dibatalkan.");
  } else if (!(err instanceof Error && err.name === "AbortError")) {
    setError(toUserFriendlyError(err instanceof Error ? err.message : fallbackMessage));
  }
}

export type SummarizeProgress = {
  phase: string;
  current: number;
  total: number;
  message?: string;
  step?: number;
  stepLabel?: string;
  /** Merge recursion depth (1-based); only set during phase "merge". */
  mergeRound?: number;
};

export function useSummarize(
  groqApiKey: string,
  fetchHistory: () => Promise<void>,
  setError: (err: string | null) => void,
  setSuccess: (msg: string | null) => void,
  onSuccessfulCompletion?: () => void
) {
  const [summarizeLoading, setSummarizeLoading] = useState<string | null>(null);
  const [summarizeProgress, setSummarizeProgress] = useState<SummarizeProgress | null>(null);
  const elapsedSeconds = useElapsedTimer(!!summarizeLoading);
  const [currentSummarizeJobId, setCurrentSummarizeJobId] = useState<string | null>(null);
  const [liveSourceText, setLiveSourceText] = useState<string>("");
  const summarizeAbortRef = useRef<AbortController | null>(null);

  const [resumeLoading, setResumeLoading] = useState<string | null>(null);
  const [resumeProgress, setResumeProgress] = useState<SummarizeProgress | null>(null);
  const resumeElapsedSeconds = useElapsedTimer(!!resumeLoading);
  const resumeAbortRef = useRef<AbortController | null>(null);
  const isPausingRef = useRef(false);

  const cancelSummarizeJob = useCallback(
    async (isPausing: boolean) => {
      if (isPausing) isPausingRef.current = true;
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
    },
    [currentSummarizeJobId, fetchHistory]
  );

  const pauseSummarize = useCallback(() => cancelSummarizeJob(true), [cancelSummarizeJob]);
  const abortSummarize = useCallback(() => cancelSummarizeJob(false), [cancelSummarizeJob]);

  const handleSummarize = useCallback(
    async (item: FileItem, glossary?: string) => {
      const key = groqApiKey.trim();
      setError(null);
      setCurrentSummarizeJobId(null);
      setLiveSourceText("");
      setSummarizeLoading(item.id);
      setSummarizeProgress({ phase: "extracting", current: 0, total: 1 });

      const controller = new AbortController();
      summarizeAbortRef.current = controller;

      try {
        const formData = new FormData();
        formData.append("file", item.file);
        if (key) {
          formData.append("groqApiKey", key);
        }
        if (glossary?.trim()) {
          formData.append("glossary", glossary.trim());
        }
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
                mergeRound?: number;
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
                  mergeRound: data.mergeRound,
                });
              } else if (data.type === "sourceText") {
                setLiveSourceText(sanitizeMultilineText(data.text ?? ""));
              } else if (data.type === "summary") {
                void fetchHistory().then(() => {
                  onSuccessfulCompletion?.();
                });
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
        handleStreamError(err, isPausingRef.current, setError, "Summarize failed.");
      } finally {
        isPausingRef.current = false;
        setSummarizeLoading(null);
        setSummarizeProgress(null);
        setCurrentSummarizeJobId(null);
        setLiveSourceText("");
        summarizeAbortRef.current = null;
        fetchHistory();
      }
    },
    [groqApiKey, fetchHistory, setError, onSuccessfulCompletion]
  );

  const cancelResumeJob = useCallback(
    async (isPausing: boolean) => {
      if (isPausing) isPausingRef.current = true;
      resumeAbortRef.current?.abort();
      if (resumeLoading) {
        try {
          await fetch(`/api/summary-jobs/${resumeLoading}/cancel`, {
            method: "POST",
            credentials: "include",
          });
          fetchHistory();
        } catch {
          // Ignore
        }
      }
    },
    [resumeLoading, fetchHistory]
  );

  const pauseResume = useCallback(() => cancelResumeJob(true), [cancelResumeJob]);
  const abortResume = useCallback(() => cancelResumeJob(false), [cancelResumeJob]);

  const handleResumeJob = useCallback(
    async (job: SummaryJobItem) => {
      const key = groqApiKey.trim();
      if (!job.isResumable) return;
      setError(null);
      setResumeLoading(job.id);
      setResumeProgress({
        message: "Melanjutkan…",
        phase: "transcribing",
        current: 0,
        total: 0,
        step: 1,
      });

      const controller = new AbortController();
      resumeAbortRef.current = controller;

      try {
        const res = await fetch(`/api/summary-jobs/${job.id}/resume`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(key ? { groqApiKey: key } : {}),
          signal: controller.signal,
          credentials: "include",
        });

        if (res.ok) {
          const contentType = res.headers.get("content-type") ?? "";
          if (contentType.includes("application/json") && !contentType.includes("ndjson")) {
            const data = (await res.json()) as { message?: string };
            if (data.message) {
              setSuccess(data.message);
              fetchHistory();
              return;
            }
          }
        }

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
                mergeRound?: number;
              };
              if (data.type === "progress") {
                const msg =
                  data.message ??
                  (data.phase === "chunks" && data.total != null
                    ? `Bagian ${data.current ?? 0} dari ${data.total}`
                    : data.phase === "merge"
                      ? "Menggabungkan rangkuman…"
                      : "Memproses…");
                setResumeProgress({
                  message: msg,
                  mergeRound: data.mergeRound,
                  phase: data.phase ?? "processing",
                  current: data.current ?? 0,
                  total: data.total ?? 0,
                  step: data.step,
                  stepLabel: data.stepLabel,
                });
              } else if (data.type === "summary") {
                void fetchHistory().then(() => {
                  onSuccessfulCompletion?.();
                });
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
        handleStreamError(err, isPausingRef.current, setError, "Resume failed.");
      } finally {
        isPausingRef.current = false;
        setResumeLoading(null);
        setResumeProgress(null);
        resumeAbortRef.current = null;
        fetchHistory();
      }
    },
    [groqApiKey, fetchHistory, setError, setSuccess, onSuccessfulCompletion]
  );

  return {
    summarizeLoading,
    summarizeProgress,
    liveSourceText,
    elapsedSeconds,
    resumeLoading,
    resumeProgress,
    resumeElapsedSeconds,
    handleSummarize,
    pauseSummarize,
    abortSummarize,
    handleResumeJob,
    pauseResume,
    abortResume,
  };
}

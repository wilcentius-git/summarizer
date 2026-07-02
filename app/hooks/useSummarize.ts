"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FileItem } from "@/app/components/FileUpload";
import { useAuth } from "@/app/contexts/AuthContext";
import { useElapsedTimer } from "@/app/hooks/useElapsedTimer";
import type { SummaryJobItem } from "@/app/hooks/useHistory";
import { sanitizeMultilineText } from "@/lib/text-utils";

const QUEUED_JOB_POLL_MS = 5000;

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

type PolledSummaryJob = {
  status: string;
  processedTranscribeChunks?: number;
  processedChunks?: number;
  totalChunks?: number | null;
  progressPercentage?: number;
  errorMessage?: string | null;
  summaryText?: string | null;
};

function progressFromPolledJob(job: PolledSummaryJob): SummarizeProgress {
  if (job.status === "waiting_rate_limit") {
    return {
      phase: "transcribing",
      current: 0,
      total: 1,
      message: "Menunggu rate limit Groq, akan dilanjutkan otomatis…",
      step: 1,
      stepLabel: "Transkripsi",
    };
  }
  if (job.status === "queued_transcription") {
    return {
      phase: "transcribing",
      current: 0,
      total: 1,
      message: "Mentranskripsi audio…",
      step: 1,
      stepLabel: "Transkripsi",
    };
  }
  if (job.status === "processing" && (job.progressPercentage ?? 0) < 30) {
    if ((job.processedTranscribeChunks ?? 0) === 0) {
      return {
        phase: "transcribing",
        current: 0,
        total: 1,
        message: "Mentranskripsi audio…",
        step: 1,
        stepLabel: "Transkripsi",
      };
    }
    const total = job.totalChunks ?? 1;
    const current = job.processedTranscribeChunks ?? 0;
    return {
      phase: "transcribing",
      current,
      total,
      message: `Transkripsi bagian ${current} dari ${total}…`,
      step: 1,
      stepLabel: "Transkripsi",
    };
  }
  if (job.status === "processing") {
    const total = job.totalChunks ?? 0;
    const current = job.processedChunks ?? 0;
    if (total > 0 && current < total) {
      return {
        phase: "chunks",
        current,
        total,
        message: `Merangkum bagian ${current + 1} dari ${total}…`,
        step: 2,
        stepLabel: "Rangkuman",
      };
    }
    if (total > 0 && current >= total) {
      return {
        phase: "merge",
        current: 1,
        total: 1,
        message: "Menggabungkan rangkuman…",
        step: 3,
        stepLabel: "Finalisasi",
      };
    }
    return {
      phase: "summarizing",
      current: 1,
      total: 1,
      message: "Merangkum…",
      step: 2,
      stepLabel: "Rangkuman",
    };
  }
  return {
    phase: "transcribing",
    current: 0,
    total: 1,
    message: "Memproses…",
    step: 1,
    stepLabel: "Transkripsi",
  };
}

async function pollQueuedTranscriptionJob(
  jobId: string,
  signal: AbortSignal,
  options: {
    setSummarizeProgress: (progress: SummarizeProgress | null) => void;
    setError: (err: string | null) => void;
    fetchHistory: () => Promise<void>;
    onSuccessfulCompletion?: () => void;
    stopPolling: () => void;
    setPollInterval: (id: ReturnType<typeof setInterval>) => void;
    isSessionActive: () => boolean;
  }
): Promise<void> {
  const pollOnce = async (): Promise<"continue" | "terminal"> => {
    if (signal.aborted || !options.isSessionActive()) {
      return "terminal";
    }

    const res = await fetch(`/api/summary-jobs/${encodeURIComponent(jobId)}`, {
      credentials: "include",
      signal,
    });
    if (!res.ok) {
      if (res.status === 401) {
        const loginUrl = new URL("/login", window.location.origin);
        loginUrl.searchParams.set("from", window.location.pathname);
        window.location.href = loginUrl.toString();
        return "terminal";
      }
      throw new Error(`Failed to poll job: ${res.status}`);
    }

    const body = (await res.json()) as PolledSummaryJob & { job?: PolledSummaryJob };
    const job = body.job ?? body;

    if (!options.isSessionActive()) {
      return "terminal";
    }

    if (job.status === "completed") {
      await options.fetchHistory();
      options.onSuccessfulCompletion?.();
      return "terminal";
    }
    if (job.status === "failed") {
      options.setError(job.errorMessage ?? "Summarization failed.");
      return "terminal";
    }
    if (job.status === "cancelled") {
      return "terminal";
    }

    console.log("[POLL]", job.status, job.progressPercentage, job.totalChunks, job.processedChunks);
    options.setSummarizeProgress(progressFromPolledJob(job));
    return "continue";
  };

  const first = await pollOnce();
  if (first === "terminal") {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const intervalId = setInterval(() => {
      void (async () => {
        try {
          const result = await pollOnce();
          if (result === "terminal") {
            options.stopPolling();
            resolve();
          }
        } catch (err) {
          options.stopPolling();
          reject(err);
        }
      })();
    }, QUEUED_JOB_POLL_MS);

    options.setPollInterval(intervalId);

    const onAbort = () => {
      options.stopPolling();
      resolve();
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

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

export function useSummarize(
  groqApiKey: string,
  fetchHistory: () => Promise<void>,
  setError: (err: string | null) => void,
  setSuccess: (msg: string | null) => void,
  onSuccessfulCompletion?: () => void
) {
  const { user } = useAuth();
  const [summarizeLoading, setSummarizeLoading] = useState<string | null>(null);
  const [summarizeProgress, setSummarizeProgress] = useState<SummarizeProgress | null>(null);
  const elapsedSeconds = useElapsedTimer(!!summarizeLoading);
  const [currentSummarizeJobId, setCurrentSummarizeJobId] = useState<string | null>(null);
  const [liveSourceText, setLiveSourceText] = useState<string>("");
  const summarizeAbortRef = useRef<AbortController | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const summarizeSessionRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current != null) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const [resumeLoading, setResumeLoading] = useState<string | null>(null);
  const [resumeProgress, setResumeProgress] = useState<SummarizeProgress | null>(null);
  const resumeElapsedSeconds = useElapsedTimer(!!resumeLoading);
  const resumeAbortRef = useRef<AbortController | null>(null);
  const isPausingRef = useRef(false);
  const hasAutoRestoredRef = useRef(false);

  useEffect(() => {
    if (!user?.id) return;
    if (hasAutoRestoredRef.current) return;
    hasAutoRestoredRef.current = true;

    const restoreInProgressJob = async () => {
      await fetchHistory();

      const res = await fetch("/api/summary-jobs", { credentials: "include" });
      if (!res.ok) return;

      const data = (await res.json()) as { jobs?: SummaryJobItem[] };
      const jobs = data.jobs ?? [];
      const job = jobs.find(
        (j) =>
          j.userId === user.id &&
          (j.status === "processing" || j.status === "queued_transcription")
      );
      if (!job) return;

      setError(null);
      setResumeLoading(job.id);
      setResumeProgress({
        phase: "transcribing",
        current: 0,
        total: 1,
        message:
          job.status === "queued_transcription"
            ? "Audio sedang diproses di background. Anda bisa menutup tab ini."
            : "Mentranskripsi audio…",
        step: 1,
        stepLabel: "Transkripsi",
      });

      const controller = new AbortController();
      resumeAbortRef.current = controller;
      stopPolling();

      try {
        await pollQueuedTranscriptionJob(job.id, controller.signal, {
          setSummarizeProgress: setResumeProgress,
          setError,
          fetchHistory,
          onSuccessfulCompletion,
          stopPolling,
          setPollInterval: (id) => {
            pollIntervalRef.current = id;
          },
          isSessionActive: () => true,
        });
      } catch (err) {
        handleStreamError(err, isPausingRef.current, setError, "Summarize failed.");
      } finally {
        stopPolling();
        isPausingRef.current = false;
        setResumeLoading(null);
        setResumeProgress(null);
        resumeAbortRef.current = null;
        fetchHistory();
      }
    };

    void restoreInProgressJob();
  }, [fetchHistory, setError, onSuccessfulCompletion, stopPolling, user?.id ?? null]);

  const cancelSummarizeJob = useCallback(
    async (isPausing: boolean) => {
      if (isPausing) isPausingRef.current = true;
      summarizeAbortRef.current?.abort();
      stopPolling();
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
    [currentSummarizeJobId, fetchHistory, stopPolling]
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
      const sessionId = ++summarizeSessionRef.current;
      stopPolling();

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
        let queuedJobId: string | null = null;

        streamLoop: while (true) {
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
              if (data.type === "queued" && data.jobId) {
                queuedJobId = data.jobId;
                setCurrentSummarizeJobId(data.jobId);
                setSummarizeProgress({
                  phase: "transcribing",
                  current: 0,
                  total: 1,
                  message: "Audio sedang diproses di background. Anda bisa menutup tab ini.",
                  step: 1,
                  stepLabel: "Transkripsi",
                });
                void reader.cancel();
                break streamLoop;
              }
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

        if (queuedJobId) {
          await pollQueuedTranscriptionJob(queuedJobId, controller.signal, {
            setSummarizeProgress,
            setError,
            fetchHistory,
            onSuccessfulCompletion,
            stopPolling,
            setPollInterval: (id) => {
              pollIntervalRef.current = id;
            },
            isSessionActive: () => sessionId === summarizeSessionRef.current,
          });
        }
      } catch (err) {
        handleStreamError(err, isPausingRef.current, setError, "Summarize failed.");
      } finally {
        stopPolling();
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

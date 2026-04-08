"use client";

import Image from "next/image";
import { useCallback, useRef, useState } from "react";

import kemenkumLogo from "@/assets/kemenkum_logo.png";
import { useAuth } from "@/app/contexts/AuthContext";
import { useGroqApiKey } from "@/app/hooks/useGroqApiKey";
import { useHistory } from "@/app/hooks/useHistory";
import { useSummarize } from "@/app/hooks/useSummarize";
import { useFileUpload, formatSize, isAudioFile } from "@/app/components/FileUpload";
import { SummaryResultPanel } from "@/app/components/SummaryResult";
import { ProgressDisplay } from "@/app/components/ProgressDisplay";
import { HistoryPanel } from "@/app/components/HistoryPanel";

export default function Home() {
  const { user, logout } = useAuth();
  const { groqApiKey, setGroqApiKey } = useGroqApiKey();
  const [error, setError] = useState<string | null>(null);

  const { historyJobs, fetchHistory, deleteJob } = useHistory(user);
  const {
    summarizeLoading,
    summarizeProgress,
    estimatedSeconds,
    elapsedSeconds,
    summary,
    setSummary,
    resumeLoading,
    resumeProgress,
    handleSummarize,
    pauseSummarize,
    abortSummarize,
    handleResumeJob,
    pauseResume,
    abortResume,
  } = useSummarize(groqApiKey, fetchHistory, setError);

  const { files, dragActive, addFiles, removeFile, handleDrag, handleDrop, ACCEPTED_FILE_TYPES } =
    useFileUpload(setError);

  const [glossaryMap, setGlossaryMap] = useState<Record<string, string>>({});

  const resumeCardRef = useRef<HTMLDivElement | null>(null);

  const onResumeJob = useCallback(
    (job: Parameters<typeof handleResumeJob>[0]) => {
      handleResumeJob(job);
      requestAnimationFrame(() => {
        resumeCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [handleResumeJob]
  );

  return (
    <main className="min-h-screen bg-kemenkum-blue py-8 px-4 flex justify-center items-center overflow-y-auto">
      <div className="w-full max-w-2xl bg-white rounded-lg shadow-lg px-4 sm:px-8 pt-4 pb-10 mx-auto overflow-x-hidden text-center">
        {user && (
          <div className="flex items-center justify-between gap-3 mb-6">
            <span className="text-base text-kemenkum-blue font-medium truncate">{user.email}</span>
            <button
              type="button"
              onClick={logout}
              aria-label="Logout"
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
            Groq API Key <span className="text-gray-500">(disimpan selama sesi)</span>
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
                  <div className="text-left">
                    <label className="text-xs text-gray-500 mb-1 block">
                      Istilah teknis <span className="text-gray-400">(opsional)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="Contoh: PSSI, KPI, DevSecOps, CI/CD, XSS"
                      value={glossaryMap[item.id] ?? ""}
                      onChange={(e) =>
                        setGlossaryMap((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      disabled={summarizeLoading === item.id}
                      className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue disabled:opacity-60"
                    />
                  </div>
                  {summarizeLoading === item.id && summarizeProgress && (
                    <div className="w-full min-w-0">
                      <ProgressDisplay
                        file={item.file}
                        progress={summarizeProgress}
                        estimatedSeconds={estimatedSeconds}
                        elapsedSeconds={elapsedSeconds}
                      />
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 justify-end min-w-0">
                    <button
                      type="button"
                      onClick={() => handleSummarize(item, glossaryMap[item.id] ?? "")}
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
                      onClick={() => {
                        removeFile(item.id);
                        setGlossaryMap((prev) => {
                          const next = { ...prev };
                          delete next[item.id];
                          return next;
                        });
                        if (summary?.fileId === item.id) setSummary(null);
                      }}
                      className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:border-red-400 hover:text-red-600 hover:bg-red-50 flex-shrink-0"
                      aria-label="Hapus file"
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
          <SummaryResultPanel summary={summary} setError={setError} />
        )}

        {user && (
          <HistoryPanel
            historyJobs={historyJobs}
            resumeLoading={resumeLoading}
            resumeProgress={resumeProgress}
            onResumeJob={onResumeJob}
            onPauseResume={pauseResume}
            onAbortResume={abortResume}
            onDeleteJob={deleteJob}
            setError={setError}
          />
        )}
      </div>
    </main>
  );
}

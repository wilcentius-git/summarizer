"use client";

import { useCallback, useState } from "react";
import { RawResult } from "@/app/components/RawResult";
import { SummaryMarkdownBody } from "@/app/components/SummaryMarkdownBody";
import { useAuth } from "@/app/contexts/AuthContext";
import { buildJobPdf } from "@/lib/export-pdf";
import { formatElapsedTime } from "@/lib/format-time";
import { sanitizeTitleForFilename, signAndExportPdf } from "@/lib/sign-and-export-pdf";
import { PassphraseModal } from "@/components/PassphraseModal";
import type jsPDF from "jspdf";

type SummaryResultProps = {
  summary: {
    fileId: string;
    fileName: string;
    text: string;
    elapsedSeconds?: number;
    sourceText?: string;
    sourceIsAudio?: boolean;
  };
};

export function SummaryResultPanel({ summary }: SummaryResultProps) {
  const { user } = useAuth();
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [passphraseModalKey, setPassphraseModalKey] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const copySummary = useCallback(() => {
    if (!summary.text) return;
    navigator.clipboard.writeText(summary.text);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  }, [summary.text]);

  const handleExport = useCallback(
    async (save: (doc: jsPDF, filename: string) => void | Promise<void>) => {
      setIsLoading(true);
      try {
        const doc = await buildJobPdf(summary.text, summary.fileName);
        if (!doc) {
          throw new Error("Tidak ada teks untuk diekspor.");
        }
        const fileStem = sanitizeTitleForFilename(summary.fileName);
        const filename = `rangkuman-${fileStem}.pdf`;
        await Promise.resolve(save(doc, filename));
        setIsModalOpen(false);
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "Gagal mengekspor PDF. Coba lagi.");
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    },
    [summary.text, summary.fileName]
  );

  const onPassphraseConfirm = useCallback(
    async (passphrase: string) => {
      if (!user) {
        window.alert("Sesi tidak valid. Silakan masuk kembali.");
        setIsModalOpen(false);
        return;
      }
      await handleExport((doc, filename) => signAndExportPdf(doc, passphrase, user.id, filename));
    },
    [user, handleExport]
  );

  return (
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
            {copyFeedback ? "Tersalin!" : "Copy"}
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!summary.text) return;
              if (!user) {
                window.alert("Sesi tidak valid. Silakan masuk kembali.");
                return;
              }
              if (user.isAdmin) {
                await handleExport((doc, filename) => {
                  doc.save(filename);
                });
                return;
              }
              setPassphraseModalKey((k) => k + 1);
              setIsModalOpen(true);
            }}
            className="px-3 py-1.5 rounded bg-kemenkum-yellow text-kemenkum-blue text-sm font-medium hover:opacity-90"
          >
            Export to PDF
          </button>
        </div>
      </div>
      {summary.elapsedSeconds != null && (
        <p className="text-sm text-gray-500 mb-2 text-left">
          Proses selesai dalam {formatElapsedTime(summary.elapsedSeconds)}.
        </p>
      )}
      {summary.sourceText?.trim() && (
        <RawResult
          className="mb-4"
          label={summary.sourceIsAudio ? "Transkrip mentah" : "Teks sumber"}
          text={summary.sourceText}
        />
      )}
      <SummaryMarkdownBody
        text={summary.text}
        className="w-full p-4 rounded-lg border border-gray-200 bg-gray-50 text-left min-h-[200px]"
      />
      <div aria-live="polite" className="sr-only">
        {copyFeedback ? "Rangkuman berhasil disalin ke clipboard" : ""}
      </div>
      <PassphraseModal
        key={passphraseModalKey}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConfirm={onPassphraseConfirm}
        isLoading={isLoading}
      />
    </section>
  );
}

"use client";

import { useId, useState } from "react";

export type PassphraseModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (passphrase: string) => void;
  isLoading: boolean;
};

function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function PassphraseModal({
  isOpen,
  onClose,
  onConfirm,
  isLoading,
}: PassphraseModalProps) {
  const [passphrase, setPassphrase] = useState("");
  const labelId = useId();
  const titleId = useId();
  const hintId = useId();

  const handleClose = () => {
    setPassphrase("");
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]"
        aria-hidden
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
        <div
          className="relative w-full max-w-[400px] overflow-hidden rounded-2xl border border-gray-200/90 bg-white shadow-2xl ring-1 ring-black/5"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={hintId}
        >
          <div className="border-b border-gray-100 bg-gradient-to-br from-white to-gray-50/80 px-6 pt-6 pb-5">
            <div className="flex items-start gap-4">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-kemenkum-yellow/35 text-kemenkum-blue shadow-inner"
                aria-hidden
              >
                <LockIcon className="h-6 w-6" />
              </div>
              <div className="min-w-0 pt-0.5">
                <h2
                  id={titleId}
                  className="text-lg font-semibold leading-tight text-kemenkum-blue"
                >
                  Tanda tangani PDF
                </h2>
                <p id={hintId} className="mt-1 text-sm text-gray-600">
                  Masukkan passphrase BSrE Anda untuk menandatangani berkas.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-5 px-6 py-6">
            <div>
              <p
                className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500"
                id={`${labelId}-hint`}
              >
                Autentikasi
              </p>
              <label
                htmlFor={`${labelId}-passphrase`}
                className="mb-1.5 block text-sm font-medium text-gray-800"
              >
                Passphrase
              </label>
              <input
                id={`${labelId}-passphrase`}
                type="password"
                name="passphrase"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="off"
                className="w-full rounded-lg border-2 border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-sm transition-[border-color,box-shadow] placeholder:text-gray-400 focus:border-kemenkum-blue focus:outline-none focus:ring-2 focus:ring-kemenkum-blue/35 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:opacity-70"
                disabled={isLoading}
                aria-describedby={`${labelId}-hint`}
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
              {isLoading && (
                <span
                  className="mr-auto flex w-full items-center text-sm text-gray-600 sm:w-auto"
                  aria-live="polite"
                >
                  <svg
                    className="mr-2 h-5 w-5 shrink-0 animate-spin text-kemenkum-blue"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Memproses…
                </span>
              )}
              <button
                type="button"
                onClick={handleClose}
                className="min-w-[6.5rem] rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isLoading}
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => onConfirm(passphrase)}
                className="min-w-[6.5rem] rounded-lg bg-kemenkum-yellow px-4 py-2.5 text-sm font-semibold text-kemenkum-blue shadow-sm transition hover:shadow-md hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isLoading}
              >
                Ekspor
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

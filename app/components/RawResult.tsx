"use client";

function sanitizeRawText(s: string): string {
  if (!s) return s;
  return s
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

export type RawResultProps = {
  /** e.g. "Transkrip mentah" (audio) or "Teks sumber" (document) */
  label: string;
  text: string;
  className?: string;
  /** If true, blocks common user interactions for preview-only mode. */
  isPreviewOnly?: boolean;
};

export function RawResult({ label, text, className = "", isPreviewOnly = false }: RawResultProps) {
  const safe = sanitizeRawText(text);

  return (
    <section className={`text-left ${className}`.trim()}>
      <h3 className="text-sm font-semibold text-kemenkum-blue mb-2">{label}</h3>
      <pre
        tabIndex={isPreviewOnly ? 0 : undefined}
        aria-readonly={isPreviewOnly ? "true" : undefined}
        onCopy={isPreviewOnly ? (e) => e.preventDefault() : undefined}
        onCut={isPreviewOnly ? (e) => e.preventDefault() : undefined}
        onContextMenu={isPreviewOnly ? (e) => e.preventDefault() : undefined}
        onDragStart={isPreviewOnly ? (e) => e.preventDefault() : undefined}
        onKeyDown={
          isPreviewOnly
            ? (e) => {
                const key = e.key.toLowerCase();
                const mod = e.ctrlKey || e.metaKey;
                if (mod && (key === "c" || key === "x" || key === "a")) {
                  e.preventDefault();
                }
              }
            : undefined
        }
        className={`w-full max-h-[320px] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 whitespace-pre-wrap break-words font-mono leading-relaxed ${
          isPreviewOnly ? "select-none" : ""
        }`}
      >
        {safe || "—"}
      </pre>
    </section>
  );
}

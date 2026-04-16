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
};

export function RawResult({ label, text, className = "" }: RawResultProps) {
  const safe = sanitizeRawText(text);

  return (
    <section className={`text-left ${className}`.trim()}>
      <h3 className="text-sm font-semibold text-kemenkum-blue mb-2">{label}</h3>
      <pre className="w-full max-h-[320px] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 whitespace-pre-wrap break-words font-mono leading-relaxed">
        {safe || "—"}
      </pre>
    </section>
  );
}

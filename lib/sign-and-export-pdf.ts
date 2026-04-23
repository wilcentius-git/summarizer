import type jsPDF from "jspdf";

const DEFAULT_UPLOAD_PDF = "summary.pdf";

type SignPdfSuccess = { file: string };
type SignPdfError = { error: string };

function getErrorMessage(obj: unknown): string {
  if (obj && typeof obj === "object" && "error" in obj) {
    const e = (obj as SignPdfError).error;
    if (typeof e === "string" && e.trim()) {
      return e;
    }
  }
  return "Terjadi kesalahan.";
}

/**
 * Strips the last file extension, replaces spaces with hyphens, and replaces other
 * non-letter/number characters (Unicode letters and digits kept) for use in export names.
 * Example: `Rapat Bulanan.mp3` → `Rapat-Bulanan` (for `transkrip-Rapat-Bulanan.pdf`, etc.).
 */
export function sanitizeTitleForFilename(raw: string): string {
  const base = raw.replace(/\.[^.]+$/i, "");
  return (
    base
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^\p{L}\p{N}-]+/gu, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "dokumen"
  );
}

/**
 * Sign the generated PDF server-side, then download the signed file in the browser.
 * Must be called in a client context (not during SSR).
 */
export async function signAndExportPdf(
  doc: jsPDF,
  passphrase: string,
  nip: string,
  filename: string
): Promise<void> {
  if (typeof document === "undefined" || typeof window === "undefined") {
    throw new Error("signAndExportPdf hanya dapat dipanggil di browser.");
  }

  const pdfBlob = doc.output("blob");
  if (!(pdfBlob instanceof Blob)) {
    throw new Error("Gagal membuat berkas PDF.");
  }

  const downloadName = filename.toLowerCase().endsWith(".pdf")
    ? filename
    : `${filename}.pdf`;
  const uploadBasename = downloadName.split(/[/\\]/).pop() ?? downloadName;

  const formData = new FormData();
  formData.append("nip", nip);
  formData.append("passphrase", passphrase);
  formData.append("file", pdfBlob, uploadBasename || DEFAULT_UPLOAD_PDF);

  const res = await fetch("/api/sign-pdf", {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  let json: unknown;
  const raw = await res.text();
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error("Terjadi kesalahan.");
  }

  if (!res.ok) {
    throw new Error(getErrorMessage(json));
  }

  const data = json as SignPdfSuccess;
  if (typeof data.file !== "string" || data.file.length === 0) {
    throw new Error("Terjadi kesalahan.");
  }

  let bytes: Uint8Array;
  try {
    const binary = atob(data.file);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
  } catch {
    throw new Error("Gagal memproses berkas yang ditandatangani.");
  }

  const outBlob = new Blob([Uint8Array.from(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(outBlob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}

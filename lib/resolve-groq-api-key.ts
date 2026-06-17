/**
 * Resolve Groq API key: client override → satuan kerja (decrypted plaintext) → server env.
 */
export function resolveGroqApiKey(
  fromRequest: string | null | undefined,
  fromSatuanKerja?: string | null
): string {  const fromClient = fromRequest?.trim() ?? "";
  if (fromClient) return fromClient;

  const fromUnit = fromSatuanKerja?.trim() ?? "";
  if (fromUnit) return fromUnit;

  return process.env.GROQ_API_KEY?.trim() ?? "";
}

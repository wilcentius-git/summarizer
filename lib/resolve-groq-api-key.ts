/**
 * Prefer a key sent by the client (optional override); otherwise use server env.
 */
export function resolveGroqApiKey(fromRequest: string | null | undefined): string {
  const trimmed = fromRequest?.trim() ?? "";
  if (trimmed) return trimmed;
  return process.env.GROQ_API_KEY?.trim() ?? "";
}

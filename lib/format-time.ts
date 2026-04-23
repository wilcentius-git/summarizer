/**
 * Formats elapsed seconds as `MM:SS`, or `HH:MM:SS` when ≥ 1 hour.
 * Negative inputs are clamped to zero.
 */
export function formatElapsedTime(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

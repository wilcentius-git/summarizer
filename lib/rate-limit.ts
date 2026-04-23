import { NextResponse } from "next/server";

const windowMs = 15 * 60 * 1000; // 15 minutes
const maxAttempts = 10;

const attempts = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (now > entry.resetAt) attempts.delete(key);
  }
}, 60 * 1000);

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}

function consumeKey(key: string): { allowed: true } | { allowed: false; resetAt: number } {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  entry.count++;
  if (entry.count > maxAttempts) {
    return { allowed: false, resetAt: entry.resetAt };
  }

  return { allowed: true };
}

/**
 * In-memory per-IP rate limiter for auth endpoints.
 * Returns a NextResponse with 429 if the limit is exceeded, or null if allowed.
 */
export function checkRateLimit(request: Request): NextResponse | null;
/**
 * In-memory per-key rate limiter (e.g. per user for summarize).
 * Resolves to `{ success: false }` if the limit is exceeded.
 */
export function checkRateLimit(key: string): Promise<{ success: boolean }>;
export function checkRateLimit(
  requestOrKey: Request | string
): NextResponse | null | Promise<{ success: boolean }> {
  if (typeof requestOrKey === "string") {
    const result = consumeKey(requestOrKey);
    return Promise.resolve({ success: result.allowed });
  }
  const ip = getClientIp(requestOrKey);
  const result = consumeKey(ip);
  if (!result.allowed) {
    const now = Date.now();
    const retryAfterSec = Math.ceil((result.resetAt - now) / 1000);
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSec) },
      }
    );
  }
  return null;
}

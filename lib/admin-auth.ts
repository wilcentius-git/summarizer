import { timingSafeEqual } from "crypto";

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

export function isAdminLogin(nip: string, pass: string): boolean {
  const expectedNip = process.env.ADMIN_NIP;
  const expectedPass = process.env.ADMIN_PASSWORD;
  if (!expectedNip || !expectedPass) return false;
  return safeCompare(nip.trim(), expectedNip.trim()) && safeCompare(pass, expectedPass);
}

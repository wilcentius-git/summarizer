import { NextResponse } from "next/server";
import { clearAuthTokenCookie } from "@/lib/auth-cookie";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearAuthTokenCookie(response);
  return response;
}

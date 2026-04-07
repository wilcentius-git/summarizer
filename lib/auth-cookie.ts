import type { NextResponse } from "next/server";

export const AUTH_TOKEN_COOKIE = "auth-token";

export function setAuthTokenCookie(response: NextResponse, token: string) {
  response.cookies.set(AUTH_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
}

export function clearAuthTokenCookie(response: NextResponse) {
  response.cookies.set(AUTH_TOKEN_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}

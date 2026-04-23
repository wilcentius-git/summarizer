import { NextResponse } from "next/server";
import { setAuthTokenCookie } from "@/lib/auth-cookie";
import { createToken, verifyPassword } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validations";
import { prisma } from "@/lib/prisma";
import { loginViaSimpeg } from "@/lib/simpeg-login";
import { ensureUserForNip } from "@/lib/provision-user";
import type { User } from "@prisma/client";

async function sendLoginResponse(user: User, canonicalNip: string) {
  const token = await createToken({
    userId: canonicalNip,
    email: canonicalNip,
  });
  const response = NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    },
  });
  setAuthTokenCookie(response, token);
  return response;
}

export async function POST(request: Request) {
  const rateLimited = checkRateLimit(request);
  if (rateLimited) return rateLimited;

  try {
    const body = await request.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? "Invalid input";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const { nip, pass } = parsed.data;
    const trimmedNip = nip.trim();
    const dbUser = await prisma.user.findUnique({ where: { id: trimmedNip } });

    // Seeded / local admin: check password only in DB, never call Simpeg.
    if (dbUser?.isAdmin) {
      if (!(await verifyPassword(pass, dbUser.passwordHash))) {
        return NextResponse.json(
          { error: "Invalid NIP or password" },
          { status: 401 }
        );
      }
      const user = dbUser.name?.trim()
        ? dbUser
        : await prisma.user.update({
            where: { id: dbUser.id },
            data: { name: "Administrator" },
          });
      return sendLoginResponse(user, trimmedNip);
    }

    const simpeg = await loginViaSimpeg(nip, pass);
    if (!simpeg.ok && simpeg.reason === "config") {
      console.error(simpeg.message);
      return NextResponse.json(
        { error: "Login service is not configured" },
        { status: 500 }
      );
    }
    if (!simpeg.ok && simpeg.reason === "bad_response") {
      return NextResponse.json(
        { error: "Login service temporarily unavailable" },
        { status: 502 }
      );
    }
    if (!simpeg.ok) {
      return NextResponse.json(
        { error: "Invalid NIP or password" },
        { status: 401 }
      );
    }

    const canonicalNip = simpeg.nip.trim();
    const user = await ensureUserForNip(canonicalNip, simpeg.name);
    return sendLoginResponse(user, canonicalNip);
  } catch (err) {
    console.error("Login error:", err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}

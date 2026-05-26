import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type RequireAdminResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

export async function requireAdmin(): Promise<RequireAdminResult> {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth-token")?.value;
  const payload = token ? await verifyToken(token) : null;

  if (!payload) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { isAdmin: true },
  });

  if (!user?.isAdmin) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, userId: payload.userId };
}

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { clearAuthTokenCookie } from "@/lib/auth-cookie";
import { verifyToken } from "@/lib/auth";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth-token")?.value;

    if (!token) {
      return NextResponse.json({ user: null }, { status: 200 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      const res = NextResponse.json({ user: null }, { status: 401 });
      clearAuthTokenCookie(res);
      return res;
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, name: true, createdAt: true },
    });

    if (!user) {
      const res = NextResponse.json({ user: null }, { status: 401 });
      clearAuthTokenCookie(res);
      return res;
    }

    const isAdmin = user.id === process.env.ADMIN_NIP;

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
        isAdmin,
      },
    });
  } catch (err) {
    console.error("Me error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { setAuthTokenCookie } from "@/lib/auth-cookie";
import { hashPassword, createToken } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { registerSchema } from "@/lib/validations";

export async function POST(request: Request) {
  const rateLimited = checkRateLimit(request);
  if (rateLimited) return rateLimited;

  try {
    const body = await request.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? "Invalid input";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const { email, password } = parsed.data;

    const existing = await prisma.user.findUnique({
      where: { email },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
      },
    });

    const token = await createToken({ userId: user.id, email: user.email });

    const response = NextResponse.json({
      user: { id: user.id, email: user.email, createdAt: user.createdAt },
    });
    setAuthTokenCookie(response, token);
    return response;
  } catch (err) {
    console.error("Register error:", err);
    return NextResponse.json(
      { error: "Registration failed" },
      { status: 500 }
    );
  }
}

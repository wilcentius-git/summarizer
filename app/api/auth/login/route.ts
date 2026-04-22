import { NextResponse } from "next/server";
import { setAuthTokenCookie } from "@/lib/auth-cookie";
import { createToken } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validations";
import { isAdminLogin } from "@/lib/admin-auth";
import { loginViaSimpeg } from "@/lib/simpeg-login";
import { ensureUserForNip } from "@/lib/provision-user";

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

    let canonicalNip: string;
    let displayName: string | undefined;

    if (isAdminLogin(nip, pass)) {
      canonicalNip = nip.trim();
      displayName =
        process.env.ADMIN_DISPLAY_NAME?.trim() || "Administrator";
    } else {
      console.log("[login] before Pusdatin API (loginViaSimpeg)");
      const simpeg = await loginViaSimpeg(nip, pass);
      console.log("[login] after Pusdatin API (loginViaSimpeg)", simpeg);
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
      canonicalNip = simpeg.nip.trim();
      displayName = simpeg.name;
    }

    const user = await ensureUserForNip(canonicalNip, displayName);

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
  } catch (err) {
    console.error("Login error:", err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}

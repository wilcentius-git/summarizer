import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { whitelistNipSchema } from "@/lib/validations";
import { writeAuditLog } from "@/lib/audit-log";

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const entries = await prisma.whitelist.findMany({
      orderBy: { createdAt: "desc" },
      include: { satuanKerja: true },
    });

    return NextResponse.json({ entries });
  } catch (err) {
    console.error("Whitelist list error:", err);
    return NextResponse.json(
      { error: "Failed to fetch whitelist" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const parsed = whitelistNipSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? "Invalid input";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const { nip, satuanKerjaId } = parsed.data;

    const unit = await prisma.satuanKerja.findUnique({
      where: { id: satuanKerjaId },
      select: { id: true },
    });
    if (!unit) {
      return NextResponse.json(
        { error: "Satuan kerja tidak ditemukan" },
        { status: 400 }
      );
    }

    const existing = await prisma.whitelist.findUnique({ where: { nip } });
    if (existing) {
      return NextResponse.json(
        { error: "NIP sudah terdaftar dalam whitelist" },
        { status: 409 }
      );
    }

    const entry = await prisma.whitelist.create({
      data: { nip, satuanKerjaId },
      include: { satuanKerja: true },
    });
    await writeAuditLog({
      type: "ADMIN",
      action: "admin.whitelist.add",
      userId: auth.userId,
      metadata: { nip },
    });
    return NextResponse.json(entry, { status: 201 });
  } catch (err) {
    console.error("Whitelist create error:", err);
    return NextResponse.json(
      { error: "Failed to add whitelist entry" },
      { status: 500 }
    );
  }
}

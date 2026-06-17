import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { whitelistSatuanKerjaSchema } from "@/lib/validations";
import { writeAuditLog } from "@/lib/audit-log";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ nip: string }> }
) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { nip: rawNip } = await params;
    const nip = decodeURIComponent(rawNip).trim();

    const body = await request.json();
    const parsed = whitelistSatuanKerjaSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? "Invalid input";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const { satuanKerjaId } = parsed.data;

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
    if (!existing) {
      return NextResponse.json(
        { error: "Whitelist entry not found" },
        { status: 404 }
      );
    }

    const entry = await prisma.whitelist.update({
      where: { nip },
      data: { satuanKerjaId },
      include: { satuanKerja: true },
    });

    return NextResponse.json(entry, { status: 200 });
  } catch (err) {
    console.error("Whitelist update error:", err);
    return NextResponse.json(
      { error: "Failed to update whitelist entry" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ nip: string }> }
) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { nip: rawNip } = await params;
    const nip = decodeURIComponent(rawNip).trim();

    const existing = await prisma.whitelist.findUnique({ where: { nip } });
    if (!existing) {
      return NextResponse.json(
        { error: "Whitelist entry not found" },
        { status: 404 }
      );
    }

    await prisma.whitelist.delete({ where: { nip } });
    await writeAuditLog({
      type: "ADMIN",
      action: "admin.whitelist.remove",
      userId: auth.userId,
      metadata: { nip },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Whitelist delete error:", err);
    return NextResponse.json(
      { error: "Failed to delete whitelist entry" },
      { status: 500 }
    );
  }
}

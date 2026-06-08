import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;

    const existing = await prisma.satuanKerja.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Satuan kerja tidak ditemukan" },
        { status: 404 }
      );
    }

    await prisma.satuanKerja.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Satuan kerja delete error:", err);
    return NextResponse.json(
      { error: "Failed to delete satuan kerja" },
      { status: 500 }
    );
  }
}

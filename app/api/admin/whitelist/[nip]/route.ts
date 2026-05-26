import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

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
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Whitelist delete error:", err);
    return NextResponse.json(
      { error: "Failed to delete whitelist entry" },
      { status: 500 }
    );
  }
}

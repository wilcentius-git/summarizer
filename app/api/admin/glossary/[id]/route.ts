import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { parseCommonMistakes, serializeCommonMistakes, toGlossaryTermRecord } from "@/lib/glossary";
import { glossaryTermSchema } from "@/lib/validations";
import { writeAuditLog } from "@/lib/audit-log";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const body = await request.json();
    const parsed = glossaryTermSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? "Invalid input";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const term = parsed.data.term.trim();
    const commonMistakes = serializeCommonMistakes(
      parseCommonMistakes(parsed.data.commonMistakes ?? "")
    );
    const definition = parsed.data.definition;

    const existing = await prisma.glossaryTerm.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Istilah tidak ditemukan" }, { status: 404 });
    }

    const duplicate = await prisma.glossaryTerm.findFirst({
      where: { term, NOT: { id } },
    });
    if (duplicate) {
      return NextResponse.json(
        { error: "Istilah sudah ada dalam glosarium" },
        { status: 409 }
      );
    }

    const updated = await prisma.glossaryTerm.update({
      where: { id },
      data: { term, commonMistakes, definition },
      select: { id: true, term: true, commonMistakes: true, definition: true, createdAt: true },
    });

    await writeAuditLog({
      type: "ADMIN",
      action: "admin.glossary.update",
      userId: auth.userId,
      metadata: { id, term },
    });

    return NextResponse.json({
      ...toGlossaryTermRecord(updated),
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err) {
    console.error("Glossary update error:", err);
    return NextResponse.json(
      { error: "Failed to update glossary term" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const existing = await prisma.glossaryTerm.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Istilah tidak ditemukan" }, { status: 404 });
    }

    await prisma.glossaryTerm.delete({ where: { id } });

    await writeAuditLog({
      type: "ADMIN",
      action: "admin.glossary.remove",
      userId: auth.userId,
      metadata: { id, term: existing.term },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Glossary delete error:", err);
    return NextResponse.json(
      { error: "Failed to delete glossary term" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { parseCommonMistakes, serializeCommonMistakes, toGlossaryTermRecord } from "@/lib/glossary";
import { glossaryTermSchema } from "@/lib/validations";
import { writeAuditLog } from "@/lib/audit-log";

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim().toLowerCase() ?? "";

    const rows = await prisma.glossaryTerm.findMany({
      orderBy: { term: "asc" },
      select: { id: true, term: true, commonMistakes: true, definition: true, createdAt: true },
    });

    const terms = rows
      .map((row) => ({
        ...toGlossaryTermRecord(row),
        createdAt: row.createdAt.toISOString(),
      }))
      .filter((entry) => {
        if (!q) return true;
        const haystack = [
          entry.term,
          entry.definition ?? "",
          ...entry.commonMistakes,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });

    return NextResponse.json({ terms });
  } catch (err) {
    console.error("Glossary list error:", err);
    return NextResponse.json(
      { error: "Failed to fetch glossary terms" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

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

    const existing = await prisma.glossaryTerm.findUnique({ where: { term } });
    if (existing) {
      return NextResponse.json(
        { error: "Istilah sudah ada dalam glosarium" },
        { status: 409 }
      );
    }

    const created = await prisma.glossaryTerm.create({
      data: { term, commonMistakes, definition },
      select: { id: true, term: true, commonMistakes: true, definition: true, createdAt: true },
    });

    await writeAuditLog({
      type: "ADMIN",
      action: "admin.glossary.add",
      userId: auth.userId,
      metadata: { term },
    });

    return NextResponse.json(
      {
        ...toGlossaryTermRecord(created),
        createdAt: created.createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("Glossary create error:", err);
    return NextResponse.json(
      { error: "Failed to add glossary term" },
      { status: 500 }
    );
  }
}

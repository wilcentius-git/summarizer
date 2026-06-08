import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { satuanKerjaNameSchema } from "@/lib/validations";

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const units = await prisma.satuanKerja.findMany({
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ units });
  } catch (err) {
    console.error("Satuan kerja list error:", err);
    return NextResponse.json(
      { error: "Failed to fetch satuan kerja" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const parsed = satuanKerjaNameSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? "Invalid input";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const name = parsed.data.name;

    const existing = await prisma.satuanKerja.findUnique({ where: { name } });
    if (existing) {
      return NextResponse.json(
        { error: "Satuan kerja dengan nama ini sudah ada" },
        { status: 409 }
      );
    }

    const unit = await prisma.satuanKerja.create({ data: { name } });
    return NextResponse.json(unit, { status: 201 });
  } catch (err) {
    console.error("Satuan kerja create error:", err);
    return NextResponse.json(
      { error: "Failed to create satuan kerja" },
      { status: 500 }
    );
  }
}

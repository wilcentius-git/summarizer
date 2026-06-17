import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { encryptApiKey, decryptApiKey } from "@/lib/crypto";
import { requireAdmin } from "@/lib/require-admin";

function maskPlaintextGroqApiKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 4) return "•".repeat(key.length);
  return "•".repeat(key.length - 4) + key.slice(-4);
}

const createSatuanKerjaSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Nama satuan kerja wajib diisi")
    .max(200, "Nama terlalu panjang"),
  groqApiKey: z.string().trim().min(1, "Groq API key wajib diisi"),
});

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const units = await prisma.satuanKerja.findMany({
      orderBy: { name: "asc" },
    });

    const safeUnits = units.map((unit) => ({
      id: unit.id,
      name: unit.name,
      createdAt: unit.createdAt,
      groqApiKeyMasked: unit.groqApiKey
        ? maskPlaintextGroqApiKey(decryptApiKey(unit.groqApiKey))
        : null,
    }));

    return NextResponse.json({ units: safeUnits });
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
    const parsed = createSatuanKerjaSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? "Invalid input";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const { name, groqApiKey } = parsed.data;

    const existing = await prisma.satuanKerja.findUnique({ where: { name } });
    if (existing) {
      return NextResponse.json(
        { error: "Satuan kerja dengan nama ini sudah ada" },
        { status: 409 }
      );
    }

    const unit = await prisma.satuanKerja.create({
      data: {
        name,
        groqApiKey: encryptApiKey(groqApiKey),
      },
    });

    return NextResponse.json(
      {
        unit: {
          id: unit.id,
          name: unit.name,
          createdAt: unit.createdAt,
          groqApiKeyMasked: maskPlaintextGroqApiKey(groqApiKey),
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("Satuan kerja create error:", err);
    return NextResponse.json(
      { error: "Failed to create satuan kerja" },
      { status: 500 }
    );
  }
}

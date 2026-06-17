import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptApiKey, decryptApiKey } from "@/lib/crypto";
import { requireAdmin } from "@/lib/require-admin";

function maskGroqApiKey(encryptedKey: string | null): string | null {
  if (!encryptedKey) return null;
  const plaintext = decryptApiKey(encryptedKey);
  if (plaintext.length <= 4) return "•".repeat(plaintext.length);
  return "•".repeat(plaintext.length - 4) + plaintext.slice(-4);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const groqApiKeyPlain =
      body.groqApiKey === null || body.groqApiKey === undefined
        ? null
        : typeof body.groqApiKey === "string"
          ? body.groqApiKey.trim() || null
          : null;

    const existing = await prisma.satuanKerja.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Satuan kerja tidak ditemukan" },
        { status: 404 }
      );
    }

    const updated = await prisma.satuanKerja.update({
      where: { id },
      data: {
        groqApiKey: groqApiKeyPlain ? encryptApiKey(groqApiKeyPlain) : null,
      },
      select: { id: true, name: true, createdAt: true, groqApiKey: true },
    });

    return NextResponse.json({
      unit: {
        id: updated.id,
        name: updated.name,
        createdAt: updated.createdAt,
        groqApiKeyMasked: maskGroqApiKey(updated.groqApiKey),
      },
    });
  } catch (err) {
    console.error("Satuan kerja PATCH error:", err);
    return NextResponse.json(
      { error: "Failed to update satuan kerja" },
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

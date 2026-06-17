import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export async function writeAuditLog({
  type,
  action,
  userId,
  metadata,
}: {
  type: "JOB" | "AUTH" | "ADMIN" | "ERROR";
  action: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        type,
        action,
        userId: userId ?? null,
        metadata: metadata ? (metadata as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch {
    // Audit logging must never crash the main flow.
  }
}

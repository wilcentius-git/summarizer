import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";

/**
 * Ensures a User row exists with primary key = NIP (required for SummaryJob FKs).
 * `displayName` is stored when provided (e.g. from Simpeg or admin login).
 */
export async function ensureUserForNip(
  nip: string,
  displayName?: string | null
) {
  const id = nip.trim();
  const name =
    displayName != null && String(displayName).trim() !== ""
      ? String(displayName).trim()
      : null;

  return prisma.user.upsert({
    where: { id },
    create: {
      id,
      email: id,
      name: name ?? undefined,
      passwordHash: await hashPassword(`simpeg:${id}:no-local-login`),
    },
    update: name != null ? { name } : {},
  });
}

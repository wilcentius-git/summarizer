import { prisma } from "@/lib/prisma";

/** NIPs whose summary jobs the given user may access. `null` means no filter (all jobs). */
export async function getVisibleUserIds(userId: string): Promise<string[] | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true },
  });

  if (user?.isAdmin) {
    return null;
  }

  const entry = await prisma.whitelist.findUnique({
    where: { nip: userId },
    select: { satuanKerjaId: true },
  });

  if (!entry?.satuanKerjaId) {
    return [userId];
  }

  const peers = await prisma.whitelist.findMany({
    where: { satuanKerjaId: entry.satuanKerjaId },
    select: { nip: true },
  });

  return peers.map((p) => p.nip);
}

export async function jobVisibilityWhere(userId: string) {
  const visibleUserIds = await getVisibleUserIds(userId);
  if (visibleUserIds === null) {
    return {};
  }
  return { userId: { in: visibleUserIds } };
}

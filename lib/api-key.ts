import type { ApiKey } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export async function validateApiKey(rawKey: string): Promise<ApiKey | null> {
  const key = rawKey.trim();
  if (!key) return null;

  const record = await prisma.apiKey.findUnique({ where: { key } });
  if (!record) return null;

  await prisma.apiKey.update({
    where: { id: record.id },
    data: { lastUsed: new Date() },
  });

  return record;
}

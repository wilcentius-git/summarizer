#!/usr/bin/env npx tsx
/**
 * Generate a new API key for server-to-server access.
 * Usage: npx tsx scripts/generate-api-key.ts "Sistem ABC"
 */
import path from "path";
import { randomBytes } from "crypto";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config({ path: path.join(__dirname, "../.env.local") });

const prisma = new PrismaClient();

function generateKey(): string {
  return `sk-${randomBytes(32).toString("hex")}`;
}

async function main() {
  const name = process.argv.slice(2).join(" ").trim();
  if (!name) {
    console.error('Usage: npx tsx scripts/generate-api-key.ts "Sistem ABC"');
    process.exit(1);
  }

  const key = generateKey();
  const record = await prisma.apiKey.create({
    data: { key, name },
  });

  console.log(`API key created: ${record.name} (id: ${record.id})`);
  console.log("");
  console.log(key);
  console.log("");
  console.warn("Save this key now — it will not be shown again.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

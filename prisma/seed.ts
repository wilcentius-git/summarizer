import path from "path";
import { config } from "dotenv";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

config({ path: path.join(__dirname, "../.env.local") });

const prisma = new PrismaClient();

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

const adminPassword = process.env.SEED_ADMIN_PASSWORD;
if (!adminPassword) {
  throw new Error("SEED_ADMIN_PASSWORD environment variable is not set");
}

const admins = [
  {
    nip: "admin",
    password: adminPassword,
    displayName: "Administrator",
  },
];

const satuanKerjaEntries = [
  { id: "tu-menteri", name: "TU Menteri" },
  { id: "tu-sekjen", name: "TU Sekjen" },
];

async function main() {
  console.log("Seeding admin users...");

  for (const admin of admins) {
    const id = admin.nip.trim();
    await prisma.user.upsert({
      where: { id },
      create: {
        id,
        email: id,
        name: admin.displayName,
        passwordHash: await hashPassword(admin.password),
        isAdmin: true,
      },
      update: {
        name: admin.displayName,
        passwordHash: await hashPassword(admin.password),
        isAdmin: true,
      },
    });
    console.log(`✔ Admin user seeded: ${id}`);
  }

  console.log("Seeding satuan kerja...");

  for (const unit of satuanKerjaEntries) {
    await prisma.satuanKerja.upsert({
      where: { id: unit.id },
      create: { id: unit.id, name: unit.name },
      update: { name: unit.name },
    });
    console.log(`✔ Satuan kerja seeded: ${unit.name}`);
  }

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

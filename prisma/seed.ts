import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

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

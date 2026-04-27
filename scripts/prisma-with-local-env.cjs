/**
 * Loads .env.local then runs the Prisma CLI. Prisma only auto-loads .env, not .env.local.
 * Usage: node scripts/prisma-with-local-env.cjs migrate dev
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const { execSync } = require("child_process");
const args = process.argv.slice(2).join(" ");
execSync(`npx prisma ${args}`, { stdio: "inherit", env: process.env, shell: true });

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "@/generated/prisma/client";
import { loadEnv, optionalEnv } from "@/lib/env";

loadEnv();

// Prefer DATABASE_URL from .env. The default matches .env.example so the CLI
// (`prisma db push`) and the runtime driver adapter open the same file.
const url = optionalEnv("DATABASE_URL") ?? "file:./prisma/dev.db";

function createClient() {
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

// Next.js dev mode re-evaluates modules on every edit; without a global cache
// each reload would open another SQLite connection.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

import { defineConfig } from "prisma/config";

import { loadEnv } from "./src/lib/env";

// The Prisma CLI runs outside Next.js, so nothing has loaded .env for us yet.
loadEnv();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "file:./prisma/dev.db",
  },
});

import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  // Migrations take a session-level advisory lock, which connection poolers
  // (Neon's -pooler endpoint, pgbouncer) don't support; use the direct URL.
  datasource: { url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL! },
});

import { existsSync } from "node:fs";
import { resolve } from "node:path";

let loaded = false;

/**
 * Loads `.env` for processes Next.js does not bootstrap (the Prisma CLI and the
 * seed script). Next.js already handles this for the app itself, so the second
 * call is a no-op.
 */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

  for (const file of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    try {
      process.loadEnvFile(path);
    } catch {
      // Malformed or unreadable .env should not stop the CLI; callers fall
      // back to their own defaults.
    }
  }
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function numberEnv(name: string, fallback: number): number {
  const raw = optionalEnv(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

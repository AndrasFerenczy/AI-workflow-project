import { prisma } from "@/lib/db";
import { optionalEnv } from "@/lib/env";

/** Keys we persist from the welcome / settings UI. */
export const SETTING_KEYS = {
  openaiApiKey: "openai_api_key",
  anthropicApiKey: "anthropic_api_key",
  deepseekApiKey: "deepseek_api_key",
  setupCompleted: "setup_completed",
} as const;

type Cache = Record<string, string>;

let cache: Cache = {};
let loaded = false;

export async function refreshSettingsCache(): Promise<void> {
  const rows = await prisma.appSetting.findMany();
  cache = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  loaded = true;
}

/** Ensure the in-memory cache mirrors the DB (once per process / after writes). */
export async function ensureSettingsLoaded(): Promise<void> {
  if (!loaded) await refreshSettingsCache();
}

export function getCachedSetting(key: string): string | undefined {
  const value = cache[key];
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function hasExplicitSetting(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(cache, key);
}

export async function getSetting(key: string): Promise<string | undefined> {
  await ensureSettingsLoaded();
  return getCachedSetting(key);
}

/**
 * Persist settings. `null` deletes the row (env fallback applies again).
 * Empty string keeps a row so Clear can override a key that also exists in `.env`.
 */
export async function setSettings(entries: Record<string, string | null>): Promise<void> {
  await prisma.$transaction(
    Object.entries(entries).map(([key, value]) => {
      if (value === null) {
        return prisma.appSetting.deleteMany({ where: { key } });
      }
      return prisma.appSetting.upsert({
        where: { key },
        create: { key, value: value.trim() },
        update: { value: value.trim() },
      });
    }),
  );
  await refreshSettingsCache();
}

/**
 * DB value wins when the setting row exists (including an explicit Clear).
 * Otherwise fall back to the env var.
 */
function resolveProviderKey(settingKey: string, envName: string): string | undefined {
  if (hasExplicitSetting(settingKey)) {
    return getCachedSetting(settingKey);
  }
  return optionalEnv(envName);
}

export function resolveOpenAIApiKey(): string | undefined {
  return resolveProviderKey(SETTING_KEYS.openaiApiKey, "OPENAI_API_KEY");
}

export function resolveAnthropicApiKey(): string | undefined {
  return resolveProviderKey(SETTING_KEYS.anthropicApiKey, "ANTHROPIC_API_KEY");
}

export function resolveDeepSeekApiKey(): string | undefined {
  return resolveProviderKey(SETTING_KEYS.deepseekApiKey, "DEEPSEEK_API_KEY");
}

export function isSetupCompleted(): boolean {
  return getCachedSetting(SETTING_KEYS.setupCompleted) === "true";
}

export function maskSecret(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 3)}…${value.slice(-4)}`;
}

export interface PublicSettings {
  setupCompleted: boolean;
  openaiConfigured: boolean;
  anthropicConfigured: boolean;
  deepseekConfigured: boolean;
  openaiKeyMasked: string | null;
  anthropicKeyMasked: string | null;
  deepseekKeyMasked: string | null;
  /** True when at least one provider key is configured. */
  ready: boolean;
}

export async function getPublicSettings(): Promise<PublicSettings> {
  await ensureSettingsLoaded();
  const openai = resolveOpenAIApiKey();
  const anthropic = resolveAnthropicApiKey();
  const deepseek = resolveDeepSeekApiKey();
  return {
    setupCompleted: isSetupCompleted(),
    openaiConfigured: Boolean(openai),
    anthropicConfigured: Boolean(anthropic),
    deepseekConfigured: Boolean(deepseek),
    openaiKeyMasked: maskSecret(openai),
    anthropicKeyMasked: maskSecret(anthropic),
    deepseekKeyMasked: maskSecret(deepseek),
    ready: Boolean(openai || anthropic || deepseek),
  };
}

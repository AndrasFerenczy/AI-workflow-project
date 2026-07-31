import { anthropicProvider } from "./anthropic";
import { deepseekProvider } from "./deepseek";
import { openaiProvider } from "./openai";
import { ensureSettingsLoaded } from "@/lib/settings";
import { LLMError, type LLMProvider, type ModelInfo, type ProviderId } from "./types";

/**
 * Provider registry. Adding a provider means writing an adapter that satisfies
 * `LLMProvider` and listing it here; nothing else in the app changes.
 */
const PROVIDERS: LLMProvider[] = [openaiProvider, anthropicProvider, deepseekProvider];

const BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  models: ModelInfo[];
  defaultModel: string;
  apiKeyEnvVar: string;
  /** False when the API key is missing, so the UI can explain why. */
  configured: boolean;
  blurb?: string;
}

export function listProviders(): LLMProvider[] {
  return PROVIDERS;
}

export async function describeProviders(): Promise<ProviderDescriptor[]> {
  await ensureSettingsLoaded();
  return PROVIDERS.map((provider) => ({
    id: provider.id,
    label: provider.label,
    models: provider.models,
    defaultModel: provider.defaultModel,
    apiKeyEnvVar: provider.apiKeyEnvVar,
    configured: provider.isConfigured(),
    blurb: provider.blurb,
  }));
}

export function isProviderId(value: string): value is ProviderId {
  return BY_ID.has(value as ProviderId);
}

/** Throws a user-facing error when the provider is unknown or unconfigured. */
export async function getProvider(id: string): Promise<LLMProvider> {
  await ensureSettingsLoaded();
  // Legacy "free" workflows fall back to whichever paid provider is configured.
  const resolvedId = id === "free" ? (await defaultProviderSelection()).provider : id;
  const provider = BY_ID.get(resolvedId as ProviderId);
  if (!provider) {
    const known = PROVIDERS.map((entry) => entry.id).join(", ");
    throw new LLMError(`Unknown provider "${id}". Available: ${known}.`, "openai");
  }
  if (!provider.isConfigured()) {
    throw new LLMError(
      `${provider.label} is not configured. Add a key on the welcome screen or set ${provider.apiKeyEnvVar}.`,
      provider.id,
    );
  }
  return provider;
}

/** The provider a brand new workflow should default to. */
export async function defaultProviderSelection(): Promise<{
  provider: ProviderId;
  model: string;
}> {
  await ensureSettingsLoaded();
  const preferred =
    PROVIDERS.find((provider) => provider.isConfigured()) ?? openaiProvider;
  return { provider: preferred.id, model: preferred.defaultModel };
}

export * from "./types";

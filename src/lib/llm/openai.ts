import { optionalEnv } from "@/lib/env";
import { ensureSettingsLoaded, resolveOpenAIApiKey } from "@/lib/settings";

import { createOpenAICompatibleProvider } from "./openai-compatible";

export const openaiProvider = createOpenAICompatibleProvider({
  id: "openai",
  label: "OpenAI",
  models: [
    { id: "gpt-4o-mini", label: "GPT-4o mini", note: "Fast and cheap, good default" },
    { id: "gpt-4o", label: "GPT-4o", note: "Stronger reasoning" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
  ],
  defaultModel: "gpt-4o-mini",
  apiKeyEnvVar: "OPENAI_API_KEY",
  baseURL: () => optionalEnv("OPENAI_BASE_URL"),
  resolveApiKey: resolveOpenAIApiKey,
  ensureReady: ensureSettingsLoaded,
});

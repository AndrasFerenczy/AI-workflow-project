import { optionalEnv } from "@/lib/env";
import { ensureSettingsLoaded, resolveDeepSeekApiKey } from "@/lib/settings";

import { createOpenAICompatibleProvider } from "./openai-compatible";

const DEFAULT_BASE_URL = "https://api.deepseek.com";

export const deepseekProvider = createOpenAICompatibleProvider({
  id: "deepseek",
  label: "DeepSeek",
  models: [
    {
      id: "deepseek-v4-flash",
      label: "DeepSeek V4 Flash",
      note: "Fast and affordable default",
    },
    {
      id: "deepseek-v4-pro",
      label: "DeepSeek V4 Pro",
      note: "Stronger reasoning / coding",
    },
  ],
  defaultModel: "deepseek-v4-flash",
  apiKeyEnvVar: "DEEPSEEK_API_KEY",
  baseURL: () => optionalEnv("DEEPSEEK_BASE_URL") ?? DEFAULT_BASE_URL,
  resolveApiKey: resolveDeepSeekApiKey,
  ensureReady: ensureSettingsLoaded,
  blurb: "OpenAI-compatible API at api.deepseek.com. Get a key from platform.deepseek.com.",
});

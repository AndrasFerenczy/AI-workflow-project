import { NextResponse } from "next/server";
import { z } from "zod";

import { handle, parseBody } from "@/lib/api";
import {
  SETTING_KEYS,
  getPublicSettings,
  setSettings,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  return NextResponse.json({ settings: await getPublicSettings() });
});

const updateSchema = z.object({
  openaiApiKey: z.string().max(200).nullish(),
  anthropicApiKey: z.string().max(200).nullish(),
  deepseekApiKey: z.string().max(200).nullish(),
  clearOpenAI: z.boolean().optional(),
  clearAnthropic: z.boolean().optional(),
  clearDeepSeek: z.boolean().optional(),
  /** Mark the welcome screen as completed. */
  setupCompleted: z.boolean().optional(),
});

export const PUT = handle(async (request: Request) => {
  const body = await parseBody(request, updateSchema);
  if (!body.ok) return body.response;

  const updates: Record<string, string | null> = {};

  if (body.data.clearOpenAI) {
    // Empty string = explicit clear (blocks .env fallback). null would restore env.
    updates[SETTING_KEYS.openaiApiKey] = "";
  } else if (body.data.openaiApiKey != null && body.data.openaiApiKey.trim() !== "") {
    updates[SETTING_KEYS.openaiApiKey] = body.data.openaiApiKey;
  }

  if (body.data.clearAnthropic) {
    updates[SETTING_KEYS.anthropicApiKey] = "";
  } else if (body.data.anthropicApiKey != null && body.data.anthropicApiKey.trim() !== "") {
    updates[SETTING_KEYS.anthropicApiKey] = body.data.anthropicApiKey;
  }

  if (body.data.clearDeepSeek) {
    updates[SETTING_KEYS.deepseekApiKey] = "";
  } else if (body.data.deepseekApiKey != null && body.data.deepseekApiKey.trim() !== "") {
    updates[SETTING_KEYS.deepseekApiKey] = body.data.deepseekApiKey;
  }

  if (body.data.setupCompleted === true) {
    updates[SETTING_KEYS.setupCompleted] = "true";
  } else if (body.data.setupCompleted === false) {
    updates[SETTING_KEYS.setupCompleted] = null;
  }

  if (Object.keys(updates).length > 0) {
    await setSettings(updates);
  }

  return NextResponse.json({ settings: await getPublicSettings() });
});

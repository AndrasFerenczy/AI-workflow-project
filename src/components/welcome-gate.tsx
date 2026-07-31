"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/primitives";
import { apiGet, apiSend } from "@/lib/client";
import type { PublicSettings } from "@/lib/settings";

export function WelcomeGate({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [deepseekKey, setDeepseekKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ settings: PublicSettings }>("/api/settings");
      setSettings(data.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings.");
      setSettings({
        setupCompleted: true,
        openaiConfigured: false,
        anthropicConfigured: false,
        deepseekConfigured: false,
        openaiKeyMasked: null,
        anthropicKeyMasked: null,
        deepseekKeyMasked: null,
        ready: true,
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveKeys() {
    setSaving(true);
    setError(null);
    try {
      const data = await apiSend<{ settings: PublicSettings }>("/api/settings", "PUT", {
        openaiApiKey: openaiKey.trim() || undefined,
        anthropicApiKey: anthropicKey.trim() || undefined,
        deepseekApiKey: deepseekKey.trim() || undefined,
        setupCompleted: true,
      });
      setSettings(data.settings);
      setOpenaiKey("");
      setAnthropicKey("");
      setDeepseekKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save keys.");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (settings.setupCompleted) {
    return children;
  }

  const canSave = Boolean(openaiKey.trim() || anthropicKey.trim() || deepseekKey.trim());

  return (
    <div className="relative flex flex-1 flex-col">
      <div className="pointer-events-none absolute inset-0 opacity-40 blur-sm">{children}</div>
      <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/80 p-6 backdrop-blur-md">
        <div className="animate-slide-up w-full max-w-xl space-y-6 rounded-3xl border border-border bg-surface p-6 shadow-xl shadow-black/10 sm:p-8">
          <div className="space-y-2 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
              <KeyRound className="size-6" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Welcome to Workflow Studio</h1>
            <p className="text-sm leading-relaxed text-muted">
              Paste an OpenAI, Anthropic, or DeepSeek API key to get started. At least one is
              required — you can change keys later in Settings.
            </p>
          </div>

          {error ? (
            <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
              {error}
            </div>
          ) : null}

          <div className="space-y-4 rounded-2xl border border-border bg-background/50 p-4">
            <Field label="OpenAI API key" htmlFor="openai-key">
              <Input
                id="openai-key"
                type="password"
                autoComplete="off"
                placeholder="sk-…"
                value={openaiKey}
                onChange={(event) => setOpenaiKey(event.target.value)}
              />
            </Field>
            <Field label="Anthropic API key" htmlFor="anthropic-key">
              <Input
                id="anthropic-key"
                type="password"
                autoComplete="off"
                placeholder="sk-ant-…"
                value={anthropicKey}
                onChange={(event) => setAnthropicKey(event.target.value)}
              />
            </Field>
            <Field label="DeepSeek API key" htmlFor="deepseek-key">
              <Input
                id="deepseek-key"
                type="password"
                autoComplete="off"
                placeholder="sk-…"
                value={deepseekKey}
                onChange={(event) => setDeepseekKey(event.target.value)}
              />
            </Field>
            <Button
              variant="primary"
              className="w-full"
              loading={saving}
              disabled={!canSave}
              onClick={() => void saveKeys()}
            >
              <Check className="size-4" />
              Save and continue
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

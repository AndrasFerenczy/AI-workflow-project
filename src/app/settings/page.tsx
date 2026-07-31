"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/primitives";
import { apiGet, apiSend } from "@/lib/client";
import type { PublicSettings } from "@/lib/settings";

export default function SettingsPage() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [deepseekKey, setDeepseekKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ settings: PublicSettings }>("/api/settings");
      setSettings(data.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
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
      setMessage("Settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function clearKey(which: "openai" | "anthropic" | "deepseek") {
    setSaving(true);
    setError(null);
    try {
      const data = await apiSend<{ settings: PublicSettings }>("/api/settings", "PUT", {
        clearOpenAI: which === "openai",
        clearAnthropic: which === "anthropic",
        clearDeepSeek: which === "deepseek",
      });
      setSettings(data.settings);
      setMessage(
        which === "openai"
          ? "OpenAI key cleared."
          : which === "anthropic"
            ? "Anthropic key cleared."
            : "DeepSeek key cleared.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clear failed.");
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

  const anyConfigured =
    settings.openaiConfigured || settings.anthropicConfigured || settings.deepseekConfigured;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 px-6 py-8 animate-fade-in">
      <PageHeader
        title="Settings"
        description="API keys are stored in the app database (and Docker volume). Env vars still work as a fallback."
      />

      {error ? (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          {message}
        </div>
      ) : null}

      <section className="space-y-4 rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-muted" />
          <h2 className="text-sm font-semibold">Provider keys</h2>
        </div>

        <Field
          label="OpenAI"
          htmlFor="settings-openai"
          description={
            settings.openaiConfigured
              ? `Saved key: ${settings.openaiKeyMasked}`
              : "Not configured"
          }
        >
          <div className="flex gap-2">
            <Input
              id="settings-openai"
              type="password"
              className="flex-1"
              placeholder="sk-…"
              value={openaiKey}
              onChange={(event) => setOpenaiKey(event.target.value)}
            />
            {settings.openaiConfigured ? (
              <Button variant="ghost" disabled={saving} onClick={() => void clearKey("openai")}>
                Clear
              </Button>
            ) : null}
          </div>
        </Field>

        <Field
          label="Anthropic"
          htmlFor="settings-anthropic"
          description={
            settings.anthropicConfigured
              ? `Saved key: ${settings.anthropicKeyMasked}`
              : "Not configured"
          }
        >
          <div className="flex gap-2">
            <Input
              id="settings-anthropic"
              type="password"
              className="flex-1"
              placeholder="sk-ant-…"
              value={anthropicKey}
              onChange={(event) => setAnthropicKey(event.target.value)}
            />
            {settings.anthropicConfigured ? (
              <Button
                variant="ghost"
                disabled={saving}
                onClick={() => void clearKey("anthropic")}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </Field>

        <Field
          label="DeepSeek"
          htmlFor="settings-deepseek"
          description={
            settings.deepseekConfigured
              ? `Saved key: ${settings.deepseekKeyMasked}`
              : "Not configured — platform.deepseek.com"
          }
        >
          <div className="flex gap-2">
            <Input
              id="settings-deepseek"
              type="password"
              className="flex-1"
              placeholder="sk-…"
              value={deepseekKey}
              onChange={(event) => setDeepseekKey(event.target.value)}
            />
            {settings.deepseekConfigured ? (
              <Button
                variant="ghost"
                disabled={saving}
                onClick={() => void clearKey("deepseek")}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </Field>

        <Button variant="primary" loading={saving} onClick={() => void save()}>
          Save keys
        </Button>
      </section>

      {!anyConfigured ? (
        <EmptyState
          title="No providers configured"
          description="Add an OpenAI, Anthropic, or DeepSeek API key above to run workflows."
        />
      ) : null}
    </div>
  );
}

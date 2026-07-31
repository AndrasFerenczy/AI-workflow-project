"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Inbox, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Badge,
  CodeBlock,
  EmptyState,
  PageHeader,
  Spinner,
} from "@/components/ui/primitives";
import { apiGet } from "@/lib/client";
import { formatRelativeTime } from "@/lib/utils";
import type { EmailDTO } from "@/lib/workflow/dto";

export default function OutboxPage() {
  const [emails, setEmails] = useState<EmailDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ emails: EmailDTO[] }>("/api/emails");
      setEmails(data.emails);
      setSelectedId((current) => current ?? data.emails[0]?.id ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load outbox.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = emails?.find((email) => email.id === selectedId) ?? null;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 px-6 py-8 animate-fade-in">
      <PageHeader
        title="Outbox"
        description="The mock email sender writes here instead of delivering anything. Useful for inspecting what a workflow would have sent."
      />

      {error ? (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {emails === null ? (
        <div className="flex justify-center py-20">
          <Spinner className="size-6" />
        </div>
      ) : emails.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-5" />}
          title="Outbox is empty"
          description="Enable the send_email tool on a workflow (the Support Triage demo does) and ask it to email someone."
          action={
            <Link href="/">
              <Button variant="secondary">Browse workflows</Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <div className="space-y-2">
            {emails.map((email) => (
              <button
                key={email.id}
                type="button"
                onClick={() => setSelectedId(email.id)}
                className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                  selectedId === email.id
                    ? "border-accent bg-accent-soft/40"
                    : "border-border bg-surface hover:border-border-strong"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-raised text-muted">
                    <Mail className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{email.subject}</p>
                    <p className="truncate text-xs text-subtle">To {email.to}</p>
                    <p className="mt-1 text-[11px] text-subtle">
                      {formatRelativeTime(email.createdAt)}
                      {email.workflowName ? ` · ${email.workflowName}` : ""}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {selected ? (
            <article className="animate-fade-in space-y-4 rounded-2xl border border-border bg-surface p-5">
              <div className="space-y-2">
                <h2 className="text-base font-semibold">{selected.subject}</h2>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="info">to: {selected.to}</Badge>
                  {selected.workflowName ? (
                    <Badge tone="neutral">{selected.workflowName}</Badge>
                  ) : null}
                  {selected.runId ? (
                    <Link href={`/runs/${selected.runId}`}>
                      <Badge tone="accent">View run</Badge>
                    </Link>
                  ) : null}
                </div>
                <p className="text-xs text-subtle">
                  {new Date(selected.createdAt).toLocaleString()}
                </p>
              </div>
              <CodeBlock value={selected.body} maxHeight="28rem" />
            </article>
          ) : null}
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { RunTrace } from "@/components/run-trace";
import { MarkdownContent } from "@/components/markdown-content";
import { Button } from "@/components/ui/button";
import {
  Badge,
  CodeBlock,
  EmptyState,
  PageHeader,
  Spinner,
} from "@/components/ui/primitives";
import { apiGet } from "@/lib/client";
import { formatDuration, formatRelativeTime } from "@/lib/utils";
import type { RunDetailDTO } from "@/lib/workflow/dto";

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const [run, setRun] = useState<RunDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ run: RunDetailDTO }>(`/api/runs/${params.id}`);
      setRun(data.run);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load run.");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16">
        <EmptyState
          title="Run not found"
          description={error ?? undefined}
          action={
            <Link href="/runs">
              <Button variant="secondary">Back to history</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-6 py-8 animate-fade-in">
      <PageHeader
        breadcrumb={
          <Link
            href="/runs"
            className="inline-flex items-center gap-1.5 text-xs text-subtle hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            History
          </Link>
        }
        title={run.workflowName}
        description={`Run from ${formatRelativeTime(run.createdAt)}`}
        actions={
          <Link href={`/workflows/${run.workflowId}/chat`}>
            <Button variant="secondary">Open chat</Button>
          </Link>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Badge
          tone={
            run.status === "succeeded"
              ? "success"
              : run.status === "failed"
                ? "danger"
                : "warning"
          }
        >
          {run.status}
        </Badge>
        <Badge tone="neutral">
          {run.provider} · {run.model}
        </Badge>
        <Badge tone="info">{formatDuration(run.durationMs)}</Badge>
        {run.totalTokens != null ? (
          <Badge tone="neutral">{run.totalTokens} tokens</Badge>
        ) : null}
        <Badge tone="accent">
          {run.toolCallCount} tool call{run.toolCallCount === 1 ? "" : "s"}
        </Badge>
      </div>

      {run.error ? (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {run.error}
        </div>
      ) : null}

      <section className="space-y-2 rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold">Input</h2>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">
          {run.input}
        </p>
      </section>

      <section className="space-y-2 rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold">Output</h2>
        {run.output ? (
          <MarkdownContent content={run.output} />
        ) : (
          <CodeBlock value="(no output)" />
        )}
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold">Trace</h2>
        <RunTrace events={run.events} />
      </section>
    </div>
  );
}

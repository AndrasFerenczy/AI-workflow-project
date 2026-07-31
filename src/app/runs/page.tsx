"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { History } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader, Spinner } from "@/components/ui/primitives";
import { apiGet } from "@/lib/client";
import { formatDuration, formatRelativeTime, truncate } from "@/lib/utils";
import type { RunSummaryDTO } from "@/lib/workflow/dto";

export default function RunsPage() {
  const [runs, setRuns] = useState<RunSummaryDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ runs: RunSummaryDTO[] }>("/api/runs");
      setRuns(data.runs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load runs.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 px-6 py-8 animate-fade-in">
      <PageHeader
        title="Execution history"
        description="Every workflow run is persisted with its full event trace."
      />

      {error ? (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {runs === null ? (
        <div className="flex justify-center py-20">
          <Spinner className="size-6" />
        </div>
      ) : runs.length === 0 ? (
        <EmptyState
          icon={<History className="size-5" />}
          title="No runs yet"
          description="Chat with a workflow and every execution will show up here."
          action={
            <Link href="/">
              <Button variant="secondary">Browse workflows</Button>
            </Link>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface text-xs text-subtle">
              <tr>
                <th className="px-4 py-3 font-medium">Workflow</th>
                <th className="px-4 py-3 font-medium">Input</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Duration</th>
                <th className="px-4 py-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.id}
                  className="border-b border-border/70 bg-background/30 transition-colors hover:bg-surface-raised/60"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/runs/${run.id}`}
                      className="font-medium hover:text-accent"
                    >
                      {run.workflowName}
                    </Link>
                    <p className="mt-0.5 text-[11px] text-subtle">
                      {run.provider} · {run.model}
                    </p>
                  </td>
                  <td className="max-w-xs px-4 py-3 text-muted">
                    <Link href={`/runs/${run.id}`} className="hover:text-foreground">
                      {truncate(run.input, 90)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
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
                    {run.toolCallCount > 0 ? (
                      <span className="ml-2 text-[11px] text-subtle">
                        {run.toolCallCount} tools
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-subtle">
                    {formatDuration(run.durationMs)}
                  </td>
                  <td className="px-4 py-3 text-subtle">
                    {formatRelativeTime(run.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

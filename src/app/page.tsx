"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Copy,
  MessageSquare,
  Plus,
  Trash2,
  Workflow as WorkflowIcon,
} from "lucide-react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Badge, EmptyState, PageHeader, Spinner } from "@/components/ui/primitives";
import { ApiError, apiGet, apiSend } from "@/lib/client";
import type { WorkflowSummaryDTO } from "@/lib/workflow/dto";

export default function HomePage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowSummaryDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ workflows: WorkflowSummaryDTO[] }>("/api/workflows");
      setWorkflows(data.workflows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workflows.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createWorkflow() {
    const trimmed = name.trim() || "Untitled workflow";
    setCreating(true);
    try {
      const data = await apiSend<{ workflow: { id: string } }>("/api/workflows", "POST", {
        name: trimmed,
      });
      router.push(`/workflows/${data.workflow.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create workflow.");
      setCreating(false);
    }
  }

  async function duplicateWorkflow(id: string) {
    setBusyId(id);
    try {
      const data = await apiSend<{ workflow: { id: string } }>(
        `/api/workflows/${id}/duplicate`,
        "POST",
      );
      router.push(`/workflows/${data.workflow.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Duplicate failed.");
      setBusyId(null);
    }
  }

  async function confirmDeleteWorkflow() {
    if (!pendingDelete) return;
    const { id } = pendingDelete;
    setBusyId(id);
    try {
      await apiSend(`/api/workflows/${id}`, "DELETE");
      setWorkflows((current) => current?.filter((item) => item.id !== id) ?? null);
      setPendingDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 px-6 py-8 animate-fade-in">
      <ConfirmDialog
        open={pendingDelete != null}
        title={`Delete “${pendingDelete?.name ?? "workflow"}”?`}
        description="This permanently removes the workflow and its chat history. This cannot be undone."
        busy={busyId === pendingDelete?.id}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDeleteWorkflow()}
      />
      <PageHeader
        title="Workflows"
        description="Configure an AI system from a prompt, tools and decision steps — then chat with it."
        actions={
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void createWorkflow();
            }}
          >
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="New workflow name"
              className="w-52"
              aria-label="New workflow name"
            />
            <Button type="submit" variant="primary" loading={creating}>
              <Plus className="size-4" />
              Create
            </Button>
          </form>
        }
      />

      {error ? (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {workflows === null ? (
        <div className="flex justify-center py-20">
          <Spinner className="size-6" />
        </div>
      ) : workflows.length === 0 ? (
        <EmptyState
          icon={<WorkflowIcon className="size-5" />}
          title="No workflows yet"
          description="Create one to get started, or run npm run db:seed to load the three demo workflows."
          action={
            <Button variant="primary" onClick={() => void createWorkflow()} loading={creating}>
              <Plus className="size-4" />
              Create your first workflow
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {workflows.map((workflow, index) => (
            <article
              key={workflow.id}
              className="group animate-slide-up rounded-2xl border border-border bg-surface p-5 transition-colors hover:border-border-strong hover:bg-surface-raised"
              style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <Link
                    href={`/workflows/${workflow.id}`}
                    className="focus-ring block truncate text-base font-semibold tracking-tight hover:text-accent"
                  >
                    {workflow.name}
                  </Link>
                  <p className="line-clamp-2 text-xs leading-relaxed text-subtle">
                    {workflow.description || "No description"}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-1.5">
                <Badge tone="info">{workflow.model}</Badge>
                <Badge tone="accent">
                  {workflow.stepCount === 0
                    ? "Implicit agent"
                    : `${workflow.stepCount} step${workflow.stepCount === 1 ? "" : "s"}`}
                </Badge>
                <Badge tone="neutral">
                  {workflow.enabledToolKeys.length} tool
                  {workflow.enabledToolKeys.length === 1 ? "" : "s"}
                </Badge>
              </div>

              <div className="mt-5 flex items-center gap-2 border-t border-border pt-4">
                <Link href={`/workflows/${workflow.id}/chat`} className="min-w-0 flex-1">
                  <Button size="sm" variant="primary" className="w-full justify-center">
                    <MessageSquare className="size-3.5" />
                    Chat
                  </Button>
                </Link>
                <Link href={`/workflows/${workflow.id}`} className="min-w-0 flex-1">
                  <Button size="sm" variant="secondary" className="w-full justify-center">
                    Edit
                  </Button>
                </Link>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Duplicate"
                  disabled={busyId === workflow.id}
                  onClick={() => void duplicateWorkflow(workflow.id)}
                >
                  <Copy className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Delete"
                  disabled={busyId === workflow.id}
                  onClick={() => setPendingDelete({ id: workflow.id, name: workflow.name })}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

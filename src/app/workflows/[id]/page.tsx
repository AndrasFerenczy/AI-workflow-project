"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  GripVertical,
  History,
  MessageSquare,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { resolveIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { Badge, EmptyState, PageHeader, Spinner } from "@/components/ui/primitives";
import type { ProviderDescriptor } from "@/lib/llm";
import type { ToolDescriptor } from "@/lib/tools/types";
import { ApiError, apiGet, apiSend } from "@/lib/client";
import { cn, formatRelativeTime, slugify, uniqueKey } from "@/lib/utils";
import type { WorkflowDTO, WorkflowStepDTO, WorkflowVersionSummaryDTO } from "@/lib/workflow/dto";
import {
  END_STEP,
  STEP_TYPES,
  STEP_TYPE_META,
  type Branch,
  type StepConfig,
  type StepType,
  validateSteps,
} from "@/lib/workflow/types";

type EditableStep = Omit<WorkflowStepDTO, "id" | "order"> & { id: string };

/** Bundled in the builder so users pick one “web research” switch, not two. */
const WEB_RESEARCH_TOOL_KEYS = ["web_search", "fetch_url"] as const;

type AgentToolToggle = {
  id: string;
  name: string;
  summary: string;
  keys: string[];
};

function agentToolToggles(tools: ToolDescriptor[]): AgentToolToggle[] {
  const available = new Set(tools.map((tool) => tool.key));
  const webKeys = WEB_RESEARCH_TOOL_KEYS.filter((key) => available.has(key));
  const toggles: AgentToolToggle[] = [];

  if (webKeys.length > 0) {
    toggles.push({
      id: "web_research",
      name: "Web research",
      summary: "Search the web and open pages for full text when snippets aren’t enough.",
      keys: webKeys,
    });
  }

  for (const tool of tools) {
    if ((WEB_RESEARCH_TOOL_KEYS as readonly string[]).includes(tool.key)) continue;
    toggles.push({
      id: tool.key,
      name: tool.name,
      summary: tool.summary,
      keys: [tool.key],
    });
  }

  return toggles;
}

function blankConfig(): StepConfig {
  return {
    toolKeys: [],
    branches: [],
    argumentMode: "llm",
    argumentTemplate: "",
  };
}

function toEditable(step: WorkflowStepDTO, enabledToolKeys: string[] = []): EditableStep {
  const storedKeys = step.config.toolKeys ?? [];
  // Legacy "empty = all workflow-enabled tools" → expand into explicit checkboxes.
  const toolKeys =
    step.type === "agent" && storedKeys.length === 0 ? [...enabledToolKeys] : storedKeys;

  return {
    id: step.id,
    key: step.key,
    type: step.type,
    name: step.name,
    instruction: step.instruction,
    toolKey: step.toolKey,
    config: {
      toolKeys,
      maxIterations: step.config.maxIterations,
      branches: step.config.branches ?? [],
      argumentMode: step.config.argumentMode ?? "llm",
      argumentTemplate: step.config.argumentTemplate ?? "",
    },
  };
}

function editableStepsFromWorkflow(workflow: WorkflowDTO): EditableStep[] {
  const enabledToolKeys = workflow.tools
    .filter((tool) => tool.enabled)
    .map((tool) => tool.toolKey);
  return workflow.steps.map((step) => toEditable(step, enabledToolKeys));
}

function SortableStepCard({
  step,
  selected,
  onSelect,
}: {
  step: EditableStep;
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.id,
  });
  const meta = STEP_TYPE_META[step.type];
  const Icon = resolveIcon(meta.icon);

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "flex items-stretch gap-1 rounded-xl border bg-surface transition-colors",
        selected ? "border-accent bg-accent-soft/40" : "border-border hover:border-border-strong",
        isDragging && "z-10 opacity-90 shadow-lg shadow-black/10",
      )}
    >
      <button
        type="button"
        className="flex cursor-grab items-center px-1.5 text-subtle active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-3 px-2 py-3 text-left"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-raised text-muted">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{step.name}</p>
          <p className="truncate font-mono text-[11px] text-subtle">
            {step.key} · {meta.label}
          </p>
        </div>
      </button>
    </div>
  );
}

function StepEditor({
  step,
  tools,
  allSteps,
  onChange,
  onDelete,
}: {
  step: EditableStep;
  tools: ToolDescriptor[];
  allSteps: EditableStep[];
  onChange: (next: EditableStep) => void;
  onDelete: () => void;
}) {
  const meta = STEP_TYPE_META[step.type];

  function updateConfig(patch: Partial<StepConfig>) {
    onChange({ ...step, config: { ...step.config, ...patch } });
  }

  function updateBranch(index: number, patch: Partial<Branch>) {
    const branches = step.config.branches.map((branch, i) =>
      i === index ? { ...branch, ...patch } : branch,
    );
    updateConfig({ branches });
  }

  return (
    <div className="animate-fade-in space-y-5 rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{step.name || "Untitled step"}</h3>
          <p className="mt-1 text-xs text-subtle">{meta.blurb}</p>
        </div>
        <Button size="sm" variant="danger" onClick={onDelete}>
          <Trash2 className="size-3.5" />
          Remove
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="step-name">
          <Input
            id="step-name"
            value={step.name}
            onChange={(event) => {
              const name = event.target.value;
              onChange({
                ...step,
                name,
                // Keep the key in sync until the user has typed a custom one.
                key: step.key === slugify(step.name) ? slugify(name) : step.key,
              });
            }}
          />
        </Field>
        <Field
          label="Key"
          htmlFor="step-key"
          description="Stable id used in templates and branch targets."
        >
          <Input
            id="step-key"
            value={step.key}
            onChange={(event) =>
              onChange({
                ...step,
                key: event.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9_]/g, "_")
                  .slice(0, 40),
              })
            }
          />
        </Field>
      </div>

      <Field label="Type" htmlFor="step-type">
        <Select
          id="step-type"
          value={step.type}
          onChange={(event) =>
            onChange({
              ...step,
              type: event.target.value as StepType,
              toolKey: event.target.value === "tool" ? step.toolKey ?? tools[0]?.key ?? null : null,
            })
          }
        >
          {STEP_TYPES.map((type) => (
            <option key={type} value={type}>
              {STEP_TYPE_META[type].label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Instruction"
        htmlFor="step-instruction"
        description="Supports {{input}} and {{steps.key.output}}."
      >
        <Textarea
          id="step-instruction"
          rows={5}
          value={step.instruction}
          onChange={(event) => onChange({ ...step, instruction: event.target.value })}
          placeholder="What should happen in this step?"
        />
      </Field>

      {step.type === "agent" ? (
        <div className="space-y-3">
          <p className="text-sm font-medium">Tools available in this step</p>
          <p className="text-xs text-subtle">
            Choose which tools this agent may call. Leave all off for a tools-free step.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {agentToolToggles(tools).map((toggle) => {
              const checked = toggle.keys.some((key) => step.config.toolKeys.includes(key));
              return (
                <label
                  key={toggle.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/40 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <span className="text-sm">{toggle.name}</span>
                    <p className="truncate text-[11px] text-subtle">{toggle.summary}</p>
                  </div>
                  <Switch
                    checked={checked}
                    onCheckedChange={(next) => {
                      const without = step.config.toolKeys.filter(
                        (item) => !toggle.keys.includes(item),
                      );
                      updateConfig({
                        toolKeys: next ? [...without, ...toggle.keys] : without,
                      });
                    }}
                    label={`Toggle ${toggle.name}`}
                  />
                </label>
              );
            })}
          </div>
          <Field label="Max iterations (optional)" htmlFor="step-iters">
            <Input
              id="step-iters"
              type="number"
              min={1}
              max={12}
              value={step.config.maxIterations ?? ""}
              placeholder="Inherit from workflow"
              onChange={(event) => {
                const value = event.target.value;
                updateConfig({
                  maxIterations: value === "" ? undefined : Number(value),
                });
              }}
            />
          </Field>
        </div>
      ) : null}

      {step.type === "tool" ? (
        <div className="space-y-4">
          <Field label="Tool" htmlFor="step-tool">
            <Select
              id="step-tool"
              value={step.toolKey ?? ""}
              onChange={(event) => onChange({ ...step, toolKey: event.target.value || null })}
            >
              <option value="">Select a tool…</option>
              {tools.map((tool) => (
                <option key={tool.key} value={tool.key}>
                  {tool.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Argument mode" htmlFor="arg-mode">
            <Select
              id="arg-mode"
              value={step.config.argumentMode}
              onChange={(event) =>
                updateConfig({
                  argumentMode: event.target.value as "llm" | "template",
                })
              }
            >
              <option value="llm">Let the model fill the arguments</option>
              <option value="template">Use a JSON template</option>
            </Select>
          </Field>
          {step.config.argumentMode === "template" ? (
            <Field
              label="Argument template"
              htmlFor="arg-template"
              description='JSON object. Example: {"query":"{{input}}"}'
            >
              <Textarea
                id="arg-template"
                rows={4}
                className="font-mono text-xs"
                value={step.config.argumentTemplate}
                onChange={(event) => updateConfig({ argumentTemplate: event.target.value })}
              />
            </Field>
          ) : null}
        </div>
      ) : null}

      {step.type === "decision" ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Branches</p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                updateConfig({
                  branches: [
                    ...step.config.branches,
                    {
                      label: `Branch ${step.config.branches.length + 1}`,
                      description: "",
                      target: allSteps.find((entry) => entry.id !== step.id)?.key ?? END_STEP,
                    },
                  ],
                })
              }
            >
              <Plus className="size-3.5" />
              Add branch
            </Button>
          </div>
          {step.config.branches.length === 0 ? (
            <p className="text-xs text-subtle">Add at least two branches for the model to choose from.</p>
          ) : null}
          {step.config.branches.map((branch, index) => (
            <div
              key={index}
              className="space-y-3 rounded-xl border border-border bg-background/40 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <Field label="Label" className="flex-1" htmlFor={`branch-label-${index}`}>
                  <Input
                    id={`branch-label-${index}`}
                    value={branch.label}
                    onChange={(event) => updateBranch(index, { label: event.target.value })}
                  />
                </Field>
                <Button
                  size="icon"
                  variant="ghost"
                  className="mt-6"
                  aria-label="Remove branch"
                  onClick={() =>
                    updateConfig({
                      branches: step.config.branches.filter((_, i) => i !== index),
                    })
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              <Field label="Description" htmlFor={`branch-desc-${index}`}>
                <Input
                  id={`branch-desc-${index}`}
                  value={branch.description}
                  onChange={(event) => updateBranch(index, { description: event.target.value })}
                  placeholder="When should the model pick this?"
                />
              </Field>
              <Field label="Jump to" htmlFor={`branch-target-${index}`}>
                <Select
                  id={`branch-target-${index}`}
                  value={branch.target}
                  onChange={(event) => updateBranch(index, { target: event.target.value })}
                >
                  <option value={END_STEP}>End the run</option>
                  {allSteps
                    .filter((entry) => entry.id !== step.id)
                    .map((entry) => (
                      <option key={entry.id} value={entry.key}>
                        {entry.name} ({entry.key})
                      </option>
                    ))}
                </Select>
              </Field>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function WorkflowBuilderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [workflow, setWorkflow] = useState<WorkflowDTO | null>(null);
  const [tools, setTools] = useState<ToolDescriptor[]>([]);
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [steps, setSteps] = useState<EditableStep[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [versions, setVersions] = useState<WorkflowVersionSummaryDTO[]>([]);
  const [pendingRestore, setPendingRestore] = useState<WorkflowVersionSummaryDTO | null>(null);
  const [restoring, setRestoring] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const loadVersions = useCallback(async () => {
    try {
      const data = await apiGet<{ versions: WorkflowVersionSummaryDTO[] }>(
        `/api/workflows/${id}/versions`,
      );
      setVersions(data.versions);
    } catch {
      // Version panel is secondary; don't block the builder on a list failure.
    }
  }, [id]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [workflowRes, toolsRes, providersRes] = await Promise.all([
        apiGet<{ workflow: WorkflowDTO }>(`/api/workflows/${id}`),
        apiGet<{ tools: ToolDescriptor[] }>("/api/tools"),
        apiGet<{ providers: ProviderDescriptor[] }>("/api/providers"),
      ]);
      setWorkflow(workflowRes.workflow);
      setTools(toolsRes.tools);
      setProviders(providersRes.providers);
      const editable = editableStepsFromWorkflow(workflowRes.workflow);
      setSteps(editable);
      setSelectedId(editable[0]?.id ?? null);
      setError(null);
      void loadVersions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workflow.");
    } finally {
      setLoading(false);
    }
  }, [id, loadVersions]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => steps.find((step) => step.id === selectedId) ?? null,
    [steps, selectedId],
  );

  const provider = providers.find((entry) => entry.id === workflow?.provider);

  function updateStep(next: EditableStep) {
    setSteps((current) => current.map((step) => (step.id === next.id ? next : step)));
  }

  function addStep(type: StepType = "agent") {
    const name =
      type === "agent"
        ? "Agent"
        : type === "tool"
          ? "Tool"
          : type === "decision"
            ? "Decision"
            : "Respond";
    const key = uniqueKey(slugify(name), steps.map((step) => step.key));
    const step: EditableStep = {
      id: `local_${crypto.randomUUID()}`,
      key,
      type,
      name,
      instruction: type === "respond" ? "Compose the final answer for the user." : "",
      toolKey: type === "tool" ? tools[0]?.key ?? null : null,
      config: blankConfig(),
    };
    setSteps((current) => [...current, step]);
    setSelectedId(step.id);
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSteps((current) => {
      const oldIndex = current.findIndex((step) => step.id === active.id);
      const newIndex = current.findIndex((step) => step.id === over.id);
      return arrayMove(current, oldIndex, newIndex);
    });
  }

  async function save() {
    if (!workflow) return;
    setSaving(true);
    setMessage(null);
    setError(null);

    // Workflow-level tool flags are derived from step selections (no separate Tools panel).
    const selectedToolKeys = new Set<string>();
    for (const step of steps) {
      if (step.type === "agent") {
        for (const key of step.config.toolKeys) selectedToolKeys.add(key);
      }
      if (step.type === "tool" && step.toolKey) selectedToolKeys.add(step.toolKey);
    }
    const toolsPayload =
      steps.length === 0
        ? workflow.tools
        : tools.map((tool) => ({
            toolKey: tool.key,
            enabled: selectedToolKeys.has(tool.key),
          }));

    const payload = {
      name: workflow.name,
      description: workflow.description,
      systemPrompt: workflow.systemPrompt,
      provider: workflow.provider,
      model: workflow.model,
      temperature: workflow.temperature,
      maxIterations: workflow.maxIterations,
      tools: toolsPayload,
      steps: steps.map((step) => ({
        key: step.key,
        type: step.type,
        name: step.name,
        instruction: step.instruction,
        toolKey: step.toolKey,
        config: step.config,
      })),
    };

    const stepErrors = validateSteps(payload.steps);
    if (stepErrors.length > 0) {
      setError(stepErrors.join(" "));
      setSaving(false);
      return;
    }

    try {
      const data = await apiSend<{ workflow: WorkflowDTO }>(
        `/api/workflows/${workflow.id}`,
        "PUT",
        payload,
      );
      setWorkflow(data.workflow);
      const editable = editableStepsFromWorkflow(data.workflow);
      setSteps(editable);
      setSelectedId((current) => {
        if (current && editable.some((step) => step.id === current)) return current;
        const byKey = editable.find(
          (step) => step.key === steps.find((entry) => entry.id === current)?.key,
        );
        return byKey?.id ?? editable[0]?.id ?? null;
      });
      setMessage("Saved.");
      void loadVersions();
    } catch (err) {
      if (err instanceof ApiError) {
        const details = Array.isArray(err.details)
          ? err.details
              .map((item) =>
                typeof item === "string"
                  ? item
                  : typeof item === "object" && item && "message" in item
                    ? String((item as { message: unknown }).message)
                    : JSON.stringify(item),
              )
              .join(" ")
          : "";
        setError([err.message, details].filter(Boolean).join(" "));
      } else {
        setError(err instanceof Error ? err.message : "Save failed.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function restoreVersion() {
    if (!workflow || !pendingRestore) return;
    const restoredVersion = pendingRestore.version;
    setRestoring(true);
    setError(null);
    setMessage(null);
    try {
      const data = await apiSend<{ workflow: WorkflowDTO }>(
        `/api/workflows/${workflow.id}/versions/${pendingRestore.id}/restore`,
        "POST",
      );
      setWorkflow(data.workflow);
      const editable = editableStepsFromWorkflow(data.workflow);
      setSteps(editable);
      setSelectedId(editable[0]?.id ?? null);
      setPendingRestore(null);
      setMessage(`Restored version ${restoredVersion}.`);
      void loadVersions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed.");
    } finally {
      setRestoring(false);
    }
  }

  async function removeWorkflow() {
    if (!workflow) return;
    setDeleting(true);
    try {
      await apiSend(`/api/workflows/${workflow.id}`, "DELETE");
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16">
        <EmptyState
          title="Workflow not found"
          description={error ?? "It may have been deleted."}
          action={
            <Link href="/">
              <Button variant="secondary">Back to workflows</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-6 py-8 animate-fade-in">
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete “${workflow.name}”?`}
        description="This permanently removes the workflow and its chat history. This cannot be undone."
        busy={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void removeWorkflow()}
      />
      <ConfirmDialog
        open={pendingRestore != null}
        title={`Restore version ${pendingRestore?.version ?? ""}?`}
        description="Your current configuration is saved as a new version first, then this snapshot is applied. Nothing is lost."
        confirmLabel="Restore"
        busy={restoring}
        onCancel={() => setPendingRestore(null)}
        onConfirm={() => void restoreVersion()}
      />
      <PageHeader
        breadcrumb={
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-subtle hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Workflows
          </Link>
        }
        title={
          <Input
            value={workflow.name}
            onChange={(event) => setWorkflow({ ...workflow, name: event.target.value })}
            className="h-auto border-transparent bg-transparent px-0 text-xl font-semibold tracking-tight shadow-none hover:border-transparent focus-visible:border-transparent"
            aria-label="Workflow name"
          />
        }
        description="Edit the prompt, tools and step sequence. Save before chatting so the run uses the latest config."
        actions={
          <>
            <Link href={`/workflows/${workflow.id}/chat`}>
              <Button variant="secondary">
                <MessageSquare className="size-4" />
                Chat
              </Button>
            </Link>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" />
              Delete
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              <Save className="size-4" />
              Save
            </Button>
          </>
        }
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <section className="space-y-4 rounded-2xl border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold">Basics</h2>
            <Field label="Description" htmlFor="description">
              <Input
                id="description"
                value={workflow.description ?? ""}
                onChange={(event) =>
                  setWorkflow({ ...workflow, description: event.target.value || null })
                }
                placeholder="What is this workflow for?"
              />
            </Field>
            <Field
              label="System prompt"
              htmlFor="system-prompt"
              description="Always prepended to every run. This is the workflow's persona and standing instructions."
            >
              <Textarea
                id="system-prompt"
                rows={8}
                value={workflow.systemPrompt}
                onChange={(event) =>
                  setWorkflow({ ...workflow, systemPrompt: event.target.value })
                }
              />
            </Field>
          </section>

          <section className="space-y-4 rounded-2xl border border-border bg-surface p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Steps</h2>
                <p className="mt-1 text-xs text-subtle">
                  Drag to reorder. An empty list falls back to a single agent step using every
                  enabled tool.
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => addStep("agent")}>
                <Plus className="size-3.5" />
                Add step
              </Button>
            </div>

            {steps.length === 0 ? (
              <EmptyState
                title="No steps configured"
                description="The run will use one implicit agent step. Add steps when you want a pipeline or a decision tree."
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    {STEP_TYPES.map((type) => (
                      <Button key={type} size="sm" variant="outline" onClick={() => addStep(type)}>
                        {STEP_TYPE_META[type].label}
                      </Button>
                    ))}
                  </div>
                }
              />
            ) : (
              <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={onDragEnd}
                >
                  <SortableContext
                    items={steps.map((step) => step.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2">
                      {steps.map((step) => (
                        <SortableStepCard
                          key={step.id}
                          step={step}
                          selected={step.id === selectedId}
                          onSelect={() => setSelectedId(step.id)}
                        />
                      ))}
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {STEP_TYPES.map((type) => (
                          <Button
                            key={type}
                            size="sm"
                            variant="ghost"
                            onClick={() => addStep(type)}
                          >
                            <Plus className="size-3" />
                            {STEP_TYPE_META[type].label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </SortableContext>
                </DndContext>

                {selected ? (
                  <StepEditor
                    step={selected}
                    tools={tools}
                    allSteps={steps}
                    onChange={updateStep}
                    onDelete={() => {
                      setSteps((current) => current.filter((step) => step.id !== selected.id));
                      setSelectedId((current) => {
                        if (current !== selected.id) return current;
                        const remaining = steps.filter((step) => step.id !== selected.id);
                        return remaining[0]?.id ?? null;
                      });
                    }}
                  />
                ) : (
                  <EmptyState title="Select a step" description="Pick a step on the left to edit it." />
                )}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="space-y-4 rounded-2xl border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold">Model</h2>
            <Field label="Provider" htmlFor="provider">
              <Select
                id="provider"
                value={workflow.provider}
                onChange={(event) => {
                  const next = providers.find((entry) => entry.id === event.target.value);
                  setWorkflow({
                    ...workflow,
                    provider: event.target.value,
                    model: next?.defaultModel ?? workflow.model,
                  });
                }}
              >
                {providers.map((entry) => (
                  <option key={entry.id} value={entry.id} disabled={!entry.configured}>
                    {entry.label}
                    {entry.configured ? "" : ` (set ${entry.apiKeyEnvVar})`}
                  </option>
                ))}
              </Select>
            </Field>
            {provider?.blurb ? (
              <p className="text-xs leading-relaxed text-subtle">{provider.blurb}</p>
            ) : null}
            {!provider?.configured ? (
              <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                {provider?.label ?? "This provider"} is not configured. Add a key in{" "}
                <a href="/settings" className="underline">
                  Settings
                </a>{" "}
                or set <code className="font-mono">{provider?.apiKeyEnvVar}</code> in{" "}
                <code>.env</code>.
              </p>
            ) : null}
            <Field label="Model" htmlFor="model">
              <Select
                id="model"
                value={workflow.model}
                onChange={(event) => setWorkflow({ ...workflow, model: event.target.value })}
              >
                {(provider?.models ?? []).map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                    {model.note ? ` — ${model.note}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Max agent iterations" htmlFor="max-iters">
              <Input
                id="max-iters"
                type="number"
                min={1}
                max={12}
                value={workflow.maxIterations}
                onChange={(event) =>
                  setWorkflow({ ...workflow, maxIterations: Number(event.target.value) || 1 })
                }
              />
            </Field>
          </section>

          <section className="space-y-4 rounded-2xl border border-border bg-surface p-5">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <History className="size-4 text-muted" />
                Versions
              </h2>
              <p className="mt-1 text-xs text-subtle">
                Every save creates a snapshot. Restore reapplies an older one safely.
              </p>
            </div>
            {versions.length === 0 ? (
              <p className="text-xs text-subtle">No versions yet. Save the workflow to create one.</p>
            ) : (
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {versions.map((version, index) => (
                  <div
                    key={version.id}
                    className="rounded-xl border border-border bg-background/40 px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={index === 0 ? "accent" : "neutral"}>
                            v{version.version}
                          </Badge>
                          {index === 0 ? <Badge tone="success">latest</Badge> : null}
                          {version.label ? (
                            <span className="truncate text-[11px] text-subtle">
                              {version.label}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 truncate text-xs text-muted">
                          {version.model} · {version.stepCount} step
                          {version.stepCount === 1 ? "" : "s"} · {version.enabledToolCount} tool
                          {version.enabledToolCount === 1 ? "" : "s"}
                        </p>
                        <p className="mt-0.5 text-[11px] text-subtle">
                          {formatRelativeTime(version.createdAt)}
                        </p>
                      </div>
                      {index === 0 ? null : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setPendingRestore(version)}
                        >
                          <RotateCcw className="size-3.5" />
                          Restore
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

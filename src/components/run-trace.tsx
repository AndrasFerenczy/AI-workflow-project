"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  GitBranch,
  MessageSquare,
  Play,
  Wrench,
  XCircle,
} from "lucide-react";

import { Badge, CodeBlock } from "@/components/ui/primitives";
import type { RunEvent } from "@/lib/engine/events";
import { cn, formatDuration } from "@/lib/utils";

const TYPE_META: Record<
  string,
  { label: string; icon: typeof Bot; tone: "neutral" | "accent" | "success" | "warning" | "danger" | "info" }
> = {
  run_started: { label: "Run started", icon: Play, tone: "info" },
  step_started: { label: "Step", icon: Bot, tone: "accent" },
  llm_response: { label: "Model", icon: MessageSquare, tone: "neutral" },
  tool_call: { label: "Tool call", icon: Wrench, tone: "warning" },
  tool_result: { label: "Tool result", icon: Wrench, tone: "info" },
  decision: { label: "Decision", icon: GitBranch, tone: "accent" },
  step_completed: { label: "Step done", icon: CheckCircle2, tone: "success" },
  note: { label: "Note", icon: MessageSquare, tone: "neutral" },
  run_completed: { label: "Completed", icon: CheckCircle2, tone: "success" },
  run_failed: { label: "Failed", icon: XCircle, tone: "danger" },
};

function pretty(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function EventRow({ event }: { event: RunEvent }) {
  const [open, setOpen] = useState(false);
  const meta = TYPE_META[event.type] ?? {
    label: event.type,
    icon: AlertTriangle,
    tone: "neutral" as const,
  };
  const Icon = meta.icon;
  const hasPayload = Object.keys(event.data ?? {}).length > 0;

  return (
    <div className="rounded-xl border border-border bg-background/40">
      <button
        type="button"
        onClick={() => hasPayload && setOpen((value) => !value)}
        className={cn(
          "flex w-full items-start gap-3 px-3.5 py-3 text-left",
          hasPayload ? "hover:bg-surface-hover/40" : "cursor-default",
        )}
      >
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-raised text-muted">
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={meta.tone}>{meta.label}</Badge>
            {event.stepKey ? (
              <span className="font-mono text-[11px] text-subtle">{event.stepKey}</span>
            ) : null}
            {event.durationMs != null ? (
              <span className="text-[11px] text-subtle">{formatDuration(event.durationMs)}</span>
            ) : null}
          </div>
          {event.label ? (
            <p className="truncate text-sm text-foreground">{event.label}</p>
          ) : null}
        </div>
        {hasPayload ? (
          <ChevronDown
            className={cn(
              "mt-1 size-4 shrink-0 text-subtle transition-transform",
              open && "rotate-180",
            )}
          />
        ) : null}
      </button>
      {open && hasPayload ? (
        <div className="border-t border-border px-3.5 py-3">
          <CodeBlock value={pretty(event.data)} maxHeight="14rem" />
        </div>
      ) : null}
    </div>
  );
}

export function RunTrace({
  events,
  className,
  defaultCollapsed = false,
  /** When false, render events only (no “Execution trace” toggle row). */
  showHeader = true,
}: {
  events: RunEvent[];
  className?: string;
  defaultCollapsed?: boolean;
  showHeader?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const toolCalls = events.filter((event) => event.type === "tool_call").length;

  if (!showHeader) {
    return (
      <div className={cn("animate-fade-in space-y-2", className)}>
        {events.map((event) => (
          <EventRow key={event.seq} event={event} />
        ))}
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1 text-left text-xs text-subtle hover:text-foreground"
      >
        <span>
          Execution trace · {events.length} event{events.length === 1 ? "" : "s"}
          {toolCalls > 0 ? ` · ${toolCalls} tool call${toolCalls === 1 ? "" : "s"}` : ""}
        </span>
        <ChevronDown className={cn("size-3.5 transition-transform", !collapsed && "rotate-180")} />
      </button>
      {!collapsed ? (
        <div className="animate-fade-in space-y-2">
          {events.map((event) => (
            <EventRow key={event.seq} event={event} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

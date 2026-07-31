import { Loader2 } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-2xl border border-border bg-surface", className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 p-5 pb-0", className)}>
      <div className="flex items-start gap-3">
        {icon ? (
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            {icon}
          </span>
        ) : null}
        <div className="space-y-1">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {description ? (
            <p className="text-xs leading-relaxed text-subtle">{description}</p>
          ) : null}
        </div>
      </div>
      {action}
    </div>
  );
}

type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-raised text-muted border-border",
  accent: "bg-accent-soft text-accent border-accent/30",
  success: "bg-success/12 text-success border-success/30",
  warning: "bg-warning/12 text-warning border-warning/30",
  danger: "bg-danger/12 text-danger border-danger/30",
  info: "bg-info/12 text-info border-info/30",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border px-6 py-14 text-center",
        className,
      )}
    >
      {icon ? (
        <span className="flex size-11 items-center justify-center rounded-xl bg-surface-raised text-subtle">
          {icon}
        </span>
      ) : null}
      <div className="space-y-1.5">
        <p className="text-sm font-medium">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-xs leading-relaxed text-subtle">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-subtle", className)} />;
}

export function Separator({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-border", className)} />;
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1.5">
        {breadcrumb}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-subtle">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Monospace block used for tool arguments, results and raw payloads. */
export function CodeBlock({
  value,
  className,
  maxHeight = "18rem",
}: {
  value: string;
  className?: string;
  maxHeight?: string;
}) {
  return (
    <pre
      style={{ maxHeight }}
      className={cn(
        "overflow-auto rounded-lg border border-border bg-background/60 p-3",
        "font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted",
        className,
      )}
    >
      {value}
    </pre>
  );
}

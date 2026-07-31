export const RUN_EVENT_TYPES = [
  "run_started",
  "step_started",
  "llm_response",
  "tool_call",
  "tool_result",
  "decision",
  "step_completed",
  "note",
  "run_completed",
  "run_failed",
] as const;

export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

export interface RunEvent {
  seq: number;
  type: RunEventType;
  stepKey: string | null;
  label: string | null;
  data: Record<string, unknown>;
  durationMs: number | null;
  createdAt: string;
}

/**
 * Collects the ordered trace of a run. The executor only ever appends here, so
 * persistence and the API response read from the same source and can never
 * drift apart.
 */
export class RunEventCollector {
  private events: RunEvent[] = [];
  private seq = 0;

  constructor(private readonly onEmit?: (event: RunEvent) => void) {}

  emit(
    type: RunEventType,
    options: {
      stepKey?: string | null;
      label?: string | null;
      data?: Record<string, unknown>;
      durationMs?: number | null;
    } = {},
  ): RunEvent {
    const event: RunEvent = {
      seq: this.seq++,
      type,
      stepKey: options.stepKey ?? null,
      label: options.label ?? null,
      data: options.data ?? {},
      durationMs: options.durationMs ?? null,
      createdAt: new Date().toISOString(),
    };
    this.events.push(event);
    this.onEmit?.(event);
    return event;
  }

  all(): RunEvent[] {
    return this.events;
  }

  /** Rows ready for `prisma.runEvent.createMany`. */
  toRows(runId: string) {
    return this.events.map((event) => ({
      runId,
      seq: event.seq,
      type: event.type,
      stepKey: event.stepKey,
      label: event.label,
      data: JSON.stringify(event.data),
      durationMs: event.durationMs,
    }));
  }
}

/** Rehydrates persisted rows into the same shape the executor produced. */
export function deserializeRunEvent(row: {
  seq: number;
  type: string;
  stepKey: string | null;
  label: string | null;
  data: string;
  durationMs: number | null;
  createdAt: Date;
}): RunEvent {
  let data: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.data);
    if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
  } catch {
    data = { raw: row.data };
  }

  return {
    seq: row.seq,
    type: row.type as RunEventType,
    stepKey: row.stepKey,
    label: row.label,
    data,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
  };
}

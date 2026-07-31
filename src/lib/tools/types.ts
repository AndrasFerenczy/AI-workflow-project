import type { z } from "zod";

/** Everything a tool is allowed to know about the run invoking it. */
export interface ToolContext {
  runId: string;
  workflowId: string;
  /** Abort signal wired to the run's wall-clock budget. */
  signal: AbortSignal;
}

/**
 * A tool is fully described by this one object: the schema drives both the
 * JSON Schema handed to the LLM and the runtime validation of its arguments,
 * so a tool can never be called with a shape it did not declare.
 *
 * Adding a tool means writing one file and listing it in `registry.ts`.
 */
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  key: string;
  name: string;
  /** Shown to the LLM. Be explicit about when the tool should be reached for. */
  description: string;
  /** Shown to the user in the builder. */
  summary: string;
  /** lucide-react icon name, resolved by the UI. */
  icon: string;
  /** Tools that touch the network or write data are flagged in the builder. */
  tags?: ToolTag[];
  /** Whether new workflows get this tool switched on by default. */
  enabledByDefault?: boolean;
  parameters: z.ZodType<TInput>;
  execute(input: TInput, context: ToolContext): Promise<TOutput>;
  /** One-line human summary for the trace timeline. */
  summarize?(input: TInput, output: TOutput): string;
}

export type ToolTag = "network" | "writes" | "compute" | "mock";

/** Serialisable view of a tool, safe to send to the browser. */
export interface ToolDescriptor {
  key: string;
  name: string;
  description: string;
  summary: string;
  icon: string;
  tags: ToolTag[];
  enabledByDefault: boolean;
  parametersSchema: Record<string, unknown>;
}

export type ToolInvocationStatus = "ok" | "error";

export interface ToolInvocationResult {
  status: ToolInvocationStatus;
  /** Serialised payload handed back to the LLM. */
  content: string;
  /** Structured payload kept for the trace UI. */
  data: unknown;
  summary: string;
  durationMs: number;
}

/**
 * Thrown by tools for expected, explainable failures (bad input, upstream 404).
 * These are returned to the LLM as tool results so it can recover, rather than
 * aborting the run.
 */
export class ToolExecutionError extends Error {
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

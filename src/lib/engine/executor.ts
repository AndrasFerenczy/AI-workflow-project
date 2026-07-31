import { numberEnv } from "@/lib/env";
import {
  addUsage,
  EMPTY_USAGE,
  getProvider,
  LLMError,
  type LLMCompletion,
  type LLMMessage,
  type LLMToolSchema,
  type LLMUsage,
} from "@/lib/llm";
import {
  describeTool,
  getTool,
  invokeTool,
  toolParametersJsonSchema,
} from "@/lib/tools/registry";
import type { ToolContext } from "@/lib/tools/types";
import { END_STEP, type StepConfig, type StepType } from "@/lib/workflow/types";

import { RunEventCollector, type RunEvent } from "./events";
import { findUnresolvedPlaceholders, renderTemplate, type TemplateScope } from "./template";

export interface ExecutableStep {
  key: string;
  type: StepType;
  name: string;
  instruction: string;
  toolKey: string | null;
  config: StepConfig;
}

export interface ExecutableWorkflow {
  id: string;
  name: string;
  systemPrompt: string;
  provider: string;
  model: string;
  temperature: number;
  maxIterations: number;
  /** Tool keys switched on for this workflow, in registry order. */
  enabledToolKeys: string[];
  steps: ExecutableStep[];
}

export interface ExecuteWorkflowOptions {
  workflow: ExecutableWorkflow;
  runId: string;
  input: string;
  /** Prior conversation turns, oldest first. */
  history?: LLMMessage[];
  signal?: AbortSignal;
  /** Live trace updates for SSE clients. */
  onEvent?: (event: RunEvent) => void;
  /** Fired before each streamed LLM completion's first token. */
  onTextReset?: () => void;
  /** Token deltas from the active LLM completion. */
  onTextDelta?: (delta: string) => void;
}

export interface ExecutionResult {
  status: "succeeded" | "failed";
  output: string;
  error?: string;
  events: RunEvent[];
  usage: LLMUsage;
  durationMs: number;
}

const MAX_STEPS = () => numberEnv("WORKFLOW_MAX_STEPS", 25);
const MAX_ITERATIONS = () => numberEnv("WORKFLOW_MAX_ITERATIONS", 8);
const TIMEOUT_MS = () => numberEnv("WORKFLOW_TIMEOUT_MS", 120_000);

/** Keeps injected step context from crowding out the actual conversation. */
const CONTEXT_CHAR_BUDGET = 1_500;

/** Used when a workflow has no steps configured at all. */
function implicitAgentStep(): ExecutableStep {
  return {
    key: "agent",
    type: "agent",
    name: "Agent",
    instruction: "{{input}}",
    toolKey: null,
    config: {
      toolKeys: [],
      branches: [],
      argumentMode: "llm",
      argumentTemplate: "",
    },
  };
}

class RunAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunAbortedError";
  }
}

export async function executeWorkflow({
  workflow,
  runId,
  input,
  history = [],
  signal,
  onEvent,
  onTextReset,
  onTextDelta,
}: ExecuteWorkflowOptions): Promise<ExecutionResult> {
  const startedAt = Date.now();
  const events = new RunEventCollector(onEvent);

  const timeout = AbortSignal.timeout(TIMEOUT_MS());
  const runSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const steps = workflow.steps.length > 0 ? workflow.steps : [implicitAgentStep()];
  const stepsByKey = new Map(steps.map((step) => [step.key, step]));

  const scope: TemplateScope = { input, steps: {} };
  let usage = EMPTY_USAGE;
  let lastOutput = "";

  events.emit("run_started", {
    label: workflow.name,
    data: {
      input,
      provider: workflow.provider,
      model: workflow.model,
      stepCount: steps.length,
      enabledTools: workflow.enabledToolKeys,
      implicitStep: workflow.steps.length === 0,
    },
  });

  const ensureRunning = () => {
    if (!runSignal.aborted) return;
    throw new RunAbortedError(
      timeout.aborted
        ? `Run exceeded its ${Math.round(TIMEOUT_MS() / 1000)}s time budget.`
        : "Run was cancelled.",
    );
  };

  try {
    const provider = await getProvider(workflow.provider);
    const toolContext: ToolContext = {
      runId,
      workflowId: workflow.id,
      signal: runSignal,
    };

    const maxSteps = MAX_STEPS();
    let cursor = 0;
    let executed = 0;

    while (cursor >= 0 && cursor < steps.length) {
      ensureRunning();

      if (executed >= maxSteps) {
        events.emit("note", {
          label: "Step limit reached",
          data: {
            message: `Stopped after ${maxSteps} steps. Check your decision branches for a loop.`,
          },
        });
        break;
      }

      const step = steps[cursor];
      executed += 1;

      const stepStartedAt = Date.now();
      events.emit("step_started", {
        stepKey: step.key,
        label: step.name,
        data: { type: step.type, index: executed, toolKey: step.toolKey },
      });

      const outcome = await runStep({
        step,
        workflow,
        provider,
        scope,
        history,
        events,
        toolContext,
        signal: runSignal,
        onTextReset,
        onTextDelta,
        surfaceChatStream: shouldSurfaceChatStream(step, steps, cursor),
      });

      usage = addUsage(usage, outcome.usage);
      scope.steps[step.key] = { output: outcome.output };
      if (outcome.output.trim()) lastOutput = outcome.output;

      events.emit("step_completed", {
        stepKey: step.key,
        label: step.name,
        data: { output: outcome.output, type: step.type },
        durationMs: Date.now() - stepStartedAt,
      });

      // A decision step redirects the cursor; everything else falls through to
      // the next step in order.
      if (outcome.nextStepKey === END_STEP) break;

      if (outcome.nextStepKey) {
        const targetIndex = steps.findIndex((entry) => entry.key === outcome.nextStepKey);
        if (targetIndex === -1) {
          events.emit("note", {
            stepKey: step.key,
            label: "Missing branch target",
            data: {
              message: `Branch pointed at "${outcome.nextStepKey}", which no longer exists. Continuing in order.`,
            },
          });
          cursor += 1;
        } else {
          cursor = targetIndex;
        }
        continue;
      }

      cursor += 1;
    }

    void stepsByKey;

    const output =
      lastOutput.trim() ||
      "The workflow finished without producing a response. Add a respond step, or check that the final step returns text.";

    const durationMs = Date.now() - startedAt;
    events.emit("run_completed", {
      data: { output, usage, stepsExecuted: executed },
      durationMs,
    });

    return { status: "succeeded", output, events: events.all(), usage, durationMs };
  } catch (error) {
    const message = describeError(error);
    const durationMs = Date.now() - startedAt;

    events.emit("run_failed", { data: { error: message }, durationMs });

    return {
      status: "failed",
      output: lastOutput,
      error: message,
      events: events.all(),
      usage,
      durationMs,
    };
  }
}

function describeError(error: unknown): string {
  if (error instanceof LLMError) return error.message;
  if (error instanceof RunAbortedError) return error.message;
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      return "The run was cancelled or timed out.";
    }
    return error.message;
  }
  return "The workflow failed for an unknown reason.";
}

interface StepOutcome {
  output: string;
  usage: LLMUsage;
  /** Set by decision steps to redirect the cursor. */
  nextStepKey?: string;
}

interface RunStepArgs {
  step: ExecutableStep;
  workflow: ExecutableWorkflow;
  provider: Awaited<ReturnType<typeof getProvider>>;
  scope: TemplateScope;
  history: LLMMessage[];
  events: RunEventCollector;
  toolContext: ToolContext;
  signal: AbortSignal;
  onTextReset?: () => void;
  onTextDelta?: (delta: string) => void;
  /** When false, model tokens are not forwarded to the chat UI. */
  surfaceChatStream: boolean;
}

function streamHooks(args: RunStepArgs) {
  if (!args.surfaceChatStream) {
    return {};
  }
  return {
    onStreamStart: args.onTextReset,
    onTextDelta: args.onTextDelta,
  };
}

/**
 * Whether this step's model tokens should appear in the chat bubble.
 * Intermediate tool/decision/agent rounds stay silent; only the final
 * user-facing prose (respond, or a lone agent step) is streamed.
 */
function shouldSurfaceChatStream(
  step: ExecutableStep,
  steps: ExecutableStep[],
  cursor: number,
): boolean {
  if (step.type === "respond") return true;
  if (step.type !== "agent") return false;
  // If a later respond step will write the user-visible answer, keep agent quiet.
  return !steps.slice(cursor + 1).some((entry) => entry.type === "respond");
}

async function runStep(args: RunStepArgs): Promise<StepOutcome> {
  switch (args.step.type) {
    case "agent":
      return runAgentStep(args);
    case "tool":
      return runToolStep(args);
    case "decision":
      return runDecisionStep(args);
    case "respond":
      return runRespondStep(args);
  }
}

/**
 * Tools an agent step may call. Explicit `toolKeys` on the step win; an empty
 * list falls back to workflow-enabled tools (used by the implicit no-step agent).
 */
function resolveStepTools(step: ExecutableStep, workflow: ExecutableWorkflow): string[] {
  const requested = step.config.toolKeys ?? [];
  if (requested.length > 0) {
    return requested.filter((key) => Boolean(getTool(key)));
  }
  return workflow.enabledToolKeys.filter((key) => Boolean(getTool(key)));
}

function toToolSchemas(keys: string[]): LLMToolSchema[] {
  const schemas: LLMToolSchema[] = [];
  for (const key of keys) {
    const tool = getTool(key);
    if (!tool) continue;
    schemas.push({
      name: tool.key,
      description: tool.description,
      parameters: toolParametersJsonSchema(tool),
    });
  }
  return schemas;
}

/**
 * Later steps do not replay earlier steps' tool traffic, so their outputs are
 * summarised into the prompt instead. This is what makes a chain of steps feel
 * like one continuous piece of work.
 */
function buildStepContext(step: ExecutableStep, scope: TemplateScope): string | null {
  const entries = Object.entries(scope.steps).filter(([, value]) => value.output.trim());
  if (entries.length === 0) return null;

  // Anything the instruction already interpolates would otherwise appear twice.
  const referenced = new Set(
    [...step.instruction.matchAll(/\{\{\s*steps\.([a-z0-9_]+)\.output\s*\}\}/g)].map(
      (match) => match[1],
    ),
  );

  const parts = entries
    .filter(([key]) => !referenced.has(key))
    .map(([key, value]) => {
      const text = value.output.trim();
      const clipped =
        text.length > CONTEXT_CHAR_BUDGET
          ? `${text.slice(0, CONTEXT_CHAR_BUDGET)}\n[truncated]`
          : text;
      return `<step key="${key}">\n${clipped}\n</step>`;
    });

  if (parts.length === 0) return null;

  return `Results from earlier steps in this workflow:\n\n${parts.join("\n\n")}`;
}

function renderInstruction(
  step: ExecutableStep,
  scope: TemplateScope,
  events: RunEventCollector,
): string {
  const template = step.instruction.trim() || "{{input}}";
  const unresolved = findUnresolvedPlaceholders(template, scope);

  if (unresolved.length > 0) {
    events.emit("note", {
      stepKey: step.key,
      label: "Unresolved placeholders",
      data: {
        message:
          `These placeholders had no value yet and were left as-is: ${unresolved.join(", ")}. ` +
          "A step can only reference steps that ran before it.",
        placeholders: unresolved,
      },
    });
  }

  return renderTemplate(template, scope);
}

function buildMessages(
  step: ExecutableStep,
  scope: TemplateScope,
  history: LLMMessage[],
  instruction: string,
): LLMMessage[] {
  const messages: LLMMessage[] = [...history];
  const context = buildStepContext(step, scope);

  messages.push({
    role: "user",
    content: context ? `${context}\n\n---\n\n${instruction}` : instruction,
  });

  return messages;
}

function emitLLMResponse(
  events: RunEventCollector,
  step: ExecutableStep,
  completion: LLMCompletion,
  iteration: number,
) {
  events.emit("llm_response", {
    stepKey: step.key,
    label: completion.model,
    data: {
      iteration,
      text: completion.text,
      toolCalls: completion.toolCalls.map((call) => ({
        name: call.name,
        arguments: call.arguments,
      })),
      finishReason: completion.finishReason,
      usage: completion.usage,
    },
  });
}

async function runAgentStep(args: RunStepArgs): Promise<StepOutcome> {
  const { step, workflow, provider, scope, history, events, toolContext, signal } = args;

  const instruction = renderInstruction(step, scope, events);
  const toolKeys = resolveStepTools(step, workflow);
  const toolSchemas = toToolSchemas(toolKeys);
  const messages = buildMessages(step, scope, history, instruction);

  const maxIterations = Math.min(
    step.config.maxIterations ?? workflow.maxIterations,
    MAX_ITERATIONS(),
  );

  let usage = EMPTY_USAGE;
  let text = "";

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    if (signal.aborted) throw new RunAbortedError("Run was cancelled.");

    // Buffer tokens for this round. Only flush to the chat UI when the model
    // produces a final prose answer (no tool calls) and this step surfaces chat.
    const buffered: string[] = [];
    const completion = await provider.complete({
      model: workflow.model,
      system: workflow.systemPrompt || undefined,
      messages,
      tools: toolSchemas.length > 0 ? toolSchemas : undefined,
      temperature: workflow.temperature,
      signal,
      onStreamStart: args.surfaceChatStream ? () => {
        buffered.length = 0;
      } : undefined,
      onTextDelta: args.surfaceChatStream
        ? (delta) => {
            buffered.push(delta);
          }
        : undefined,
    });

    usage = addUsage(usage, completion.usage);
    emitLLMResponse(events, step, completion, iteration);

    if (completion.text.trim()) text = completion.text.trim();

    if (completion.toolCalls.length === 0) {
      if (args.surfaceChatStream) {
        args.onTextReset?.();
        const chunks = buffered.length > 0 ? buffered : text ? [text] : [];
        for (const chunk of chunks) {
          args.onTextDelta?.(chunk);
        }
      }
      break;
    }

    messages.push({
      role: "assistant",
      content: completion.text,
      toolCalls: completion.toolCalls,
    });

    for (const call of completion.toolCalls) {
      const tool = getTool(call.name);

      events.emit("tool_call", {
        stepKey: step.key,
        label: tool?.name ?? call.name,
        data: { tool: call.name, arguments: call.arguments },
      });

      // A step may only use tools the workflow has switched on, even if the
      // model hallucinates another name.
      if (!toolKeys.includes(call.name)) {
        const message = `Tool "${call.name}" is not enabled for this step. Available: ${
          toolKeys.join(", ") || "none"
        }.`;
        events.emit("tool_result", {
          stepKey: step.key,
          label: call.name,
          data: { tool: call.name, status: "error", summary: message },
        });
        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: message,
          isError: true,
        });
        continue;
      }

      const result = await invokeTool(call.name, call.arguments, toolContext);

      events.emit("tool_result", {
        stepKey: step.key,
        label: tool?.name ?? call.name,
        data: {
          tool: call.name,
          status: result.status,
          summary: result.summary,
          result: result.data,
        },
        durationMs: result.durationMs,
      });

      messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: result.content,
        isError: result.status === "error",
      });
    }

    if (iteration === maxIterations) {
      events.emit("note", {
        stepKey: step.key,
        label: "Iteration limit reached",
        data: {
          message: `Stopped after ${maxIterations} tool rounds in "${step.name}". Raise the limit if the task needs more.`,
        },
      });
    }
  }

  return { output: text, usage };
}

async function runToolStep(args: RunStepArgs): Promise<StepOutcome> {
  const { step, workflow, provider, scope, history, events, toolContext, signal } = args;

  const toolKey = step.toolKey;
  if (!toolKey || !getTool(toolKey)) {
    events.emit("note", {
      stepKey: step.key,
      label: "Step skipped",
      data: { message: `Step "${step.name}" has no valid tool selected.` },
    });
    return { output: "", usage: EMPTY_USAGE };
  }

  const tool = getTool(toolKey)!;
  let usage = EMPTY_USAGE;
  let toolArgs: Record<string, unknown>;

  if (step.config.argumentMode === "template") {
    // Deterministic path: no model call at all, arguments come from the template.
    const rendered = renderTemplate(step.config.argumentTemplate || "{}", scope);
    try {
      const parsed = JSON.parse(rendered);
      toolArgs = typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
      const message = `Argument template for "${step.name}" is not valid JSON after substitution.`;
      events.emit("note", {
        stepKey: step.key,
        label: "Invalid argument template",
        data: { message, rendered },
      });
      return { output: message, usage };
    }
  } else {
    // Let the model fill the arguments, but force it to call this one tool.
    const instruction = renderInstruction(step, scope, events);
    const completion = await provider.complete({
      model: workflow.model,
      system: workflow.systemPrompt || undefined,
      messages: buildMessages(step, scope, history, instruction),
      tools: toToolSchemas([toolKey]),
      toolChoice: "required",
      temperature: workflow.temperature,
      signal,
      // Argument-filling is not user-facing chat content.
    });

    usage = addUsage(usage, completion.usage);
    emitLLMResponse(events, step, completion, 1);

    const call = completion.toolCalls.find((entry) => entry.name === toolKey);
    if (!call) {
      const message = `The model did not produce arguments for "${tool.name}".`;
      events.emit("note", { stepKey: step.key, label: "No tool call", data: { message } });
      return { output: message, usage };
    }
    toolArgs = call.arguments;
  }

  events.emit("tool_call", {
    stepKey: step.key,
    label: tool.name,
    data: { tool: toolKey, arguments: toolArgs, mode: step.config.argumentMode },
  });

  const result = await invokeTool(toolKey, toolArgs, toolContext);

  events.emit("tool_result", {
    stepKey: step.key,
    label: tool.name,
    data: {
      tool: toolKey,
      status: result.status,
      summary: result.summary,
      result: result.data,
    },
    durationMs: result.durationMs,
  });

  return { output: result.content, usage };
}

const BRANCH_TOOL_NAME = "select_branch";

async function runDecisionStep(args: RunStepArgs): Promise<StepOutcome> {
  const { step, workflow, provider, scope, history, events, signal } = args;

  const branches = step.config.branches ?? [];
  if (branches.length === 0) {
    events.emit("note", {
      stepKey: step.key,
      label: "No branches",
      data: { message: `Decision step "${step.name}" has no branches. Continuing in order.` },
    });
    return { output: "", usage: EMPTY_USAGE };
  }

  const labels = branches.map((branch) => branch.label);
  const instruction = renderInstruction(step, scope, events);

  const criteria = branches
    .map((branch) =>
      branch.description ? `- ${branch.label}: ${branch.description}` : `- ${branch.label}`,
    )
    .join("\n");

  // A forced tool call with an enum is far more reliable than asking for a bare
  // label, and it works identically on both providers.
  const completion = await provider.complete({
    model: workflow.model,
    system: workflow.systemPrompt || undefined,
    messages: buildMessages(
      step,
      scope,
      history,
      `${instruction}\n\nChoose exactly one branch:\n${criteria}`,
    ),
    tools: [
      {
        name: BRANCH_TOOL_NAME,
        description: "Record which branch this request should follow.",
        parameters: {
          type: "object",
          properties: {
            branch: {
              type: "string",
              enum: labels,
              description: "The label of the branch that best fits.",
            },
            reason: {
              type: "string",
              description: "One sentence explaining the choice.",
            },
          },
          required: ["branch"],
          additionalProperties: false,
        },
      },
    ],
    toolChoice: "required",
    temperature: workflow.temperature,
    signal,
    // Branch selection is traced, not shown as chat tokens.
  });

  emitLLMResponse(events, step, completion, 1);

  const call = completion.toolCalls.find((entry) => entry.name === BRANCH_TOOL_NAME);
  const rawChoice = typeof call?.arguments.branch === "string" ? call.arguments.branch : "";
  const reason = typeof call?.arguments.reason === "string" ? call.arguments.reason : "";

  const chosen =
    branches.find((branch) => branch.label === rawChoice) ??
    branches.find(
      (branch) => branch.label.toLowerCase() === rawChoice.trim().toLowerCase(),
    ) ??
    branches[0];

  const matched = chosen.label === rawChoice;

  events.emit("decision", {
    stepKey: step.key,
    label: chosen.label,
    data: {
      chosen: chosen.label,
      target: chosen.target,
      reason,
      matched,
      rawChoice,
      options: branches.map((branch) => ({ label: branch.label, target: branch.target })),
    },
  });

  if (!matched) {
    events.emit("note", {
      stepKey: step.key,
      label: "Fell back to first branch",
      data: {
        message: `The model answered "${rawChoice || "nothing"}", which is not one of the branches. Using "${chosen.label}".`,
      },
    });
  }

  return {
    // A decision produces no user-facing prose, so it must not overwrite the
    // final answer; the reason is kept in the trace instead.
    output: "",
    usage: completion.usage,
    nextStepKey: chosen.target,
  };
}

async function runRespondStep(args: RunStepArgs): Promise<StepOutcome> {
  const { step, workflow, provider, scope, history, events, signal } = args;

  const instruction = renderInstruction(step, scope, events);

  const completion = await provider.complete({
    model: workflow.model,
    system: workflow.systemPrompt || undefined,
    messages: buildMessages(step, scope, history, instruction),
    toolChoice: "none",
    temperature: workflow.temperature,
    signal,
    ...streamHooks(args),
  });

  emitLLMResponse(events, step, completion, 1);

  return { output: completion.text.trim(), usage: completion.usage };
}

/** Convenience for the API layer: the tools a workflow can actually reach. */
export function describeEnabledTools(enabledToolKeys: string[]) {
  return enabledToolKeys
    .map((key) => getTool(key))
    .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool))
    .map(describeTool);
}

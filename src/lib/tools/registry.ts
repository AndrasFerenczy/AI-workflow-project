import { z } from "zod";

import { calculatorTool } from "./calculator";
import { currentTimeTool } from "./current-time";
import { fetchUrlTool } from "./fetch-url";
import { sendEmailTool } from "./send-email";
import { webSearchTool } from "./web-search";
import {
  ToolExecutionError,
  type ToolContext,
  type ToolDefinition,
  type ToolDescriptor,
  type ToolInvocationResult,
} from "./types";

/**
 * The single place tools are registered. Everything else in the app -- the
 * builder UI, the LLM tool schemas, the executor -- reads from here, so adding
 * a tool is: write the file, add it to this array.
 */
const TOOLS: ToolDefinition<never, unknown>[] = [
  calculatorTool,
  webSearchTool,
  fetchUrlTool,
  sendEmailTool,
  currentTimeTool,
] as unknown as ToolDefinition<never, unknown>[];

const BY_KEY = new Map(TOOLS.map((tool) => [tool.key, tool]));

export function listTools(): ToolDefinition<never, unknown>[] {
  return TOOLS;
}

export function getTool(key: string): ToolDefinition<never, unknown> | undefined {
  return BY_KEY.get(key);
}

export function isKnownToolKey(key: string): boolean {
  return BY_KEY.has(key);
}

export function defaultEnabledToolKeys(): string[] {
  return TOOLS.filter((tool) => tool.enabledByDefault).map((tool) => tool.key);
}

/** JSON Schema for the LLM, produced from the same zod schema used to validate. */
export function toolParametersJsonSchema(tool: ToolDefinition<never, unknown>) {
  return z.toJSONSchema(tool.parameters, { target: "draft-7", io: "input" }) as Record<
    string,
    unknown
  >;
}

export function describeTool(tool: ToolDefinition<never, unknown>): ToolDescriptor {
  return {
    key: tool.key,
    name: tool.name,
    description: tool.description,
    summary: tool.summary,
    icon: tool.icon,
    tags: tool.tags ?? [],
    enabledByDefault: tool.enabledByDefault ?? false,
    parametersSchema: toolParametersJsonSchema(tool),
  };
}

export function describeTools(): ToolDescriptor[] {
  return TOOLS.map(describeTool);
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Validates arguments, runs the tool and normalises the outcome.
 *
 * Failures are returned rather than thrown: a tool erroring is information the
 * model can act on (fix the arguments, try another approach), not a reason to
 * abandon the run. Only an aborted run propagates.
 */
export async function invokeTool(
  key: string,
  rawArgs: unknown,
  context: ToolContext,
): Promise<ToolInvocationResult> {
  const startedAt = Date.now();
  const tool = BY_KEY.get(key);

  const fail = (message: string, data: unknown = { error: message }): ToolInvocationResult => ({
    status: "error",
    content: stringify(data),
    data,
    summary: message,
    durationMs: Date.now() - startedAt,
  });

  if (!tool) {
    return fail(`Unknown tool "${key}".`);
  }

  const parsed = tool.parameters.safeParse(rawArgs);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join(".") || "(root)",
      message: issue.message,
    }));
    return fail(`Invalid arguments for ${tool.name}.`, {
      error: `Invalid arguments for "${key}". Fix them and call the tool again.`,
      issues,
    });
  }

  const input = parsed.data as never;

  try {
    const output = await tool.execute(input, context);
    return {
      status: "ok",
      content: stringify(output),
      data: output,
      summary: tool.summarize?.(input, output) ?? tool.name,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (context.signal.aborted) throw error;

    if (error instanceof ToolExecutionError) {
      return fail(error.message, { error: error.message, details: error.details });
    }

    const message = error instanceof Error ? error.message : "Unexpected tool failure.";
    console.error(`[tool:${key}] unexpected failure`, error);
    return fail(message, { error: `${tool.name} failed: ${message}` });
  }
}

import { z } from "zod";

export const STEP_TYPES = ["agent", "tool", "decision", "respond"] as const;
export type StepType = (typeof STEP_TYPES)[number];

/** Target used by a decision branch to finish the run instead of jumping. */
export const END_STEP = "__end__";

export const STEP_TYPE_META: Record<
  StepType,
  { label: string; icon: string; blurb: string }
> = {
  agent: {
    label: "Agent",
    icon: "Bot",
    blurb: "The model reasons and calls tools in a loop until it has an answer.",
  },
  tool: {
    label: "Tool",
    icon: "Wrench",
    blurb: "Always run one specific tool, exactly once.",
  },
  decision: {
    label: "Decision",
    icon: "GitBranch",
    blurb: "The model picks a branch and the workflow jumps to that step.",
  },
  respond: {
    label: "Respond",
    icon: "MessageSquare",
    blurb: "Write the final answer for the user from everything gathered so far.",
  },
};

export const branchSchema = z.object({
  label: z.string().min(1, "Branch needs a label").max(60),
  description: z.string().max(300).default(""),
  /** A step key, or END_STEP to finish the run. */
  target: z.string().min(1, "Branch needs a target"),
});

export type Branch = z.infer<typeof branchSchema>;

/**
 * One config shape covering every step type. Keeping it flat means the editor
 * can hold a single object per step and the executor reads only the fields
 * relevant to that step's type.
 */
export const stepConfigSchema = z
  .object({
    /** agent: restrict to a subset of the workflow's enabled tools. Empty = all. */
    toolKeys: z.array(z.string()).default([]),
    /** agent: per-step override of the workflow's iteration budget. */
    maxIterations: z.number().int().min(1).max(12).optional(),
    /** decision: the branches the model chooses between. */
    branches: z.array(branchSchema).default([]),
    /** tool: whether the model fills the arguments or they come from a template. */
    argumentMode: z.enum(["llm", "template"]).default("llm"),
    /** tool: JSON object template, supports {{input}} and {{steps.key.output}}. */
    argumentTemplate: z.string().default(""),
  })
  // prefault, not default: the fallback is fed through parsing so the field
  // defaults above are applied to it too.
  .prefault({});

export type StepConfig = z.infer<typeof stepConfigSchema>;

export function parseStepConfig(raw: unknown): StepConfig {
  const source =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return {};
          }
        })()
      : (raw ?? {});

  const parsed = stepConfigSchema.safeParse(source);
  return parsed.success ? parsed.data : stepConfigSchema.parse({});
}

export const stepSchema = z.object({
  /** Stable slug referenced by templates and decision branch targets. */
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers and underscores"),
  type: z.enum(STEP_TYPES),
  name: z.string().min(1, "Step needs a name").max(80),
  instruction: z.string().max(4000).default(""),
  toolKey: z.string().nullable().default(null),
  config: stepConfigSchema,
});

export type WorkflowStepInput = z.infer<typeof stepSchema>;

export const workflowToolSchema = z.object({
  toolKey: z.string().min(1),
  enabled: z.boolean(),
});

const workflowBaseSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  description: z.string().max(500).nullish(),
  systemPrompt: z.string().max(8000).default(""),
  provider: z.string().min(1),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2),
  maxIterations: z.number().int().min(1).max(12),
  tools: z.array(workflowToolSchema).default([]),
  steps: z.array(stepSchema).default([]),
});

export const createWorkflowSchema = workflowBaseSchema.partial().extend({
  name: z.string().min(1, "Name is required").max(120),
});

export const updateWorkflowSchema = workflowBaseSchema;

export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;

/**
 * Cross-field validation the per-field schemas cannot express: unique step
 * keys, tool steps naming a tool, decision branches pointing somewhere real.
 */
export function validateSteps(steps: WorkflowStepInput[]): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();

  for (const step of steps) {
    if (keys.has(step.key)) {
      errors.push(`Duplicate step key "${step.key}".`);
    }
    keys.add(step.key);
  }

  for (const step of steps) {
    if (step.type === "tool" && !step.toolKey) {
      errors.push(`Step "${step.name}" is a tool step but no tool is selected.`);
    }

    if (step.type === "decision") {
      const branches = step.config.branches ?? [];
      if (branches.length < 2) {
        errors.push(`Decision step "${step.name}" needs at least two branches.`);
      }
      for (const branch of branches) {
        if (branch.target !== END_STEP && !keys.has(branch.target)) {
          errors.push(
            `Branch "${branch.label}" in "${step.name}" points at "${branch.target}", which is not a step.`,
          );
        }
      }
    }
  }

  return errors;
}

export const chatRequestSchema = z.object({
  message: z.string().min(1, "Message is required").max(8000),
  sessionId: z.string().nullish(),
  /** When true, the chat route responds with an SSE event stream. */
  stream: z.boolean().optional(),
});

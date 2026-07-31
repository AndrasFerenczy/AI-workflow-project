import { Parser } from "expr-eval";
import { z } from "zod";

import { defineTool } from "./define";
import { ToolExecutionError } from "./types";

// expr-eval parses into an AST and evaluates it itself, so there is no `eval`
// and no access to the host scope. Assignment is disabled so an expression
// cannot leak state between calls.
const parser = new Parser({
  operators: {
    assignment: false,
    logical: true,
    comparison: true,
    concatenate: false,
  },
});

const parameters = z.object({
  expression: z
    .string()
    .min(1, "expression must not be empty")
    .max(500, "expression is too long")
    .describe(
      "A mathematical expression, e.g. '(1200 * 1.08) / 12' or 'sqrt(2) * sin(PI/4)'. " +
        "Supports + - * / ^ %, parentheses, and functions such as sqrt, abs, round, " +
        "floor, ceil, min, max, log, ln, exp, sin, cos, tan, and the constants PI and E.",
    ),
});

export const calculatorTool = defineTool({
  key: "calculator",
  name: "Calculator",
  description:
    "Evaluate a mathematical expression precisely. Always use this instead of doing " +
    "arithmetic yourself whenever the answer needs to be exact.",
  summary: "Exact arithmetic without the model guessing at the numbers.",
  icon: "Calculator",
  tags: ["compute"],
  enabledByDefault: true,
  parameters,
  async execute({ expression }) {
    let value: unknown;
    try {
      value = parser.evaluate(expression, {});
    } catch (error) {
      throw new ToolExecutionError(
        `Could not evaluate "${expression}": ${
          error instanceof Error ? error.message : "invalid expression"
        }`,
      );
    }

    if (typeof value !== "number" && typeof value !== "boolean") {
      throw new ToolExecutionError(
        `Expression "${expression}" did not evaluate to a number or boolean.`,
      );
    }

    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new ToolExecutionError(
        `Expression "${expression}" evaluated to ${value} (division by zero or overflow).`,
      );
    }

    return { expression, result: value };
  },
  summarize: (input, output) => `${input.expression} = ${output.result}`,
});

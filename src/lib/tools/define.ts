import type { z } from "zod";

import type { ToolContext, ToolDefinition } from "./types";

/**
 * Identity helper that pins the input type from the zod schema so `execute`
 * and `summarize` get full inference without each tool repeating its generics.
 */
export function defineTool<TSchema extends z.ZodType, TOutput>(tool: {
  key: string;
  name: string;
  description: string;
  summary: string;
  icon: string;
  tags?: ToolDefinition["tags"];
  enabledByDefault?: boolean;
  parameters: TSchema;
  execute(input: z.output<TSchema>, context: ToolContext): Promise<TOutput>;
  summarize?(input: z.output<TSchema>, output: TOutput): string;
}): ToolDefinition<z.output<TSchema>, TOutput> {
  return tool as ToolDefinition<z.output<TSchema>, TOutput>;
}

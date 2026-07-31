import { z } from "zod";

import { defineTool } from "./define";
import { ToolExecutionError } from "./types";

const parameters = z.object({
  timeZone: z
    .string()
    .default("UTC")
    .describe("IANA time zone, e.g. 'UTC', 'Europe/Berlin', 'America/New_York'."),
});

export const currentTimeTool = defineTool({
  key: "current_time",
  name: "Current time",
  description:
    "Get the current date and time in a given time zone. Use it whenever the answer " +
    "depends on today's date, since your own sense of 'now' is unreliable.",
  summary: "Grounds the model in the actual current date and time.",
  icon: "Clock",
  tags: ["compute"],
  enabledByDefault: false,
  parameters,
  async execute({ timeZone }) {
    const now = new Date();

    let formatted: string;
    try {
      formatted = new Intl.DateTimeFormat("en-US", {
        timeZone,
        dateStyle: "full",
        timeStyle: "long",
      }).format(now);
    } catch {
      throw new ToolExecutionError(
        `"${timeZone}" is not a recognised IANA time zone. Try 'UTC' or 'Europe/Berlin'.`,
      );
    }

    return {
      timeZone,
      formatted,
      iso: now.toISOString(),
      unixMs: now.getTime(),
    };
  },
  summarize: (_input, output) => output.formatted,
});

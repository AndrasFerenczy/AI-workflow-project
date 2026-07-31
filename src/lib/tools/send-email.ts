import { z } from "zod";

import { prisma } from "@/lib/db";

import { defineTool } from "./define";

const parameters = z.object({
  to: z.string().email("must be a valid email address").describe("Recipient email address."),
  subject: z.string().min(1).max(200).describe("Subject line."),
  body: z
    .string()
    .min(1)
    .max(10_000)
    .describe("Plain-text body of the email. Write it in full, ready to send."),
});

export const sendEmailTool = defineTool({
  key: "send_email",
  name: "Send email",
  description:
    "Send an email. Use it when the user asks you to email, notify or follow up with " +
    "someone. Compose the full subject and body yourself.",
  summary: "Mock sender: writes to the Outbox instead of delivering anything.",
  icon: "Mail",
  tags: ["writes", "mock"],
  enabledByDefault: false,
  parameters,
  async execute({ to, subject, body }, context) {
    // Deliberately a mock. Persisting to EmailLog makes the side effect
    // inspectable in the Outbox instead of vanishing into a console log.
    const email = await prisma.emailLog.create({
      data: { to, subject, body, runId: context.runId },
    });

    return {
      delivered: false,
      mock: true,
      id: email.id,
      to,
      subject,
      sentAt: email.createdAt.toISOString(),
      note: "Recorded in the mock outbox. No message was actually delivered.",
    };
  },
  summarize: (input) => `To ${input.to}: "${input.subject}"`,
});

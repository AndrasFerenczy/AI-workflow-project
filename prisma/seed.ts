/**
 * Seeds three demo workflows that between them exercise every feature of the
 * builder: plain agents, multi-step pipelines, decision branching, template
 * tool steps and the mock email sender.
 *
 *   npm run db:seed
 */
import { prisma } from "@/lib/db";
import { defaultProviderSelection } from "@/lib/llm";
import { listTools } from "@/lib/tools/registry";
import type { StepType } from "@/lib/workflow/types";

interface SeedStep {
  key: string;
  type: StepType;
  name: string;
  instruction?: string;
  toolKey?: string | null;
  config?: Record<string, unknown>;
}

interface SeedWorkflow {
  name: string;
  description: string;
  systemPrompt: string;
  temperature?: number;
  maxIterations?: number;
  enabledTools: string[];
  steps: SeedStep[];
}

const WORKFLOWS: SeedWorkflow[] = [
  {
    name: "Research Assistant",
    description:
      "Searches the web, reads the most promising page and answers with citations.",
    systemPrompt: [
      "You are a meticulous research assistant.",
      "",
      "Work in this order:",
      "1. Search the web for the question before answering.",
      "2. If a snippet looks promising but is too short, fetch the page to read it properly.",
      "3. Answer in a few tight paragraphs, then list your sources as Markdown links.",
      "",
      "Format every reply in Markdown (headings, lists, bold, links) so it reads cleanly in the chat UI.",
      "Never invent a source. If the search comes back empty or rate-limited, say so plainly",
      "and answer from your own knowledge, flagging that it is unverified.",
    ].join("\n"),
    temperature: 0.3,
    maxIterations: 6,
    enabledTools: ["web_search", "fetch_url", "current_time"],
    // No steps: a single implicit agent step is the right shape for an
    // open-ended researcher, and it shows the zero-config path works.
    steps: [],
  },

  {
    name: "Math Tutor",
    description:
      "Solves the problem exactly with the calculator, then explains it step by step.",
    systemPrompt: [
      "You are a patient maths tutor for a bright but impatient student.",
      "",
      "Always use the calculator tool for arithmetic rather than computing in your head,",
      "even when the sum looks easy.",
      "Format every reply in Markdown: short numbered steps, and put the final answer",
      "in bold on its own line (for example: **Answer: 6**).",
      "Write math in plain text or Markdown — do not use LaTeX delimiters like \\( \\).",
    ].join("\n"),
    temperature: 0.2,
    maxIterations: 6,
    enabledTools: ["calculator"],
    steps: [
      {
        key: "solve",
        type: "agent",
        name: "Solve",
        instruction:
          "Solve this problem, using the calculator for every arithmetic step:\n\n{{input}}",
        config: { toolKeys: ["calculator"] },
      },
      {
        key: "explain",
        type: "respond",
        name: "Explain",
        instruction: [
          "Rewrite the solution above as a clear Markdown explanation for a student.",
          "Use a short numbered list, state the rule applied at each step, and finish with",
          "the final answer in bold on its own line (e.g. **Answer: 6**).",
          "Do not use LaTeX.",
        ].join(" "),
      },
    ],
  },

  {
    name: "Support Triage",
    description:
      "Classifies an incoming support request, then handles billing, technical and other cases differently.",
    systemPrompt: [
      "You are the first line of support for a SaaS product called Northwind.",
      "You are warm, concise and never promise anything you cannot verify.",
      "Format replies in Markdown (short paragraphs, lists, bold for key facts).",
    ].join("\n"),
    temperature: 0.4,
    maxIterations: 5,
    enabledTools: ["calculator", "send_email", "current_time"],
    steps: [
      {
        key: "triage",
        type: "decision",
        name: "Triage the request",
        instruction:
          "Read the customer message and decide which team should handle it.\n\n{{input}}",
        config: {
          branches: [
            {
              label: "Billing",
              description:
                "Invoices, refunds, payment failures, plan changes, anything about money.",
              target: "billing",
            },
            {
              label: "Technical",
              description: "Bugs, errors, outages, integration and API problems.",
              target: "technical",
            },
            {
              label: "Other",
              description:
                "Everything else: general questions, feedback, sales enquiries.",
              target: "general",
            },
          ],
        },
      },
      {
        key: "billing",
        type: "agent",
        name: "Billing response",
        instruction: [
          "Handle this billing request: {{input}}",
          "",
          "Work out any figures with the calculator so the numbers are exact.",
          "Then email the customer a clear summary of what will happen and when,",
          "using support@northwind.example as the tone reference for formality.",
        ].join("\n"),
        config: { toolKeys: ["calculator", "send_email"] },
      },
      {
        key: "technical",
        type: "agent",
        name: "Technical response",
        instruction: [
          "Handle this technical request: {{input}}",
          "",
          "Give concrete troubleshooting steps in order, from cheapest to most involved.",
          "If you genuinely cannot resolve it, say what information the engineering team",
          "would need to take it further.",
        ].join("\n"),
        config: { toolKeys: ["current_time"] },
      },
      {
        key: "general",
        type: "respond",
        name: "General response",
        instruction:
          "Reply warmly and briefly to this message, and point them somewhere useful:\n\n{{input}}",
      },
    ],
  },
];

async function main() {
  const { provider, model } = await defaultProviderSelection();
  const allToolKeys = listTools().map((tool) => tool.key);

  console.log(`Seeding ${WORKFLOWS.length} workflows (${provider} / ${model})...\n`);

  for (const definition of WORKFLOWS) {
    // Idempotent by name so re-seeding refreshes the demos instead of
    // stacking up duplicates.
    const existing = await prisma.workflow.findFirst({
      where: { name: definition.name },
      select: { id: true },
    });

    if (existing) {
      await prisma.workflow.delete({ where: { id: existing.id } });
    }

    const unknown = definition.enabledTools.filter((key) => !allToolKeys.includes(key));
    if (unknown.length > 0) {
      throw new Error(
        `Workflow "${definition.name}" enables unknown tools: ${unknown.join(", ")}`,
      );
    }

    const created = await prisma.workflow.create({
      data: {
        name: definition.name,
        description: definition.description,
        systemPrompt: definition.systemPrompt,
        provider,
        model,
        temperature: definition.temperature ?? 0.7,
        maxIterations: definition.maxIterations ?? 6,
        tools: {
          create: allToolKeys.map((toolKey) => ({
            toolKey,
            enabled: definition.enabledTools.includes(toolKey),
          })),
        },
        steps: {
          create: definition.steps.map((step, index) => ({
            key: step.key,
            type: step.type,
            name: step.name,
            order: index,
            instruction: step.instruction ?? "",
            toolKey: step.toolKey ?? null,
            config: JSON.stringify(step.config ?? {}),
          })),
        },
      },
      include: { tools: true, steps: { orderBy: { order: "asc" } } },
    });

    await prisma.workflowVersion.create({
      data: {
        workflowId: created.id,
        version: 1,
        label: "Seeded demo",
        snapshot: JSON.stringify({
          name: created.name,
          description: created.description,
          systemPrompt: created.systemPrompt,
          provider: created.provider,
          model: created.model,
          temperature: created.temperature,
          maxIterations: created.maxIterations,
          tools: created.tools.map((tool) => ({
            toolKey: tool.toolKey,
            enabled: tool.enabled,
          })),
          steps: created.steps.map((step) => ({
            key: step.key,
            type: step.type,
            name: step.name,
            instruction: step.instruction,
            toolKey: step.toolKey,
            config: JSON.parse(step.config || "{}"),
          })),
        }),
      },
    });

    const shape =
      definition.steps.length === 0
        ? "1 implicit agent step"
        : `${definition.steps.length} steps`;
    console.log(
      `  ${definition.name.padEnd(20)} ${shape}, tools: ${definition.enabledTools.join(", ")}`,
    );
  }

  console.log("\nDone.");
}

main()
  .catch((error) => {
    console.error("\nSeeding failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

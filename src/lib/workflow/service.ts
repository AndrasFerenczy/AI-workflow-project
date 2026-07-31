import { prisma } from "@/lib/db";
import { deserializeRunEvent, type RunEvent } from "@/lib/engine/events";
import { executeWorkflow, type ExecutableWorkflow } from "@/lib/engine/executor";
import type { LLMMessage } from "@/lib/llm";
import { defaultProviderSelection } from "@/lib/llm";
import { listTools } from "@/lib/tools/registry";
import { truncate } from "@/lib/utils";
import { Prisma } from "@/generated/prisma/client";

import type {
  ChatResponseDTO,
  MessageDTO,
  RunDetailDTO,
  RunSummaryDTO,
  WorkflowDTO,
  WorkflowSnapshot,
  WorkflowStepDTO,
  WorkflowSummaryDTO,
  WorkflowToolDTO,
  WorkflowVersionDetailDTO,
  WorkflowVersionSummaryDTO,
} from "./dto";
import { parseStepConfig, type StepType, type UpdateWorkflowInput } from "./types";

/** How many prior turns are replayed into each run. */
const HISTORY_TURN_LIMIT = 12;

type WorkflowRow = Awaited<ReturnType<typeof loadWorkflowRow>>;

function loadWorkflowRow(id: string) {
  return prisma.workflow.findUnique({
    where: { id },
    include: {
      tools: true,
      steps: { orderBy: { order: "asc" } },
    },
  });
}

/**
 * Tool rows are the source of truth, but a tool added to the registry after a
 * workflow was saved has no row yet, so it falls back to its registry default.
 */
function resolveEnabledToolKeys(rows: Array<{ toolKey: string; enabled: boolean }>): string[] {
  const explicit = new Map(rows.map((row) => [row.toolKey, row.enabled]));

  return listTools()
    .filter((tool) => explicit.get(tool.key) ?? tool.enabledByDefault ?? false)
    .map((tool) => tool.key);
}

function toStepDTO(row: {
  id: string;
  key: string;
  type: string;
  name: string;
  order: number;
  instruction: string;
  toolKey: string | null;
  config: string;
}): WorkflowStepDTO {
  return {
    id: row.id,
    key: row.key,
    type: row.type as StepType,
    name: row.name,
    order: row.order,
    instruction: row.instruction,
    toolKey: row.toolKey,
    config: parseStepConfig(row.config),
  };
}

function resolveProviderFields(provider: string, model: string): {
  provider: string;
  model: string;
} {
  // Removed free gateway — map leftover DB rows onto OpenAI defaults.
  if (provider === "free") {
    return { provider: "openai", model: "gpt-4o-mini" };
  }
  return { provider, model };
}

export function toWorkflowDTO(row: NonNullable<WorkflowRow>): WorkflowDTO {
  // Emit a row for every registered tool so the builder always renders the
  // full list with the right switch positions.
  const explicit = new Map(row.tools.map((tool) => [tool.toolKey, tool.enabled]));
  const { provider, model } = resolveProviderFields(row.provider, row.model);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.systemPrompt,
    provider,
    model,
    temperature: row.temperature,
    maxIterations: row.maxIterations,
    tools: listTools().map((tool) => ({
      toolKey: tool.key,
      enabled: explicit.get(tool.key) ?? tool.enabledByDefault ?? false,
    })),
    steps: row.steps.map(toStepDTO),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toExecutableWorkflow(row: NonNullable<WorkflowRow>): ExecutableWorkflow {
  const { provider, model } = resolveProviderFields(row.provider, row.model);
  return {
    id: row.id,
    name: row.name,
    systemPrompt: row.systemPrompt,
    provider,
    model,
    temperature: row.temperature,
    maxIterations: row.maxIterations,
    enabledToolKeys: resolveEnabledToolKeys(row.tools),
    steps: row.steps.map((step) => ({
      key: step.key,
      type: step.type as StepType,
      name: step.name,
      instruction: step.instruction,
      toolKey: step.toolKey,
      config: parseStepConfig(step.config),
    })),
  };
}

export async function getWorkflow(id: string): Promise<WorkflowDTO | null> {
  const row = await loadWorkflowRow(id);
  return row ? toWorkflowDTO(row) : null;
}

export async function listWorkflows(): Promise<WorkflowSummaryDTO[]> {
  const rows = await prisma.workflow.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      tools: true,
      _count: { select: { steps: true, runs: true } },
    },
  });

  return rows.map((row) => {
    const { provider, model } = resolveProviderFields(row.provider, row.model);
    return {
    id: row.id,
    name: row.name,
    description: row.description,
    provider,
    model,
    stepCount: row._count.steps,
    enabledToolKeys: resolveEnabledToolKeys(row.tools),
    runCount: row._count.runs,
    updatedAt: row.updatedAt.toISOString(),
  };
  });
}

const STARTER_SYSTEM_PROMPT =
  "You are a helpful assistant. Use the tools available to you when they would make " +
  "your answer more accurate, and explain your reasoning briefly.";

export async function createWorkflow(input: {
  name: string;
  description?: string | null;
  systemPrompt?: string;
  provider?: string;
  model?: string;
}): Promise<WorkflowDTO> {
  const fallback = await defaultProviderSelection();

  const created = await prisma.workflow.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      systemPrompt: input.systemPrompt ?? STARTER_SYSTEM_PROMPT,
      provider: input.provider ?? fallback.provider,
      model: input.model ?? fallback.model,
      tools: {
        create: listTools().map((tool) => ({
          toolKey: tool.key,
          enabled: tool.enabledByDefault ?? false,
        })),
      },
    },
    include: { tools: true, steps: { orderBy: { order: "asc" } } },
  });

  await createVersionSnapshot(created.id, snapshotFromRow(created), "Initial version");

  return toWorkflowDTO(created);
}

function snapshotFromDto(dto: WorkflowDTO): WorkflowSnapshot {
  return {
    name: dto.name,
    description: dto.description,
    systemPrompt: dto.systemPrompt,
    provider: dto.provider,
    model: dto.model,
    temperature: dto.temperature,
    maxIterations: dto.maxIterations,
    tools: dto.tools,
    steps: dto.steps.map((step) => ({
      key: step.key,
      type: step.type,
      name: step.name,
      instruction: step.instruction,
      toolKey: step.toolKey,
      config: step.config,
    })),
  };
}

function snapshotFromRow(row: NonNullable<WorkflowRow>): WorkflowSnapshot {
  return snapshotFromDto(toWorkflowDTO(row));
}

function snapshotFromInput(input: UpdateWorkflowInput): WorkflowSnapshot {
  return {
    name: input.name,
    description: input.description ?? null,
    systemPrompt: input.systemPrompt,
    provider: input.provider,
    model: input.model,
    temperature: input.temperature,
    maxIterations: input.maxIterations,
    tools: input.tools,
    steps: input.steps.map((step) => ({
      key: step.key,
      type: step.type,
      name: step.name,
      instruction: step.instruction,
      toolKey: step.toolKey,
      config: step.config,
    })),
  };
}

function parseSnapshot(raw: string): WorkflowSnapshot {
  const parsed = JSON.parse(raw) as WorkflowSnapshot;
  return {
    ...parsed,
    tools: parsed.tools ?? [],
    steps: (parsed.steps ?? []).map((step) => ({
      ...step,
      config: parseStepConfig(step.config),
    })),
  };
}

async function nextVersionNumber(
  workflowId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const latest = await tx.workflowVersion.findFirst({
    where: { workflowId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return (latest?.version ?? 0) + 1;
}

async function createVersionSnapshot(
  workflowId: string,
  snapshot: WorkflowSnapshot,
  label?: string | null,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const version = await nextVersionNumber(workflowId, tx);
  return tx.workflowVersion.create({
    data: {
      workflowId,
      version,
      label: label ?? null,
      snapshot: JSON.stringify(snapshot),
    },
  });
}

function toVersionSummary(row: {
  id: string;
  version: number;
  label: string | null;
  snapshot: string;
  createdAt: Date;
}): WorkflowVersionSummaryDTO {
  const snapshot = parseSnapshot(row.snapshot);
  return {
    id: row.id,
    version: row.version,
    label: row.label,
    name: snapshot.name,
    provider: snapshot.provider,
    model: snapshot.model,
    stepCount: snapshot.steps.length,
    enabledToolCount: snapshot.tools.filter((tool) => tool.enabled).length,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listWorkflowVersions(
  workflowId: string,
): Promise<WorkflowVersionSummaryDTO[] | null> {
  const exists = await prisma.workflow.findUnique({
    where: { id: workflowId },
    select: { id: true },
  });
  if (!exists) return null;

  const rows = await prisma.workflowVersion.findMany({
    where: { workflowId },
    orderBy: { version: "desc" },
  });
  return rows.map(toVersionSummary);
}

export async function getWorkflowVersion(
  workflowId: string,
  versionId: string,
): Promise<WorkflowVersionDetailDTO | null> {
  const row = await prisma.workflowVersion.findFirst({
    where: { id: versionId, workflowId },
  });
  if (!row) return null;
  const summary = toVersionSummary(row);
  return { ...summary, snapshot: parseSnapshot(row.snapshot) };
}

/**
 * Replaces the workflow's tools and steps wholesale inside one transaction.
 * The builder always submits the complete configuration, so a diff-based
 * update would add complexity without changing the outcome.
 *
 * Every successful save also writes an immutable WorkflowVersion snapshot.
 */
export async function updateWorkflow(
  id: string,
  input: UpdateWorkflowInput,
): Promise<WorkflowDTO | null> {
  const exists = await prisma.workflow.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return null;

  await prisma.$transaction(async (tx) => {
    await tx.workflow.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description ?? null,
        systemPrompt: input.systemPrompt,
        provider: input.provider,
        model: input.model,
        temperature: input.temperature,
        maxIterations: input.maxIterations,
      },
    });

    await tx.workflowTool.deleteMany({ where: { workflowId: id } });
    if (input.tools.length > 0) {
      await tx.workflowTool.createMany({
        data: input.tools.map((tool) => ({
          workflowId: id,
          toolKey: tool.toolKey,
          enabled: tool.enabled,
        })),
      });
    }

    await tx.workflowStep.deleteMany({ where: { workflowId: id } });
    if (input.steps.length > 0) {
      await tx.workflowStep.createMany({
        data: input.steps.map((step, index) => ({
          workflowId: id,
          key: step.key,
          type: step.type,
          name: step.name,
          order: index,
          instruction: step.instruction,
          toolKey: step.toolKey,
          config: JSON.stringify(step.config),
        })),
      });
    }

    await createVersionSnapshot(id, snapshotFromInput(input), null, tx);
  });

  return getWorkflow(id);
}

/**
 * Restores a past version onto the live workflow. The current live state is
 * snapshotted first (labelled) so restore is always reversible.
 */
export async function restoreWorkflowVersion(
  workflowId: string,
  versionId: string,
): Promise<WorkflowDTO | null> {
  const current = await loadWorkflowRow(workflowId);
  if (!current) return null;

  const version = await prisma.workflowVersion.findFirst({
    where: { id: versionId, workflowId },
  });
  if (!version) return null;

  const snapshot = parseSnapshot(version.snapshot);

  await prisma.$transaction(async (tx) => {
    await createVersionSnapshot(
      workflowId,
      snapshotFromRow(current),
      `Before restore of v${version.version}`,
      tx,
    );

    await tx.workflow.update({
      where: { id: workflowId },
      data: {
        name: snapshot.name,
        description: snapshot.description,
        systemPrompt: snapshot.systemPrompt,
        provider: snapshot.provider,
        model: snapshot.model,
        temperature: snapshot.temperature,
        maxIterations: snapshot.maxIterations,
      },
    });

    await tx.workflowTool.deleteMany({ where: { workflowId } });
    if (snapshot.tools.length > 0) {
      await tx.workflowTool.createMany({
        data: snapshot.tools.map((tool) => ({
          workflowId,
          toolKey: tool.toolKey,
          enabled: tool.enabled,
        })),
      });
    }

    await tx.workflowStep.deleteMany({ where: { workflowId } });
    if (snapshot.steps.length > 0) {
      await tx.workflowStep.createMany({
        data: snapshot.steps.map((step, index) => ({
          workflowId,
          key: step.key,
          type: step.type,
          name: step.name,
          order: index,
          instruction: step.instruction,
          toolKey: step.toolKey,
          config: JSON.stringify(step.config),
        })),
      });
    }

    await createVersionSnapshot(
      workflowId,
      snapshot,
      `Restored from v${version.version}`,
      tx,
    );
  });

  return getWorkflow(workflowId);
}

export async function deleteWorkflow(id: string): Promise<boolean> {
  try {
    await prisma.workflow.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

export async function duplicateWorkflow(id: string): Promise<WorkflowDTO | null> {
  const source = await loadWorkflowRow(id);
  if (!source) return null;

  const copy = await prisma.workflow.create({
    data: {
      name: `${source.name} (copy)`,
      description: source.description,
      systemPrompt: source.systemPrompt,
      provider: source.provider,
      model: source.model,
      temperature: source.temperature,
      maxIterations: source.maxIterations,
      tools: {
        create: source.tools.map((tool) => ({
          toolKey: tool.toolKey,
          enabled: tool.enabled,
          config: tool.config,
        })),
      },
      steps: {
        create: source.steps.map((step) => ({
          key: step.key,
          type: step.type,
          name: step.name,
          order: step.order,
          instruction: step.instruction,
          toolKey: step.toolKey,
          config: step.config,
        })),
      },
    },
    include: { tools: true, steps: { orderBy: { order: "asc" } } },
  });

  await createVersionSnapshot(copy.id, snapshotFromRow(copy), "Duplicated workflow");

  return toWorkflowDTO(copy);
}

function toMessageDTO(row: {
  id: string;
  role: string;
  content: string;
  runId: string | null;
  createdAt: Date;
}): MessageDTO {
  return {
    id: row.id,
    role: row.role === "user" ? "user" : "assistant",
    content: row.content,
    runId: row.runId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listSessions(workflowId: string) {
  const rows = await prisma.chatSession.findMany({
    where: { workflowId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { messages: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    messageCount: row._count.messages,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function getSessionMessages(sessionId: string): Promise<MessageDTO[]> {
  const rows = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toMessageDTO);
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  try {
    await prisma.chatSession.delete({ where: { id: sessionId } });
    return true;
  } catch {
    return false;
  }
}

function countToolCalls(events: Array<{ type: string }>): number {
  return events.filter((event) => event.type === "tool_call").length;
}

function toRunSummary(row: {
  id: string;
  workflowId: string;
  sessionId: string | null;
  input: string;
  output: string | null;
  status: string;
  error: string | null;
  provider: string;
  model: string;
  durationMs: number | null;
  totalTokens: number | null;
  createdAt: Date;
  workflow: { name: string };
  events?: Array<{ type: string }>;
}): RunSummaryDTO {
  return {
    id: row.id,
    workflowId: row.workflowId,
    workflowName: row.workflow.name,
    sessionId: row.sessionId,
    input: row.input,
    output: row.output,
    status: row.status as RunSummaryDTO["status"],
    error: row.error,
    provider: row.provider,
    model: row.model,
    durationMs: row.durationMs,
    totalTokens: row.totalTokens,
    toolCallCount: countToolCalls(row.events ?? []),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listRuns(options: { workflowId?: string; limit?: number } = {}) {
  const rows = await prisma.run.findMany({
    where: options.workflowId ? { workflowId: options.workflowId } : undefined,
    orderBy: { createdAt: "desc" },
    take: options.limit ?? 50,
    include: {
      workflow: { select: { name: true } },
      events: { select: { type: true } },
    },
  });

  return rows.map(toRunSummary);
}

export async function getRun(id: string): Promise<RunDetailDTO | null> {
  const row = await prisma.run.findUnique({
    where: { id },
    include: {
      workflow: { select: { name: true } },
      events: { orderBy: { seq: "asc" } },
    },
  });
  if (!row) return null;

  return {
    ...toRunSummary(row),
    events: row.events.map(deserializeRunEvent),
  };
}

/**
 * Runs one chat turn: persists the user message, executes the workflow, then
 * stores the run, its trace and the assistant reply.
 *
 * The run row is written before execution so a crashed or timed-out run is
 * still visible in history rather than disappearing.
 */
export async function runChatTurn(options: {
  workflowId: string;
  message: string;
  sessionId?: string | null;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
  onTextReset?: () => void;
  onTextDelta?: (delta: string) => void;
  /** Called once the session/user message/run shell exist, before execution. */
  onStarted?: (info: {
    sessionId: string;
    runId: string;
    userMessage: MessageDTO;
  }) => void;
}): Promise<ChatResponseDTO | null> {
  const row = await loadWorkflowRow(options.workflowId);
  if (!row) return null;

  const session = options.sessionId
    ? await prisma.chatSession.findFirst({
        where: { id: options.sessionId, workflowId: row.id },
      })
    : null;

  const activeSession =
    session ??
    (await prisma.chatSession.create({
      data: {
        workflowId: row.id,
        title: truncate(options.message.replace(/\s+/g, " ").trim(), 60),
      },
    }));

  const priorMessages = await prisma.message.findMany({
    where: { sessionId: activeSession.id },
    orderBy: { createdAt: "asc" },
    take: HISTORY_TURN_LIMIT * 2,
  });

  const history: LLMMessage[] = priorMessages.map((message) =>
    message.role === "user"
      ? { role: "user", content: message.content }
      : { role: "assistant", content: message.content },
  );

  const userMessage = await prisma.message.create({
    data: { sessionId: activeSession.id, role: "user", content: options.message },
  });

  const executable = toExecutableWorkflow(row);

  const run = await prisma.run.create({
    data: {
      workflowId: row.id,
      sessionId: activeSession.id,
      input: options.message,
      status: "running",
      provider: executable.provider,
      model: executable.model,
    },
  });

  options.onStarted?.({
    sessionId: activeSession.id,
    runId: run.id,
    userMessage: toMessageDTO(userMessage),
  });

  const result = await executeWorkflow({
    workflow: executable,
    runId: run.id,
    input: options.message,
    history,
    signal: options.signal,
    onEvent: options.onEvent,
    onTextReset: options.onTextReset,
    onTextDelta: options.onTextDelta,
  });

  const assistantContent =
    result.status === "succeeded"
      ? result.output
      : result.output ||
        `The workflow could not finish. ${result.error ?? "Unknown error."}`;

  const [, assistantMessage] = await prisma.$transaction([
    prisma.runEvent.createMany({ data: result.events.map(toEventRow(run.id)) }),
    prisma.message.create({
      data: {
        sessionId: activeSession.id,
        role: "assistant",
        content: assistantContent,
        runId: run.id,
      },
    }),
    prisma.run.update({
      where: { id: run.id },
      data: {
        status: result.status,
        output: result.output || null,
        error: result.error ?? null,
        durationMs: result.durationMs,
        totalTokens: result.usage.totalTokens,
      },
    }),
    prisma.chatSession.update({
      where: { id: activeSession.id },
      data: { updatedAt: new Date() },
    }),
  ]);

  const detail = await getRun(run.id);

  return {
    sessionId: activeSession.id,
    userMessage: toMessageDTO(userMessage),
    assistantMessage: toMessageDTO(assistantMessage),
    run: detail!,
  };
}

function toEventRow(runId: string) {
  return (event: {
    seq: number;
    type: string;
    stepKey: string | null;
    label: string | null;
    data: Record<string, unknown>;
    durationMs: number | null;
  }) => ({
    runId,
    seq: event.seq,
    type: event.type,
    stepKey: event.stepKey,
    label: event.label,
    data: safeStringify(event.data),
    durationMs: event.durationMs,
  });
}

/** Tool results can contain anything; never let serialisation break a run. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "{}";
  } catch {
    return JSON.stringify({ error: "Payload could not be serialised." });
  }
}

export async function listEmails() {
  const rows = await prisma.emailLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { run: { include: { workflow: { select: { name: true } } } } },
  });

  return rows.map((row) => ({
    id: row.id,
    to: row.to,
    subject: row.subject,
    body: row.body,
    runId: row.runId,
    workflowName: row.run?.workflow.name ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

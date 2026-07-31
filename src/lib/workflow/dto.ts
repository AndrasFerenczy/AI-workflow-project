import type { RunEvent } from "@/lib/engine/events";
import type { StepConfig, StepType } from "./types";

export interface WorkflowToolDTO {
  toolKey: string;
  enabled: boolean;
}

export interface WorkflowStepDTO {
  id: string;
  key: string;
  type: StepType;
  name: string;
  order: number;
  instruction: string;
  toolKey: string | null;
  config: StepConfig;
}

export interface WorkflowDTO {
  id: string;
  name: string;
  description: string | null;
  systemPrompt: string;
  provider: string;
  model: string;
  temperature: number;
  maxIterations: number;
  tools: WorkflowToolDTO[];
  steps: WorkflowStepDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowSummaryDTO {
  id: string;
  name: string;
  description: string | null;
  provider: string;
  model: string;
  stepCount: number;
  enabledToolKeys: string[];
  runCount: number;
  updatedAt: string;
}

export interface MessageDTO {
  id: string;
  role: "user" | "assistant";
  content: string;
  runId: string | null;
  createdAt: string;
}

export interface SessionSummaryDTO {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: string;
}

export interface RunSummaryDTO {
  id: string;
  workflowId: string;
  workflowName: string;
  sessionId: string | null;
  input: string;
  output: string | null;
  status: "running" | "succeeded" | "failed";
  error: string | null;
  provider: string;
  model: string;
  durationMs: number | null;
  totalTokens: number | null;
  toolCallCount: number;
  createdAt: string;
}

export interface RunDetailDTO extends RunSummaryDTO {
  events: RunEvent[];
}

export interface ChatResponseDTO {
  sessionId: string;
  userMessage: MessageDTO;
  assistantMessage: MessageDTO;
  run: RunDetailDTO;
}

export interface EmailDTO {
  id: string;
  to: string;
  subject: string;
  body: string;
  runId: string | null;
  workflowName: string | null;
  createdAt: string;
}

/** Fields stored inside a WorkflowVersion.snapshot JSON blob. */
export interface WorkflowSnapshot {
  name: string;
  description: string | null;
  systemPrompt: string;
  provider: string;
  model: string;
  temperature: number;
  maxIterations: number;
  tools: WorkflowToolDTO[];
  steps: Array<{
    key: string;
    type: StepType;
    name: string;
    instruction: string;
    toolKey: string | null;
    config: StepConfig;
  }>;
}

export interface WorkflowVersionSummaryDTO {
  id: string;
  version: number;
  label: string | null;
  name: string;
  provider: string;
  model: string;
  stepCount: number;
  enabledToolCount: number;
  createdAt: string;
}

export interface WorkflowVersionDetailDTO extends WorkflowVersionSummaryDTO {
  snapshot: WorkflowSnapshot;
}

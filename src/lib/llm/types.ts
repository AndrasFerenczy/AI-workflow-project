export type ProviderId = "openai" | "anthropic" | "deepseek";

/**
 * Provider-neutral message shape. Adapters translate to and from their vendor
 * format so the executor never branches on which provider is in use.
 */
export type LLMMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: LLMToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError?: boolean };

export interface LLMToolCall {
  id: string;
  name: string;
  /** Already-parsed arguments; adapters own the JSON decoding. */
  arguments: Record<string, unknown>;
}

export interface LLMToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMCompletionRequest {
  model: string;
  system?: string;
  messages: LLMMessage[];
  tools?: LLMToolSchema[];
  temperature?: number;
  maxTokens?: number;
  /** Force the model to answer in prose, even when tools are available. */
  toolChoice?: "auto" | "none" | "required";
  signal?: AbortSignal;
  /** Fired once before the first streamed token of this completion. */
  onStreamStart?: () => void;
  /** Fired for each text delta when the provider streams. */
  onTextDelta?: (delta: string) => void;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LLMCompletion {
  text: string;
  toolCalls: LLMToolCall[];
  usage: LLMUsage;
  finishReason: string;
  model: string;
}

export interface ModelInfo {
  id: string;
  label: string;
  /** Shown in the builder next to the model name. */
  note?: string;
}

export interface LLMProvider {
  id: ProviderId;
  label: string;
  models: ModelInfo[];
  defaultModel: string;
  /** Env var / setting name shown in the UI when a key is required. */
  apiKeyEnvVar: string;
  /** False when a required API key is missing. */
  isConfigured(): boolean;
  blurb?: string;
  complete(request: LLMCompletionRequest): Promise<LLMCompletion>;
}

/** Provider-side failure, surfaced to the user with the provider named. */
export class LLMError extends Error {
  constructor(
    message: string,
    readonly provider: ProviderId,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

export const EMPTY_USAGE: LLMUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

export function addUsage(a: LLMUsage, b: LLMUsage): LLMUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

import OpenAI, { APIError } from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

import {
  LLMError,
  type LLMCompletion,
  type LLMCompletionRequest,
  type LLMMessage,
  type LLMProvider,
  type LLMToolCall,
  type ModelInfo,
  type ProviderId,
} from "./types";

export interface OpenAICompatibleConfig {
  id: ProviderId;
  label: string;
  models: ModelInfo[];
  defaultModel: string;
  apiKeyEnvVar: string;
  /** Fixed base URL, or a function so env overrides can apply. */
  baseURL: string | (() => string | undefined);
  resolveApiKey: () => string | undefined;
  ensureReady?: () => Promise<void>;
  blurb?: string;
}

function toOpenAIMessages(system: string | undefined, messages: LLMMessage[]) {
  const out: ChatCompletionMessageParam[] = [];
  if (system) out.push({ role: "system", content: system });

  for (const message of messages) {
    switch (message.role) {
      case "system":
        out.push({ role: "system", content: message.content });
        break;
      case "user":
        out.push({ role: "user", content: message.content });
        break;
      case "assistant":
        out.push({
          role: "assistant",
          content: message.content || null,
          ...(message.toolCalls?.length
            ? {
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.id,
                  type: "function" as const,
                  function: {
                    name: call.name,
                    arguments: JSON.stringify(call.arguments ?? {}),
                  },
                })),
              }
            : {}),
        });
        break;
      case "tool":
        out.push({
          role: "tool",
          tool_call_id: message.toolCallId,
          content: message.content,
        });
        break;
    }
  }

  return out;
}

function buildTools(request: LLMCompletionRequest): ChatCompletionTool[] | undefined {
  return request.tools?.length
    ? request.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }))
    : undefined;
}

function safeParseArguments(raw: string): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return { __malformed_arguments: raw };
  }
}

/** Shared Chat Completions adapter for OpenAI-compatible APIs (OpenAI, DeepSeek, …). */
export function createOpenAICompatibleProvider(config: OpenAICompatibleConfig): LLMProvider {
  let cached: { key: string; client: OpenAI } | null = null;

  async function getClient(): Promise<OpenAI> {
    await config.ensureReady?.();
    const apiKey = config.resolveApiKey();
    if (!apiKey) {
      throw new LLMError(
        `${config.label} is not configured. Add a key on the welcome screen or set ${config.apiKeyEnvVar}.`,
        config.id,
      );
    }

    const baseURL =
      typeof config.baseURL === "function" ? config.baseURL() : config.baseURL;
    const cacheKey = `${apiKey}|${baseURL ?? ""}`;

    if (cached?.key !== cacheKey) {
      cached = {
        key: cacheKey,
        client: new OpenAI({ apiKey, baseURL, maxRetries: 2 }),
      };
    }

    return cached.client;
  }

  function mapError(error: unknown): never {
    if (error instanceof APIError) {
      throw new LLMError(
        `${config.label} request failed (${error.status ?? "network"}): ${error.message}`,
        config.id,
        error.status,
      );
    }
    throw error;
  }

  async function completeBuffered(
    request: LLMCompletionRequest,
    tools: ChatCompletionTool[] | undefined,
  ): Promise<LLMCompletion> {
    const client = await getClient();
    let response;
    try {
      response = await client.chat.completions.create(
        {
          model: request.model,
          messages: toOpenAIMessages(request.system, request.messages),
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          ...(tools ? { tools, tool_choice: request.toolChoice ?? "auto" } : {}),
        },
        { signal: request.signal },
      );
    } catch (error) {
      throw mapError(error);
    }

    const choice = response.choices[0];
    const toolCalls: LLMToolCall[] = [];

    for (const call of choice?.message.tool_calls ?? []) {
      if (call.type !== "function") continue;
      toolCalls.push({
        id: call.id,
        name: call.function.name,
        arguments: safeParseArguments(call.function.arguments),
      });
    }

    const text = choice?.message.content ?? "";
    if (text) {
      request.onStreamStart?.();
      request.onTextDelta?.(text);
    }

    return {
      text,
      toolCalls,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
      finishReason: choice?.finish_reason ?? "stop",
      model: response.model,
    };
  }

  async function completeStreaming(
    request: LLMCompletionRequest,
    tools: ChatCompletionTool[] | undefined,
  ): Promise<LLMCompletion> {
    const client = await getClient();
    let stream;
    try {
      stream = await client.chat.completions.create(
        {
          model: request.model,
          messages: toOpenAIMessages(request.system, request.messages),
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stream: true,
          stream_options: { include_usage: true },
          ...(tools ? { tools, tool_choice: request.toolChoice ?? "auto" } : {}),
        },
        { signal: request.signal },
      );
    } catch (error) {
      throw mapError(error);
    }

    let text = "";
    let started = false;
    let finishReason = "stop";
    let model = request.model;
    let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const toolAcc = new Map<number, { id: string; name: string; arguments: string }>();

    try {
      for await (const chunk of stream) {
        if (chunk.model) model = chunk.model;
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
            totalTokens: chunk.usage.total_tokens ?? 0,
          };
        }

        const choice = chunk.choices[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;

        const delta = choice.delta;
        if (delta?.content) {
          if (!started) {
            started = true;
            request.onStreamStart?.();
          }
          text += delta.content;
          request.onTextDelta?.(delta.content);
        }

        for (const call of delta?.tool_calls ?? []) {
          const index = call.index ?? 0;
          const current = toolAcc.get(index) ?? { id: "", name: "", arguments: "" };
          if (call.id) current.id = call.id;
          if (call.function?.name) current.name = call.function.name;
          if (call.function?.arguments) current.arguments += call.function.arguments;
          toolAcc.set(index, current);
        }
      }
    } catch (error) {
      throw mapError(error);
    }

    return {
      text,
      toolCalls: [...toolAcc.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call]) => ({
          id: call.id,
          name: call.name,
          arguments: safeParseArguments(call.arguments),
        })),
      usage,
      finishReason,
      model,
    };
  }

  return {
    id: config.id,
    label: config.label,
    models: config.models,
    defaultModel: config.defaultModel,
    apiKeyEnvVar: config.apiKeyEnvVar,
    blurb: config.blurb,
    isConfigured() {
      return Boolean(config.resolveApiKey());
    },
    async complete(request: LLMCompletionRequest): Promise<LLMCompletion> {
      const tools = buildTools(request);
      if (request.onTextDelta || request.onStreamStart) {
        return completeStreaming(request, tools);
      }
      return completeBuffered(request, tools);
    },
  };
}
